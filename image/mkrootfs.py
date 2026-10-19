#!/usr/bin/env python3
"""
Giai đoạn 1 của việc dựng ảnh Debian 12 (bookworm) i386 cho v86.

Tương đương `debootstrap --foreign --variant=minbase --arch=i386 bookworm`:
  * tải chỉ mục gói và các .deb từ mirror Debian (kiểm tra SHA256),
  * giải nén các gói Priority: required (giống hàm `extract` + `merge_usr`
    của debootstrap) vào một cây thư mục trong bộ nhớ,
  * chép script debootstrap và các tệp /debootstrap/* để chạy
    `debootstrap --second-stage` NGAY TRONG máy ảo Linux (v86),
  * đặt các .deb của gói bổ sung (packages.txt) vào một kho apt cục bộ,
  * xuất cây thành định dạng 9p của v86 (fs.json phiên bản 3 + thư mục
    tệp đặt tên theo sha256), đúng như tools/fs2json.py và
    tools/copy-to-sha256.py của v86,
  * lấy kernel Debian (linux-image-686) và tạo initrd nhỏ bằng
    busybox-static để gắn hệ tệp gốc qua 9p.

Chỉ dùng thư viện chuẩn của Python 3.9+, chạy được trên Linux/macOS/Windows
(không cần quyền root, không cần debootstrap/dpkg trên máy dựng).
"""

import argparse
import gzip
import hashlib
import io
import json
import lzma
import os
import posixpath
import re
import shutil
import stat
import sys
import tarfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

S_IFREG = 0o100000
S_IFDIR = 0o040000
S_IFLNK = 0o120000


def log(*a):
    print("[mkrootfs]", *a, flush=True)


# ---------------------------------------------------------------------------
# Tải về
# ---------------------------------------------------------------------------

def fetch(url, dest, sha256=None, size=None):
    if os.path.exists(dest):
        if sha256 is None or file_sha256(dest) == sha256:
            return dest
        os.remove(dest)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            break
        except Exception as e:  # mạng chập chờn: thử lại
            if attempt == 4:
                raise
            log("lỗi tải", url, e, "- thử lại")
            time.sleep(2 + attempt * 3)
    if size is not None and os.path.getsize(tmp) != size:
        raise RuntimeError("Sai kích thước: %s" % url)
    if sha256 is not None and file_sha256(tmp) != sha256:
        raise RuntimeError("Sai SHA256: %s" % url)
    os.replace(tmp, dest)
    return dest


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Chỉ mục gói
# ---------------------------------------------------------------------------

def parse_control(text):
    """Tách các stanza dạng deb822. Trả về list (dict trường, văn bản gốc)."""
    out = []
    for raw in re.split(r"\n\s*\n", text.strip("\n")):
        if not raw.strip():
            continue
        fields = {}
        key = None
        for line in raw.split("\n"):
            if line.startswith((" ", "\t")) and key:
                fields[key] += "\n" + line
            else:
                key, _, val = line.partition(":")
                fields[key] = val.strip()
        out.append((fields, raw + "\n"))
    return out


def parse_deps(value):
    """'a (>= 1) | b, c:any' -> [['a','b'], ['c']]"""
    clauses = []
    for clause in value.split(","):
        clause = clause.strip()
        if not clause:
            continue
        alts = []
        for alt in clause.split("|"):
            alt = re.sub(r"\(.*?\)", "", alt)
            alt = re.sub(r"\[.*?\]", "", alt)
            alt = re.sub(r"<.*?>", "", alt)
            alt = alt.strip().split(":")[0].strip()
            if alt:
                alts.append(alt)
        if alts:
            clauses.append(alts)
    return clauses


class Archive:
    def __init__(self, mirror, suite, arch, cache):
        self.mirror = mirror.rstrip("/")
        self.suite = suite
        self.arch = arch
        self.cache = cache
        rel = fetch("%s/dists/%s/Release" % (self.mirror, suite),
                    os.path.join(cache, "dists", suite, "Release"))
        self.release_text = open(rel, encoding="utf-8").read()
        rel_fields = dict(parse_control(self.release_text)[0][0])
        want = "main/binary-%s/Packages.xz" % arch
        m = re.search(r"^ ([0-9a-f]{64})\s+(\d+)\s+%s$" % re.escape(want),
                      rel_fields["SHA256"], re.M)
        if not m:
            raise RuntimeError("Release không có " + want)
        pxz = fetch("%s/dists/%s/%s" % (self.mirror, suite, want),
                    os.path.join(cache, "dists", suite, want.replace("/", "_")),
                    sha256=m.group(1), size=int(m.group(2)))
        self.packages_text = lzma.open(pxz).read().decode("utf-8")
        self.pkgs = {}
        self.raw = {}
        self.provides = {}
        for f, raw in parse_control(self.packages_text):
            if f.get("Architecture") not in (arch, "all"):
                continue
            name = f["Package"]
            self.pkgs[name] = f
            self.raw[name] = raw
            for alts in parse_deps(f.get("Provides", "")):
                for p in alts:
                    self.provides.setdefault(p, []).append(name)
        log("bookworm %s: %s, %d gói" % (
            arch, rel_fields.get("Version", "?"), len(self.pkgs)))

    def version_info(self):
        f = dict(parse_control(self.release_text)[0][0])
        return {k: f.get(k) for k in ("Origin", "Suite", "Codename", "Version", "Date")}

    # Thuật toán resolve_deps của debootstrap (pkgdetails GETDEPS + PKGS REAL):
    # chỉ lấy lựa chọn đầu tiên trong mỗi mệnh đề "a | b", bỏ gói ảo.
    def debootstrap_resolve(self, names, exclude=()):
        allp = set(names)
        todo = set(names)
        while todo:
            new = set()
            for p in todo:
                f = self.pkgs.get(p)
                if not f:
                    continue
                for field in ("Depends", "Pre-Depends"):
                    for alts in parse_deps(f.get(field, "")):
                        new.add(alts[0])
            new -= set(exclude)
            new = {p for p in new if p in self.pkgs}
            todo = new - allp
            allp |= new
        return sorted(p for p in allp if p in self.pkgs)

    # Bao đóng phụ thuộc đầy đủ hơn (có xét Provides) cho kho apt cục bộ.
    # Đây là tập "ứng viên"; apt trong máy ảo mới là bên giải phụ thuộc thật.
    def full_closure(self, names, have=()):
        sel = set()
        have = set(have)
        stack = list(names)

        def satisfied(alts):
            for a in alts:
                if a in sel or a in have:
                    return True
                for prov in self.provides.get(a, []):
                    if prov in sel or prov in have:
                        return True
            return False

        while stack:
            p = stack.pop()
            if p in sel or p in have:
                continue
            if p not in self.pkgs:
                provs = self.provides.get(p)
                if not provs:
                    raise RuntimeError("Không tìm thấy gói: " + p)
                p = provs[0]
                if p in sel or p in have:
                    continue
            sel.add(p)
            f = self.pkgs[p]
            for field in ("Pre-Depends", "Depends"):
                for alts in parse_deps(f.get(field, "")):
                    if satisfied(alts):
                        continue
                    pick = None
                    for a in alts:
                        if a in self.pkgs:
                            pick = a
                            break
                        if self.provides.get(a):
                            pick = self.provides[a][0]
                            break
                    if pick is None:
                        raise RuntimeError("Không giải được phụ thuộc %s của %s" % (alts, p))
                    stack.append(pick)
        return sorted(sel)

    def deb_path(self, name):
        f = self.pkgs[name]
        dest = os.path.join(self.cache, "debs", posixpath.basename(f["Filename"]))
        return fetch("%s/%s" % (self.mirror, f["Filename"]), dest,
                     sha256=f["SHA256"], size=int(f["Size"]))

    def deb_dest_name(self, name):
        # apt_dest deb trong debootstrap: <pkg>_<ver>_<arch>.deb, ':' -> %3a (lần đầu)
        f = self.pkgs[name]
        return ("%s_%s_%s.deb" % (name, f["Version"], f["Architecture"])).replace(":", "%3a", 1)


# ---------------------------------------------------------------------------
# Đọc .deb (định dạng ar)
# ---------------------------------------------------------------------------

def deb_members(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"!<arch>\n":
        raise RuntimeError("Không phải .deb: " + path)
    p = 8
    out = {}
    while p < len(data):
        name = data[p:p + 16].decode().strip().rstrip("/")
        size = int(data[p + 48:p + 58])
        out[name] = data[p + 60:p + 60 + size]
        p += 60 + size + (size & 1)
    return out


def deb_tar(path, prefix):
    for name, body in deb_members(path).items():
        if name.startswith(prefix):
            if name.endswith(".zst"):
                raise RuntimeError("Gói nén zstd chưa được hỗ trợ: " + path)
            return tarfile.open(fileobj=io.BytesIO(body), mode="r:*")
    raise RuntimeError("Không có %s trong %s" % (prefix, path))


# ---------------------------------------------------------------------------
# Cây hệ tệp trong bộ nhớ
# ---------------------------------------------------------------------------

class Node:
    __slots__ = ("mode", "uid", "gid", "mtime", "children", "data", "target")

    def __init__(self, mode, uid=0, gid=0, mtime=0):
        self.mode = mode
        self.uid = uid
        self.gid = gid
        self.mtime = int(mtime)
        self.children = {} if stat.S_ISDIR(mode) else None
        self.data = None      # bytes, hoặc ("file", đường dẫn trên máy dựng)
        self.target = None

    def size(self):
        if stat.S_ISREG(self.mode):
            if isinstance(self.data, tuple):
                return os.path.getsize(self.data[1])
            return len(self.data or b"")
        if stat.S_ISLNK(self.mode):
            return len(self.target.encode())
        return 0


class Tree:
    def __init__(self, mtime):
        self.mtime = int(mtime)
        self.root = Node(S_IFDIR | 0o755, mtime=mtime)

    def _split(self, path):
        return [p for p in path.strip("/").split("/") if p and p != "."]

    def lookup(self, path, follow_last=False, create_dirs=False):
        node = self.root
        parts = self._split(path)
        for i, part in enumerate(parts):
            if node.children is None:
                return None
            nxt = node.children.get(part)
            if nxt is None:
                if not create_dirs:
                    return None
                nxt = Node(S_IFDIR | 0o755, mtime=self.mtime)
                node.children[part] = nxt
            if stat.S_ISLNK(nxt.mode) and (i < len(parts) - 1 or follow_last):
                # chỉ hỗ trợ liên kết tương đối/tuyệt đối tới thư mục (vd. /bin -> usr/bin)
                tgt = nxt.target
                base = "/".join(parts[:i]) if not tgt.startswith("/") else ""
                resolved = posixpath.normpath(posixpath.join("/" + base, tgt))
                nxt = self.lookup(resolved, follow_last=True, create_dirs=create_dirs)
                if nxt is None:
                    return None
            node = nxt
        return node

    def parent_and_name(self, path):
        parts = self._split(path)
        parent = self.lookup("/".join(parts[:-1]), follow_last=True, create_dirs=True)
        return parent, parts[-1]

    def mkdir(self, path, mode=0o755, uid=0, gid=0):
        parent, name = self.parent_and_name(path)
        node = parent.children.get(name)
        if node is None:
            node = Node(S_IFDIR | mode, uid, gid, self.mtime)
            parent.children[name] = node
        return node

    def add_file(self, path, data, mode=0o644, uid=0, gid=0, mtime=None, overwrite=True):
        parent, name = self.parent_and_name(path)
        if name in parent.children and not overwrite:
            return parent.children[name]
        node = Node(S_IFREG | mode, uid, gid, self.mtime if mtime is None else mtime)
        node.data = data
        parent.children[name] = node
        return node

    def add_symlink(self, path, target, overwrite=True, mtime=None):
        parent, name = self.parent_and_name(path)
        if name in parent.children and not overwrite:
            return parent.children[name]
        node = Node(S_IFLNK | 0o777, mtime=self.mtime if mtime is None else mtime)
        node.target = target
        parent.children[name] = node
        return node

    def remove(self, path):
        parent, name = self.parent_and_name(path)
        parent.children.pop(name, None)

    def add_tree_from_dir(self, src, dest, uid=0, gid=0):
        """Chép một thư mục của repo (overlay) vào cây; giữ bit thực thi."""
        for dirpath, dirnames, filenames in os.walk(src):
            rel = os.path.relpath(dirpath, src).replace(os.sep, "/")
            base = dest if rel == "." else posixpath.join(dest, rel)
            self.mkdir(base, uid=uid, gid=gid)
            for fn in sorted(filenames):
                full = os.path.join(dirpath, fn)
                data = open(full, "rb").read()
                mode = 0o644
                if data.startswith(b"#!") or (os.stat(full).st_mode & 0o111 and os.name != "nt"):
                    mode = 0o755
                if fn.endswith((".sh",)) or "/sbin/" in "/" + posixpath.join(base, fn) or "/bin/" in "/" + posixpath.join(base, fn):
                    if data.startswith(b"#!"):
                        mode = 0o755
                # tệp có hậu tố .mode-XXX đặt quyền tường minh, vd. sudoers.mode-440
                m = re.match(r"^(.*)\.mode-([0-7]{3,4})$", fn)
                name = fn
                if m:
                    name, mode = m.group(1), int(m.group(2), 8)
                if b"\r\n" in data and not fn.endswith((".bin", ".png")):
                    data = data.replace(b"\r\n", b"\n")
                self.add_file(posixpath.join(base, name), data, mode=mode, uid=uid, gid=gid)


MERGED_DIRS = ("bin", "sbin", "lib", "lib32", "lib64", "libo32", "libx32")


def extract_deb_into(tree, debpath, seen_top):
    """Giải nén data.tar của .deb vào cây (tar -k: không ghi đè tệp đã có),
    đồng thời thực hiện merge_usr: /bin,/sbin,/lib... -> /usr/..."""
    t = deb_tar(debpath, "data.tar")
    members = t.getmembers()
    by_name = {}
    for m in members:
        name = m.name
        if name.startswith("./"):
            name = name[2:]
        name = name.strip("/")
        if not name:
            continue
        top = name.split("/")[0]
        if top in MERGED_DIRS:
            seen_top.add(top)
            name = "usr/" + name
        by_name[m.name] = name
        if m.isdir():
            node = tree.lookup(name)
            if node is None:
                tree.mkdir(name, mode=m.mode & 0o7777, uid=m.uid, gid=m.gid).mtime = m.mtime
        elif m.issym():
            tree.add_symlink(name, m.linkname, overwrite=False, mtime=m.mtime)
        elif m.isfile():
            data = t.extractfile(m).read()
            tree.add_file(name, data, mode=m.mode & 0o7777, uid=m.uid, gid=m.gid,
                          mtime=m.mtime, overwrite=False)
        elif m.islnk():
            src = m.linkname[2:] if m.linkname.startswith("./") else m.linkname
            top = src.strip("/").split("/")[0]
            if top in MERGED_DIRS:
                src = "usr/" + src.strip("/")
            node = tree.lookup(src)
            if node is not None and node.data is not None:
                tree.add_file(name, node.data, mode=m.mode & 0o7777, uid=m.uid,
                              gid=m.gid, mtime=m.mtime, overwrite=False)
        # thiết bị/FIFO: không có trong gói Debian thông thường


# ---------------------------------------------------------------------------
# Xuất định dạng 9p của v86
# ---------------------------------------------------------------------------

def write_v86_fs(tree, out_json, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    seen = {}
    total = [0]
    count = [0]

    def emit(name, node):
        size = node.size()
        total[0] += size
        count[0] += 1
        obj = [name, size, node.mtime, node.mode, node.uid, node.gid]
        if stat.S_ISDIR(node.mode):
            obj.append([emit(k, node.children[k]) for k in sorted(node.children)])
        elif stat.S_ISLNK(node.mode):
            obj.append(node.target)
        elif stat.S_ISREG(node.mode):
            if isinstance(node.data, tuple):
                path = node.data[1]
                h = file_sha256(path)
                fn = h[:10] + ".bin"
                if fn not in seen:
                    seen[fn] = h
                    dst = os.path.join(out_dir, fn)
                    if not os.path.exists(dst):
                        shutil.copyfile(path, dst)
            else:
                data = node.data or b""
                h = hashlib.sha256(data).hexdigest()
                fn = h[:10] + ".bin"
                if fn not in seen:
                    seen[fn] = h
                    dst = os.path.join(out_dir, fn)
                    if not os.path.exists(dst):
                        with open(dst, "wb") as f:
                            f.write(data)
            assert seen[fn] == h, "Trùng hash ngắn"
            obj.append(fn)
        return obj

    root = [emit(k, tree.root.children[k]) for k in sorted(tree.root.children)]
    with open(out_json, "w") as f:
        json.dump({"fsroot": root, "version": 3, "size": total[0]}, f, separators=(",", ":"))
    log("fs.json: %d mục, %.1f MB, %d tệp duy nhất" % (count[0], total[0] / 1e6, len(seen)))


# ---------------------------------------------------------------------------
# Kernel + initrd
# ---------------------------------------------------------------------------

INITRD_MODULES = ["virtio_pci", "9pnet_virtio", "9p", "virtio_console"]


def cpio_newc(entries):
    """entries: list (path, mode, data_bytes_or_target). Định dạng 'newc'."""
    out = io.BytesIO()
    ino = 1

    def pad(n):
        return (4 - n % 4) % 4

    for path, mode, data in entries + [("TRAILER!!!", 0, b"")]:
        if isinstance(data, str):
            data = data.encode()
        name = path.encode() + b"\0"
        hdr = "070701%08X%08X%08X%08X%08X%08X%08X%08X%08X%08X%08X%08X%08X" % (
            ino, mode, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(name), 0)
        out.write(hdr.encode())
        out.write(name)
        out.write(b"\0" * pad(110 + len(name)))
        out.write(data)
        out.write(b"\0" * pad(len(data)))
        ino += 1
    return out.getvalue()


def modinfo_depends(ko):
    m = re.search(rb"(?:^|\x00)depends=([^\x00]*)\x00", ko)
    if not m or not m.group(1):
        return []
    return [d.decode() for d in m.group(1).split(b",") if d]


def build_kernel(archive, kpkg, out_dir, tree, init_script):
    deb = archive.deb_path(kpkg)
    t = deb_tar(deb, "data.tar")
    kver = None
    vmlinuz = None
    modules = {}       # tên module -> (đường dẫn tương đối, bytes)
    builtin = set()
    keep_prefixes = ("kernel/fs/", "kernel/net/9p/", "kernel/net/core/", "kernel/drivers/virtio/",
                     "kernel/drivers/char/", "kernel/drivers/net/virtio_net", "kernel/drivers/net/net_failover",
                     "kernel/net/core/failover", "kernel/lib/", "kernel/crypto/", "kernel/arch/",
                     "kernel/drivers/block/virtio_blk", "kernel/drivers/block/loop", "kernel/net/packet/",
                     "kernel/net/unix/", "kernel/net/ipv6/", "kernel/drivers/md/")
    for m in t.getmembers():
        name = m.name[2:] if m.name.startswith("./") else m.name
        if name.startswith("boot/vmlinuz-"):
            kver = name[len("boot/vmlinuz-"):]
            vmlinuz = t.extractfile(m).read()
        mm = re.match(r"lib/modules/([^/]+)/(.*)$", name)
        if mm and m.isfile():
            rel = mm.group(2)
            data = t.extractfile(m).read()
            if rel.endswith(".ko"):
                modules[posixpath.basename(rel)[:-3].replace("-", "_")] = (rel, data)
            if rel == "modules.builtin":
                builtin = {posixpath.basename(l.strip())[:-3].replace("-", "_")
                           for l in data.decode().splitlines() if l.strip()}
            if rel.startswith(keep_prefixes) or not rel.endswith(".ko"):
                tree.add_file("usr/lib/modules/%s/%s" % (mm.group(1), rel), data,
                              mode=m.mode & 0o7777, mtime=m.mtime)
    if not vmlinuz:
        raise RuntimeError("Không tìm thấy vmlinuz trong " + kpkg)
    tree.add_file("boot/vmlinuz-" + kver, vmlinuz, mode=0o644)

    order = []

    def visit(name):
        name = name.replace("-", "_")
        if name in order or name in builtin:
            return
        if name not in modules:
            raise RuntimeError("Thiếu module " + name)
        for dep in modinfo_depends(modules[name][1]):
            visit(dep)
        order.append(name)

    for m in INITRD_MODULES:
        visit(m)
    log("kernel %s, module initrd: %s" % (kver, " ".join(order)))

    bb = deb_tar(archive.deb_path("busybox-static"), "data.tar")
    busybox = None
    for m in bb.getmembers():
        if m.name.endswith("bin/busybox") and m.isfile():
            busybox = bb.extractfile(m).read()
    entries = [
        ("bin", S_IFDIR | 0o755, b""), ("dev", S_IFDIR | 0o755, b""), ("proc", S_IFDIR | 0o755, b""),
        ("sys", S_IFDIR | 0o755, b""), ("root", S_IFDIR | 0o755, b""), ("modules", S_IFDIR | 0o755, b""),
        ("bin/busybox", S_IFREG | 0o755, busybox),
        ("bin/sh", S_IFLNK | 0o777, "busybox"),
        ("init", S_IFREG | 0o755, open(init_script, "rb").read().replace(b"\r\n", b"\n")),
        ("modules/load.txt", S_IFREG | 0o644, "".join(n + ".ko\n" for n in order)),
    ]
    for n in order:
        entries.append(("modules/%s.ko" % n, S_IFREG | 0o644, modules[n][1]))
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "bzImage"), "wb") as f:
        f.write(vmlinuz)
    with open(os.path.join(out_dir, "initrd.img"), "wb") as f:
        f.write(gzip.compress(cpio_newc(entries), 9, mtime=0))
    return kver


# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(HERE, ".."))


def safe_rmtree(path):
    """Chỉ cho phép xoá bên trong thư mục dự án (quy tắc an toàn)."""
    p = os.path.abspath(path)
    if os.path.commonpath([p, REPO_ROOT]) != REPO_ROOT or p == REPO_ROOT:
        raise RuntimeError("Từ chối xoá ngoài thư mục dự án: " + p)
    shutil.rmtree(p)


def read_list(path):
    out = []
    for line in open(path, encoding="utf-8"):
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


def main():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap =argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", default=os.environ.get("LTHT_BUILD_DIR", os.path.join(HERE, "..", ".build")),
                    help="thư mục làm việc, PHẢI nằm trong thư mục dự án")
    ap.add_argument("--mirror", default="https://deb.debian.org/debian",
                    help="mirror Debian, vd. https://snapshot.debian.org/archive/debian/20261001T000000Z")
    ap.add_argument("--guest-mirror", default="http://deb.debian.org/debian",
                    help="mirror ghi vào /etc/apt/sources.list của máy ảo")
    ap.add_argument("--suite", default="bookworm")
    ap.add_argument("--arch", default="i386")
    ap.add_argument("--packages", default=os.path.join(HERE, "packages.txt"))
    args = ap.parse_args()

    work = os.path.abspath(args.work)
    if os.path.commonpath([work, REPO_ROOT]) != REPO_ROOT:
        sys.exit("Thư mục làm việc phải nằm trong dự án (%s): %s" % (REPO_ROOT, work))
    cache = os.path.join(work, "cache")
    stage1 = os.path.join(work, "stage1")
    arc = Archive(args.mirror, args.suite, args.arch, cache)

    # --- tập gói giống debootstrap --variant=minbase ---
    required = [p for p, f in arc.pkgs.items() if f.get("Priority") == "required"]
    required.append("usr-is-merged")
    required = arc.debootstrap_resolve(required, exclude=["usrmerge"])
    base = [p for p in arc.debootstrap_resolve(["apt"], exclude=["usrmerge"]) if p not in required]
    extras_wanted = read_list(args.packages)
    extras = [p for p in arc.full_closure(extras_wanted, have=required + base)]
    log("required: %d gói, base: %d gói, bổ sung: %d gói" % (len(required), len(base), len(extras)))

    kpkg = [d for d in parse_deps(arc.pkgs["linux-image-686"]["Depends"])][0][0]

    all_pkgs = sorted(set(required + base + extras + [kpkg, "busybox-static", "debootstrap"]))
    total = sum(int(arc.pkgs[p]["Size"]) for p in all_pkgs)
    log("tải %d gói (%.1f MB, có cache)..." % (len(all_pkgs), total / 1e6))
    for i, p in enumerate(all_pkgs):
        arc.deb_path(p)
        if (i + 1) % 50 == 0:
            log("  %d/%d" % (i + 1, len(all_pkgs)))

    mtime = int(time.time())
    tree = Tree(mtime)

    # --- extract $required + merge_usr (first_stage_install) ---
    seen_top = set()
    for p in required:
        extract_deb_into(tree, arc.deb_path(p), seen_top)
    for top in sorted(seen_top):
        tree.add_symlink(top, "usr/" + top)
    for d in ("proc", "sys", "dev", "run", "tmp", "root", "home", "mnt"):
        tree.mkdir(d)
    tree.lookup("tmp").mode = S_IFDIR | 0o1777
    tree.lookup("root").mode = S_IFDIR | 0o700
    tree.add_file("var/lib/dpkg/status", b"")
    tree.add_file("var/lib/dpkg/available", b"")
    tree.add_file("etc/fstab", b"# UNCONFIGURED FSTAB FOR BASE SYSTEM\n")
    tree.add_file("etc/hostname", b"tuxlab\n")
    tree.add_file("etc/resolv.conf", b"nameserver 192.168.86.1\n")

    # --- /debootstrap: những gì --foreign để lại cho --second-stage ---
    dsrc = deb_tar(arc.deb_path("debootstrap"), "data.tar")
    dfiles = {}
    for m in dsrc.getmembers():
        n = m.name[2:] if m.name.startswith("./") else m.name
        if m.isfile():
            dfiles[n] = dsrc.extractfile(m).read()
        elif m.issym():
            dfiles[n] = ("link", m.linkname)
    scripts = "usr/share/debootstrap/scripts/"
    suite_script = dfiles[scripts + args.suite]
    while isinstance(suite_script, tuple):
        suite_script = dfiles[scripts + posixpath.basename(suite_script[1])]
    tree.add_file("debootstrap/debootstrap", dfiles["usr/sbin/debootstrap"], mode=0o755)
    tree.add_file("debootstrap/functions", dfiles["usr/share/debootstrap/functions"])
    tree.add_file("debootstrap/suite-script", suite_script)
    for n, d in dfiles.items():
        if n.startswith(scripts) and n.endswith("-common") and isinstance(d, bytes):
            tree.add_file("debootstrap/" + posixpath.basename(n), d)
    mirror_guest = args.guest_mirror.rstrip("/")
    tree.add_file("debootstrap/arch", (args.arch + "\n").encode())
    tree.add_file("debootstrap/suite", (args.suite + "\n").encode())
    tree.add_file("debootstrap/extra-suites", b"\n")
    tree.add_file("debootstrap/mirror", (mirror_guest + "\n").encode())
    tree.add_file("debootstrap/variant", b"minbase\n")
    tree.add_file("debootstrap/required", (" ".join(required) + "\n").encode())
    tree.add_file("debootstrap/base", (" ".join(base) + "\n").encode())
    debpaths = []
    deburis = []
    for p in required + base:
        dest = "/var/cache/apt/archives/" + arc.deb_dest_name(p)
        tree.add_file(dest.lstrip("/"), ("file", arc.deb_path(p)))
        debpaths.append("%s %s\n" % (p, dest))
        deburis.append("%s %s %s/%s\n" % (p, arc.pkgs[p]["Version"], mirror_guest, arc.pkgs[p]["Filename"]))
    tree.add_file("debootstrap/debpaths", "".join(debpaths).encode())
    tree.add_file("debootstrap/deburis", "".join(deburis).encode())
    tree.mkdir("var/cache/apt/archives/partial")
    tree.mkdir("var/lib/apt/lists/partial")
    lists_name = re.sub(r"^[^:]+://", "", mirror_guest) + "_dists/%s/main/binary-%s/Packages" % (args.suite, args.arch)
    tree.add_file("var/lib/apt/lists/" + lists_name.replace("/", "_"), arc.packages_text.encode())

    # --- kho apt cục bộ cho các gói bổ sung (apt trong máy ảo tự giải phụ thuộc) ---
    repo = "var/local/ltht-repo/"
    stanzas = []
    for p in sorted(set(extras + required + base)):
        fn = arc.deb_dest_name(p)
        tree.add_file(repo + fn, ("file", arc.deb_path(p)))
        raw = re.sub(r"^Filename: .*$", "Filename: ./" + fn, arc.raw[p], flags=re.M)
        stanzas.append(raw.rstrip("\n") + "\n\n")
    tree.add_file(repo + "Packages", "".join(stanzas).encode())

    # --- tệp của dự án: script giai đoạn 2, overlay cấu hình, bài mẫu ---
    tree.add_file("ltht/stage2.sh", open(os.path.join(HERE, "stage2.sh"), "rb").read().replace(b"\r\n", b"\n"), mode=0o755)
    tree.add_file("ltht/packages.txt", ("\n".join(extras_wanted) + "\n").encode())
    tree.add_tree_from_dir(os.path.join(HERE, "overlay"), "ltht/overlay")
    tree.add_tree_from_dir(os.path.join(HERE, "..", "samples"), "ltht/samples")

    kout = os.path.join(work, "kernel")
    kver = build_kernel(arc, kpkg, kout, tree, os.path.join(HERE, "initrd-init.sh"))

    if os.path.isdir(stage1):
        safe_rmtree(stage1)
    write_v86_fs(tree, os.path.join(stage1, "fs.json"), os.path.join(stage1, "flat"))
    info = {
        "release": arc.version_info(),
        "mirror": args.mirror,
        "kernel": kver,
        "kernel_package": "%s %s" % (kpkg, arc.pkgs[kpkg]["Version"]),
        "required": {p: arc.pkgs[p]["Version"] for p in required},
        "base": {p: arc.pkgs[p]["Version"] for p in base},
        "candidates": {p: arc.pkgs[p]["Version"] for p in extras},
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(mtime)),
    }
    with open(os.path.join(stage1, "stage1.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, indent=1, ensure_ascii=False)
    log("xong giai đoạn 1 ->", stage1)


if __name__ == "__main__":
    main()

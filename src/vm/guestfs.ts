// Truy cập trực tiếp hệ tệp 9p của máy ảo (đối tượng FS của v86 trong JS).
// Terminal (Linux trong guest) và giao diện web cùng thao tác trên MỘT cây
// inode, nên thay đổi ở bên nào cũng thấy ngay ở bên kia (guest gắn 9p với
// cache=none nên không giữ bản sao cũ).

export const S_IFMT = 0o170000;
export const S_IFDIR = 0o040000;
export const S_IFREG = 0o100000;
export const S_IFLNK = 0o120000;

export const STUDENT_UID = 1000;
export const STUDENT_GID = 1000;
export const HOME = "/home/student";

export type EntryType = "dir" | "file" | "link" | "other";
export interface Entry {
    name: string;
    path: string;
    type: EntryType;
    size: number;
    mtime: number;
    mode: number;
    uid: number;
    gid: number;
    target?: string;
    /** Kiểu của đích (nếu là liên kết) */
    targetType?: EntryType;
}

export class FsError extends Error {
    constructor(public code: string, message: string) { super(message); }
}

export function normalize(p: string): string {
    const out: string[] = [];
    for(const part of p.split("/")) {
        if(!part || part === ".") continue;
        if(part === "..") out.pop(); else out.push(part);
    }
    return "/" + out.join("/");
}

export function dirname(p: string): string {
    const n = normalize(p);
    const i = n.lastIndexOf("/");
    return i <= 0 ? "/" : n.slice(0, i);
}

export function basename(p: string): string {
    const n = normalize(p);
    return n.slice(n.lastIndexOf("/") + 1);
}

export function join(...parts: string[]): string {
    return normalize(parts.join("/"));
}

function typeOf(mode: number): EntryType {
    switch(mode & S_IFMT) {
        case S_IFDIR: return "dir";
        case S_IFREG: return "file";
        case S_IFLNK: return "link";
        default: return "other";
    }
}

export class GuestFS extends EventTarget {
    /** Tăng mỗi khi cây thay đổi (do guest hoặc do giao diện). */
    version = 0;
    private timer: any = null;

    constructor(public fs: any) {
        super();
        const notify = () => this.changed();
        for(const name of ["CreateDirectory", "CreateFile", "CreateSymlink", "CreateNode", "Rename",
                           "Unlink", "Link", "ChangeSize", "set_data"]) {
            const orig = fs[name];
            if(typeof orig !== "function") continue;
            fs[name] = function(this: any, ...args: any[]) {
                const r = orig.apply(this, args);
                notify();
                return r;
            };
        }
    }

    private changed() {
        this.version++;
        if(this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.dispatchEvent(new Event("change"));
        }, 120);
    }

    // ---- tra cứu ----

    /** id inode theo đường dẫn, không đi theo liên kết ở thành phần cuối. */
    lookup(path: string, followLast = false): number {
        let parts = normalize(path).split("/").filter(Boolean);
        let id = 0;
        let hops = 0;
        for(let i = 0; i < parts.length; i++) {
            const next = this.fs.Search(id, parts[i]);
            if(next === -1) return -1;
            const inode = this.fs.inodes[next];
            const isLast = i === parts.length - 1;
            if((inode.mode & S_IFMT) === S_IFLNK && (!isLast || followLast)) {
                if(++hops > 40) throw new FsError("ELOOP", "Quá nhiều liên kết tượng trưng");
                const base = inode.symlink.startsWith("/") ? [] : parts.slice(0, i);
                parts = normalize([...base, inode.symlink, ...parts.slice(i + 1)].join("/")).split("/").filter(Boolean);
                id = 0;
                i = -1;
                continue;
            }
            id = next;
        }
        return id;
    }

    exists(path: string): boolean { return this.lookup(path) !== -1; }

    private entry(id: number, path: string): Entry {
        const inode = this.fs.inodes[id];
        const e: Entry = {
            name: basename(path) || "/",
            path: normalize(path),
            type: typeOf(inode.mode),
            size: inode.size,
            mtime: inode.mtime,
            mode: inode.mode,
            uid: inode.uid,
            gid: inode.gid,
        };
        if(e.type === "link") {
            e.target = inode.symlink;
            try {
                const t = this.lookup(path, true);
                e.targetType = t === -1 ? undefined : typeOf(this.fs.inodes[t].mode);
            } catch { e.targetType = undefined; }
        }
        return e;
    }

    stat(path: string, follow = true): Entry | null {
        const id = this.lookup(path, follow);
        return id === -1 ? null : this.entry(id, path);
    }

    list(path: string): Entry[] {
        const id = this.lookup(path, true);
        if(id === -1) throw new FsError("ENOENT", "Không tồn tại: " + path);
        const inode = this.fs.inodes[id];
        if((inode.mode & S_IFMT) !== S_IFDIR) throw new FsError("ENOTDIR", "Không phải thư mục: " + path);
        const out: Entry[] = [];
        for(const [name, cid] of inode.direntries) {
            if(name === "." || name === "..") continue;
            out.push(this.entry(cid, join(path, name)));
        }
        return out;
    }

    async read(path: string): Promise<Uint8Array> {
        const id = this.lookup(path, true);
        if(id === -1) throw new FsError("ENOENT", "Không tồn tại: " + path);
        const inode = this.fs.inodes[id];
        if((inode.mode & S_IFMT) !== S_IFREG) throw new FsError("EISDIR", "Không phải tệp thường: " + path);
        const data: Uint8Array | null = await this.fs.Read(id, 0, inode.size);
        return data ? data.slice(0, inode.size) : new Uint8Array(0);
    }

    async readText(path: string): Promise<string> {
        return new TextDecoder().decode(await this.read(path));
    }

    // ---- quyền (giao diện thao tác với tư cách người dùng student) ----

    private canWrite(id: number): boolean {
        const inode = this.fs.inodes[id];
        if(inode.uid === STUDENT_UID) return (inode.mode & 0o200) !== 0;
        if(inode.gid === STUDENT_GID) return (inode.mode & 0o020) !== 0;
        return (inode.mode & 0o002) !== 0;
    }

    private requireWritableDir(dirId: number, path: string) {
        if(!this.canWrite(dirId)) {
            throw new FsError("EACCES", `Không có quyền ghi vào thư mục ${path} (Permission denied). ` +
                "Hãy dùng terminal với sudo nếu thực sự cần.");
        }
    }

    private parentOf(path: string): { pid: number, name: string } {
        const dir = dirname(path);
        const name = basename(path);
        if(!name) throw new FsError("EINVAL", "Đường dẫn không hợp lệ");
        if(name.includes("/") || name === "." || name === "..") throw new FsError("EINVAL", "Tên không hợp lệ");
        const pid = this.lookup(dir, true);
        if(pid === -1) throw new FsError("ENOENT", "Thư mục cha không tồn tại: " + dir);
        if((this.fs.inodes[pid].mode & S_IFMT) !== S_IFDIR) throw new FsError("ENOTDIR", dir + " không phải thư mục");
        return { pid, name };
    }

    private touch(id: number) {
        const inode = this.fs.inodes[id];
        const now = Math.floor(Date.now() / 1000);
        inode.mtime = inode.ctime = now;
        inode.qid.version++;
    }

    // ---- thay đổi ----

    async write(path: string, data: Uint8Array | string, opts: { mode?: number } = {}): Promise<void> {
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        let id = this.lookup(path, true);
        if(id === -1) {
            const { pid, name } = this.parentOf(path);
            this.requireWritableDir(pid, dirname(path));
            id = this.fs.CreateFile(name, pid);
            const inode = this.fs.inodes[id];
            inode.uid = STUDENT_UID;
            inode.gid = STUDENT_GID;
            inode.mode = S_IFREG | (opts.mode ?? 0o644);
            this.touch(pid);
        } else {
            const inode = this.fs.inodes[id];
            if((inode.mode & S_IFMT) !== S_IFREG) throw new FsError("EISDIR", path + " không phải tệp thường");
            if(!this.canWrite(id)) throw new FsError("EACCES", `Không có quyền ghi ${path} (Permission denied)`);
        }
        const buf = new Uint8Array(bytes.length);
        buf.set(bytes);
        await this.fs.set_data(id, buf);
        this.fs.inodes[id].size = buf.length;
        this.touch(id);
    }

    mkdir(path: string): void {
        if(this.exists(path)) throw new FsError("EEXIST", "Đã tồn tại: " + basename(path));
        const { pid, name } = this.parentOf(path);
        this.requireWritableDir(pid, dirname(path));
        const id = this.fs.CreateDirectory(name, pid);
        const inode = this.fs.inodes[id];
        inode.uid = STUDENT_UID;
        inode.gid = STUDENT_GID;
        inode.mode = S_IFDIR | 0o755;
        this.touch(pid);
    }

    /** mkdir -p (dùng khi nhập zip / tải lên thư mục). */
    mkdirp(path: string): void {
        let cur = "";
        for(const part of normalize(path).split("/").filter(Boolean)) {
            cur += "/" + part;
            const st = this.stat(cur);
            if(!st) this.mkdir(cur);
            else if(st.type !== "dir") throw new FsError("ENOTDIR", cur + " không phải thư mục");
        }
    }

    async rename(from: string, to: string): Promise<void> {
        from = normalize(from);
        to = normalize(to);
        if(from === to) return;
        if(to.startsWith(from + "/")) throw new FsError("EINVAL", "Không thể chuyển thư mục vào bên trong chính nó");
        const src = this.parentOf(from);
        if(this.fs.Search(src.pid, src.name) === -1) throw new FsError("ENOENT", "Không tồn tại: " + from);
        const dst = this.parentOf(to);
        this.requireWritableDir(src.pid, dirname(from));
        this.requireWritableDir(dst.pid, dirname(to));
        if(this.fs.Search(dst.pid, dst.name) !== -1) throw new FsError("EEXIST", "Đích đã tồn tại: " + basename(to));
        const ret = await this.fs.Rename(src.pid, src.name, dst.pid, dst.name);
        if(ret < 0) throw new FsError("EIO", "Đổi tên thất bại (mã " + ret + ")");
        this.touch(src.pid);
        this.touch(dst.pid);
    }

    remove(path: string): void {
        path = normalize(path);
        if(path === "/" || path === HOME) throw new FsError("EPERM", "Không thể xoá " + path);
        const { pid, name } = this.parentOf(path);
        const id = this.fs.Search(pid, name);
        if(id === -1) return;
        this.requireWritableDir(pid, dirname(path));
        this.removeTree(pid, name);
        this.touch(pid);
    }

    private removeTree(pid: number, name: string) {
        const id = this.fs.Search(pid, name);
        if(id === -1) return;
        const inode = this.fs.inodes[id];
        if((inode.mode & S_IFMT) === S_IFDIR) {
            for(const child of [...inode.direntries.keys()]) {
                if(child !== "." && child !== "..") this.removeTree(id, child);
            }
        }
        const ret = this.fs.Unlink(pid, name);
        if(ret < 0) throw new FsError("EIO", "Xoá thất bại: " + name + " (mã " + ret + ")");
    }

    async copy(from: string, to: string): Promise<void> {
        const st = this.stat(from, false);
        if(!st) throw new FsError("ENOENT", "Không tồn tại: " + from);
        if(this.exists(to)) throw new FsError("EEXIST", "Đích đã tồn tại: " + basename(to));
        if(st.type === "dir") {
            this.mkdir(to);
            for(const e of this.list(from)) await this.copy(e.path, join(to, e.name));
        } else if(st.type === "file") {
            await this.write(to, await this.read(from), { mode: st.mode & 0o777 });
        } else if(st.type === "link") {
            const { pid, name } = this.parentOf(to);
            this.requireWritableDir(pid, dirname(to));
            const id = this.fs.CreateSymlink(name, pid, st.target);
            this.fs.inodes[id].uid = STUDENT_UID;
            this.fs.inodes[id].gid = STUDENT_GID;
        }
    }

    chmod(path: string, mode: number) {
        const id = this.lookup(path, true);
        if(id === -1) throw new FsError("ENOENT", "Không tồn tại: " + path);
        const inode = this.fs.inodes[id];
        if(inode.uid !== STUDENT_UID) throw new FsError("EPERM", "Chỉ chủ sở hữu mới đổi được quyền (Operation not permitted)");
        inode.mode = (inode.mode & S_IFMT) | (mode & 0o7777);
        inode.ctime = Math.floor(Date.now() / 1000);
        this.changed();
    }

    /** Duyệt đệ quy (không đi theo liên kết). */
    *walk(path: string): Generator<Entry> {
        const st = this.stat(path, false);
        if(!st) return;
        yield st;
        if(st.type === "dir") {
            for(const e of this.list(path).sort((a, b) => a.name.localeCompare(b.name))) yield* this.walk(e.path);
        }
    }

    /** Tạo tên chưa dùng: "Thư mục mới", "Thư mục mới (2)", ... */
    uniqueName(dir: string, base: string, ext = ""): string {
        let name = base + ext;
        for(let i = 2; this.exists(join(dir, name)); i++) name = `${base} (${i})${ext}`;
        return name;
    }
}

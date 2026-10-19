// Lưu bền vững đĩa của máy ảo vào IndexedDB.
//
// Ý tưởng: ảnh chụp máy (snapshot) luôn là trạng thái "sạch" ngay sau khi
// khởi động ảnh gốc. Mọi thay đổi của người dùng (trong terminal hay giao
// diện) được lưu riêng dưới dạng chênh lệch theo đường dẫn:
//   files/<path>   : bản ghi đầy đủ của tệp/thư mục/liên kết khác với bản sạch
//   deleted/<path> : đường dẫn có trong bản sạch nhưng đã bị xoá
// Khi mở lại: khôi phục ảnh chụp sạch -> áp chênh lệch -> chạy tiếp.
// Việc so sánh dùng "chữ ký" (mode, chủ sở hữu, mtime, kích thước, phiên bản
// nội dung) của từng inode nên mỗi lần quét chỉ mất vài chục ms.

import * as idb from "./idb";
import { S_IFMT, S_IFDIR, S_IFREG, S_IFLNK } from "./guestfs";

const VOLATILE = ["/proc", "/sys", "/dev", "/run", "/tmp", "/var/tmp", "/var/log", "/var/cache/apt",
                  "/var/cache/man", "/var/lib/apt/lists"];

export interface FileRecord {
    t: "d" | "f" | "l";
    mode: number;
    uid: number;
    gid: number;
    mtime: number;
    target?: string;
    data?: Uint8Array;
}

interface Sig { sig: string; idx: number; }

function isVolatile(path: string) {
    for(const v of VOLATILE) if(path === v || path.startsWith(v + "/")) return true;
    return false;
}

export class Persistence {
    private baseline = new Map<string, string>();
    private saved = new Map<string, string>();
    private savedDeleted = new Set<string>();
    private contentVersion = new Map<number, number>();
    private busy = false;
    private timer: any = null;
    lastSaveTime = 0;
    lastError: string | null = null;
    onSaved: ((info: { changed: number, total: number }) => void) | null = null;

    constructor(private fs: any) {
        // Đánh dấu mỗi lần nội dung tệp đổi (ghi từ guest hoặc từ giao diện).
        const self = this;
        const orig = fs.set_data;
        fs.set_data = function(this: any, idx: number, buf: Uint8Array) {
            self.contentVersion.set(idx, (self.contentVersion.get(idx) || 0) + 1);
            return orig.call(this, idx, buf);
        };
        const origSize = fs.ChangeSize;
        fs.ChangeSize = function(this: any, idx: number, size: number) {
            self.contentVersion.set(idx, (self.contentVersion.get(idx) || 0) + 1);
            return origSize.call(this, idx, size);
        };
    }

    private scan(): Map<string, Sig> {
        const out = new Map<string, Sig>();
        const inodes = this.fs.inodes;
        const cv = this.contentVersion;
        const walk = (idx: number, path: string) => {
            const ino = inodes[idx];
            const type = ino.mode & S_IFMT;
            let sig = ino.mode + ":" + ino.uid + ":" + ino.gid + ":" + ino.mtime + ":" + ino.size + ":" + idx + ":" + (cv.get(idx) || 0);
            if(type === S_IFLNK) sig += ":" + ino.symlink;
            if(path) out.set(path, { sig, idx });
            if(type === S_IFDIR && !isVolatile(path)) {
                for(const [name, cid] of ino.direntries) {
                    if(name === "." || name === "..") continue;
                    walk(cid, path + "/" + name);
                }
            }
        };
        walk(0, "");
        return out;
    }

    /** Ghi nhận trạng thái sạch (ngay sau khôi phục/khởi động, trước khi áp chênh lệch). */
    captureBaseline() {
        this.baseline.clear();
        for(const [p, s] of this.scan()) this.baseline.set(p, s.sig);
    }

    /** Áp các thay đổi đã lưu vào hệ tệp đang chạy. Trả về số mục đã áp. */
    async apply(): Promise<number> {
        const [files, deleted] = await Promise.all([idb.getAll<FileRecord>("files"), idb.keys("deleted")]);
        const fs = this.fs;
        const depth = (p: string) => p.split("/").length;
        const search = (path: string): { pid: number, id: number, name: string } => {
            const parts = path.split("/").filter(Boolean);
            let pid = -1, id = 0;
            for(const part of parts) {
                if(id === -1) return { pid: -1, id: -1, name: part };
                pid = id;
                id = fs.Search(pid, part);
            }
            return { pid, id, name: parts[parts.length - 1] };
        };
        const removeTree = (pid: number, name: string) => {
            const id = fs.Search(pid, name);
            if(id === -1) return;
            const ino = fs.inodes[id];
            if((ino.mode & S_IFMT) === S_IFDIR) {
                for(const c of [...ino.direntries.keys()]) if(c !== "." && c !== "..") removeTree(id, c);
            }
            fs.Unlink(pid, name);
        };

        deleted.sort((a, b) => depth(b) - depth(a));
        for(const p of deleted) {
            const r = search(p);
            if(r.id !== -1 && r.pid !== -1) removeTree(r.pid, r.name);
        }

        files.sort((a, b) => depth(a[0]) - depth(b[0]) || (a[0] < b[0] ? -1 : 1));
        let applied = 0;
        for(const [path, rec] of files) {
            let r = search(path);
            if(r.pid === -1) continue;               // thư mục cha không còn (bản ghi mồ côi)
            const want = rec.t === "d" ? S_IFDIR : rec.t === "l" ? S_IFLNK : S_IFREG;
            if(r.id !== -1 && (fs.inodes[r.id].mode & S_IFMT) !== want) {
                removeTree(r.pid, r.name);
                r = { ...r, id: -1 };
            }
            let id = r.id;
            if(id === -1) {
                if(rec.t === "d") id = fs.CreateDirectory(r.name, r.pid);
                else if(rec.t === "l") id = fs.CreateSymlink(r.name, r.pid, rec.target || "");
                else id = fs.CreateFile(r.name, r.pid);
            }
            const ino = fs.inodes[id];
            if(rec.t === "f") {
                const data = rec.data || new Uint8Array(0);
                await fs.set_data(id, data.slice());
                ino.size = data.length;
            } else if(rec.t === "l") {
                ino.symlink = rec.target || "";
                ino.size = ino.symlink.length;
            }
            ino.mode = rec.mode;
            ino.uid = rec.uid;
            ino.gid = rec.gid;
            ino.mtime = ino.ctime = ino.atime = rec.mtime;
            ino.qid.version++;
            applied++;
        }
        // Những gì vừa áp chính là nội dung đang có trong IndexedDB.
        const now = this.scan();
        this.saved.clear();
        for(const [path] of files) {
            const s = now.get(path);
            if(s) this.saved.set(path, s.sig);
        }
        this.savedDeleted = new Set(deleted);
        return applied + deleted.length;
    }

    /** So sánh với trạng thái sạch và ghi phần thay đổi vào IndexedDB. */
    async save(): Promise<number> {
        if(this.busy) return 0;
        this.busy = true;
        try {
            const cur = this.scan();
            const ops: Parameters<typeof idb.batch>[0] = [];
            const fs = this.fs;
            for(const [path, s] of cur) {
                if(isVolatile(path)) continue;
                const base = this.baseline.get(path);
                if(base === s.sig) {
                    if(this.saved.has(path)) { ops.push({ store: "files", key: path, delete: true }); this.saved.delete(path); }
                    continue;
                }
                if(this.saved.get(path) === s.sig) continue;
                const ino = fs.inodes[s.idx];
                const type = ino.mode & S_IFMT;
                if(type !== S_IFDIR && type !== S_IFREG && type !== S_IFLNK) continue;
                const rec: FileRecord = {
                    t: type === S_IFDIR ? "d" : type === S_IFLNK ? "l" : "f",
                    mode: ino.mode, uid: ino.uid, gid: ino.gid, mtime: ino.mtime,
                };
                if(type === S_IFLNK) rec.target = ino.symlink;
                if(type === S_IFREG) {
                    const d: Uint8Array | null = await fs.Read(s.idx, 0, ino.size);
                    rec.data = d ? d.slice(0, ino.size) : new Uint8Array(0);
                }
                ops.push({ store: "files", key: path, value: rec });
                this.saved.set(path, s.sig);
            }
            for(const path of [...this.saved.keys()]) {
                if(!cur.has(path)) { ops.push({ store: "files", key: path, delete: true }); this.saved.delete(path); }
            }
            for(const path of this.baseline.keys()) {
                if(isVolatile(path)) continue;
                if(!cur.has(path) && !this.savedDeleted.has(path)) {
                    ops.push({ store: "deleted", key: path, value: true });
                    this.savedDeleted.add(path);
                }
            }
            for(const path of [...this.savedDeleted]) {
                if(cur.has(path)) { ops.push({ store: "deleted", key: path, delete: true }); this.savedDeleted.delete(path); }
            }
            if(ops.length) await idb.batch(ops);
            this.lastSaveTime = Date.now();
            this.lastError = null;
            if(ops.length && this.onSaved) this.onSaved({ changed: ops.length, total: this.saved.size + this.savedDeleted.size });
            return ops.length;
        } catch(e: any) {
            this.lastError = String(e && e.message || e);
            console.error("[persist]", e);
            return 0;
        } finally {
            this.busy = false;
        }
    }

    start(intervalMs = 3000) {
        this.stop();
        this.timer = setInterval(() => this.save(), intervalMs);
    }

    stop() {
        if(this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    get changedCount() { return this.saved.size + this.savedDeleted.size; }
}

// Xuất hệ tệp 9p của v86 (đối tượng FS trong JS) thành ảnh cho bản web:
//   out/fs.json (định dạng v3 của tools/fs2json.py), out/base/<sha256[:10]>.bin.zst, out/manifest.json
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { ensureDir } from "./vm-node.mjs";

const zstd = promisify(zlib.zstdCompress);

export async function exportFs(fs9p, out) {
    const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFREG = 0o100000, S_IFLNK = 0o120000;
    const SKIP_CHILDREN = new Set(["/proc", "/sys", "/dev", "/run", "/tmp", "/var/tmp", "/mnt", "/media"]);
    const baseDir = ensureDir(path.join(out, "base"));
    const known = new Map();      // tên tệp ngắn -> sha256 đầy đủ
    const pending = [];
    let total = 0, entries = 0, written = 0, bytesIn = 0, bytesOut = 0;

    async function flush(limit) {
        while(pending.length > limit) await pending.shift();
    }

    async function emit(idx, name, full) {
        const inode = fs9p.inodes[idx];
        const type = inode.mode & S_IFMT;
        const obj = [name, inode.size, inode.mtime, inode.mode, inode.uid, inode.gid];
        entries++;
        if(type === S_IFDIR) {
            const children = [];
            if(!SKIP_CHILDREN.has(full)) {
                const names = [...inode.direntries.keys()].filter(n => n !== "." && n !== "..").sort();
                for(const n of names) {
                    const c = await emit(inode.direntries.get(n), n, (full === "/" ? "" : full) + "/" + n);
                    if(c) children.push(c);
                }
            }
            obj[1] = 0;
            obj.push(children);
        } else if(type === S_IFLNK) {
            obj.push(inode.symlink);
        } else if(type === S_IFREG) {
            const data = (await fs9p.Read(idx, 0, inode.size)) || new Uint8Array(0);
            const sha = crypto.createHash("sha256").update(data).digest("hex");
            const fn = sha.slice(0, 10) + ".bin.zst";
            const prev = known.get(fn);
            if(prev && prev !== sha) throw new Error("Trùng hash ngắn: " + full);
            if(!prev) {
                known.set(fn, sha);
                const dst = path.join(baseDir, fn);
                if(!fs.existsSync(dst)) {
                    const copy = Uint8Array.from(data);
                    pending.push(zstd(copy, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } })
                        .then(buf => { fs.writeFileSync(dst, buf); bytesOut += buf.length; }));
                    written++;
                    bytesIn += copy.length;
                    await flush(16);
                }
            }
            total += inode.size;
            obj.push(fn);
        } else {
            return null;  // thiết bị, socket, FIFO: không đưa vào ảnh
        }
        return obj;
    }

    const root = fs9p.inodes[0];
    const top = [];
    for(const n of [...root.direntries.keys()].filter(n => n !== "." && n !== "..").sort()) {
        const c = await emit(root.direntries.get(n), n, "/" + n);
        if(c) top.push(c);
        process.stderr.write(`  /${n} `);
    }
    await flush(0);
    const json = JSON.stringify({ fsroot: top, version: 3, size: total });
    fs.writeFileSync(path.join(out, "fs.json"), json);
    const version = crypto.createHash("sha256").update(json).digest("hex").slice(0, 16);
    fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
        version,
        created: new Date().toISOString(),
        entries, files: known.size, size: total,
        compressed: bytesOut,
    }, null, 1));
    console.error(`\n[export] fs.json: ${entries} mục, ${(total / 1e6).toFixed(1)} MB; ` +
        `${written} tệp mới nén ${(bytesIn / 1e6).toFixed(1)} -> ${(bytesOut / 1e6).toFixed(1)} MB; phiên bản ${version}`);
}

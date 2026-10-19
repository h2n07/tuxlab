#!/usr/bin/env node
// Áp nhanh image/overlay/ (cấu hình hệ thống, chủ root) và samples/ (bài mẫu,
// chủ student) vào ảnh ĐÃ DỰNG rồi xuất lại - mất vài giây thay vì dựng lại
// toàn bộ (~30 phút). Dùng khi đổi tệp cấu hình hoặc thay Lab1-template.cpp.
//   node image/apply-overlay.mjs
import path from "node:path";
import fs from "node:fs";
import { createVM, WORK, ROOT } from "./vm-node.mjs";
import { exportFs } from "./export-fs.mjs";

const IMG = process.env.LTHT_IMAGE_DIR || path.join(WORK, "image");
const S_IFDIR = 0o040000, S_IFREG = 0o100000;

const emulator = createVM({ fsDir: IMG, kernelDir: IMG, memoryMB: 256, autostart: false });
await new Promise(r => emulator.add_listener("emulator-loaded", r));
const f = emulator.fs9p;

function mkdirp(p, uid, gid) {
    let id = 0;
    for(const part of p.split("/").filter(Boolean)) {
        let next = f.Search(id, part);
        if(next === -1) {
            next = f.CreateDirectory(part, id);
            Object.assign(f.inodes[next], { uid, gid, mode: S_IFDIR | 0o755 });
        }
        id = next;
    }
    return id;
}

let count = 0;
async function copyTree(src, dest, uid, gid) {
    for(const ent of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, ent.name);
        const d = dest + "/" + ent.name;
        if(ent.isDirectory()) { mkdirp(d, uid, gid); await copyTree(s, d, uid, gid); continue; }
        let data = fs.readFileSync(s);
        if(!/\.(bin|png|o)$/.test(ent.name)) data = Buffer.from(data.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
        let mode = data.subarray(0, 2).toString() === "#!" ? 0o755 : 0o644;
        if(d === "/etc/sudoers.d/student") mode = 0o440;
        const pid = mkdirp(path.posix.dirname(d), uid, gid);
        const name = path.posix.basename(d);
        let id = f.Search(pid, name);
        if(id === -1) id = f.CreateFile(name, pid);
        const buf = new Uint8Array(data);
        await f.set_data(id, buf);
        Object.assign(f.inodes[id], { size: buf.length, uid, gid, mode: S_IFREG | mode, mtime: Math.floor(Date.now() / 1000) });
        count++;
    }
}

await copyTree(path.join(ROOT, "image/overlay"), "", 0, 0);
await copyTree(path.join(ROOT, "samples"), "/home/student", 1000, 1000);
console.error(`[apply-overlay] đã ghi ${count} tệp, xuất lại ảnh...`);
await exportFs(f, IMG);
process.exit(0);

#!/usr/bin/env node
// Giai đoạn 2: khởi động hệ tệp của giai đoạn 1 trong v86 (Node.js), chạy
// /ltht/stage2.sh (debootstrap --second-stage + apt-get install) bên trong
// Linux thật, rồi xuất hệ tệp 9p kết quả thành ảnh cho bản web:
//   <WORK>/image/fs.json, <WORK>/image/base/*.bin.zst, bzImage, initrd.img
import path from "node:path";
import fs from "node:fs";
import { createVM, serialWatcher, WORK, BASE_CMDLINE } from "./vm-node.mjs";
import { exportFs } from "./export-fs.mjs";

const STAGE1 = path.join(WORK, "stage1");
const KERNEL = path.join(WORK, "kernel");
const OUT = path.join(WORK, "image");
const TIMEOUT_MIN = +(process.env.LTHT_STAGE2_TIMEOUT_MIN || 240);

const t0 = Date.now();
const emulator = createVM({
    fsDir: STAGE1,
    baseDir: path.join(STAGE1, "flat"),
    kernelDir: KERNEL,
    memoryMB: 1024,
    cmdline: BASE_CMDLINE + " init=/ltht/stage2.sh",
});
const serial = serialWatcher(emulator);

// Khi debootstrap báo lỗi, in phần cuối nhật ký của nó (đọc thẳng từ hệ tệp 9p).
(async function watchFailures() {
    for(;;) {
        await serial.waitFor(/^W: (Failure|See )/m);
        try {
            const log = new TextDecoder().decode(await emulator.read_file("/debootstrap/debootstrap.log"));
            const lines = log.split("\n").filter(l => /error|Error|dpkg:|unable|trying to overwrite|conflict/i.test(l));
            console.error("\n[run-stage2] --- debootstrap.log (lỗi) ---\n" + lines.slice(-40).join("\n") + "\n---");
        } catch(e) {
            console.error("[run-stage2] không đọc được debootstrap.log", e);
        }
        if(process.env.LTHT_STAGE2_STOP_ON_WARN) process.exit(3);
    }
})();

const timer = setTimeout(() => {
    console.error(`\n[run-stage2] Quá thời gian ${TIMEOUT_MIN} phút`);
    process.exit(2);
}, TIMEOUT_MIN * 60000);

const m = await serial.waitFor(/LTHT_STAGE2_(OK|FAIL)/);
clearTimeout(timer);
const mins = ((Date.now() - t0) / 60000).toFixed(1);
if(m[1] !== "OK") {
    console.error(`\n[run-stage2] Giai đoạn 2 THẤT BẠI sau ${mins} phút`);
    emulator.stop();
    process.exit(1);
}
console.error(`\n[run-stage2] Giai đoạn 2 xong sau ${mins} phút, xuất hệ tệp...`);
emulator.stop();

await exportFs(emulator.fs9p, OUT);
for(const f of ["bzImage", "initrd.img"]) fs.copyFileSync(path.join(KERNEL, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, "build-log.txt"), serial.text);
console.error(`[run-stage2] Hoàn tất sau ${((Date.now() - t0) / 60000).toFixed(1)} phút -> ${OUT}`);
process.exit(0);


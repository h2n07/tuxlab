// Tiện ích chạy v86 trong Node.js cho các bước dựng/kiểm thử ảnh.
import path from "node:path";
import fs from "node:fs";
import url from "node:url";
import { createRequire } from "node:module";
import { V86 } from "v86";
import { applyV86Fixes } from "../src/vm/v86-fixes.js";

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
export const WORK = path.resolve(process.env.LTHT_BUILD_DIR || path.join(ROOT, ".build"));
const V86_BUILD = path.dirname(require.resolve("v86"));

// Tham số dòng lệnh kernel dùng chung với bản web (src/vm/config.ts).
export const BASE_CMDLINE = [
    "console=ttyS0",
    "spectre_v2=off", "pti=off", "mitigations=off",
    "tsc=reliable", "no_timer_check",
    "init_on_free=on",
    "random.trust_cpu=on",
].join(" ");

/**
 * @param {{fsDir: string, kernelDir?: string, memoryMB?: number, cmdline?: string,
 *          virtioConsole?: boolean, network?: boolean}} o
 */
export function createVM(o) {
    const kernelDir = o.kernelDir || o.fsDir;
    const opts = {
        wasm_path: path.join(V86_BUILD, "v86.wasm"),
        bios: { url: path.join(ROOT, "public/v86/seabios.bin") },
        vga_bios: { url: path.join(ROOT, "public/v86/vgabios.bin") },
        memory_size: (o.memoryMB || 512) * 1024 * 1024,
        vga_memory_size: 2 * 1024 * 1024,
        bzimage: { url: path.join(kernelDir, "bzImage") },
        initrd: { url: path.join(kernelDir, "initrd.img") },
        cmdline: o.cmdline || BASE_CMDLINE,
        filesystem: {
            basefs: { url: path.join(o.fsDir, "fs.json") },
            baseurl: (o.baseDir || path.join(o.fsDir, "base")) + path.sep,
        },
        autostart: false,
        disable_keyboard: true,
        disable_mouse: true,
        disable_speaker: true,
        screen_dummy: true,
        uart1: false,
    };
    if(o.virtioConsole) opts.virtio_console = true;
    if(o.network) opts.net_device = { type: "virtio", relay_url: "fetch" };
    const emulator = new V86(opts);
    // fs9p chỉ có sau khi v86 khởi tạo xong: vá rồi mới chạy CPU.
    emulator.add_listener("emulator-loaded", () => {
        applyV86Fixes(emulator);
        if(o.autostart !== false) emulator.run();
    });
    return emulator;
}

/** Gom đầu ra serial0 thành văn bản, có hàm chờ một chuỗi xuất hiện. */
export function serialWatcher(emulator, { echo = true } = {}) {
    let text = "";
    const waiters = [];
    const dec = new TextDecoder();
    emulator.add_listener("serial0-output-byte", (b) => {
        const c = dec.decode(new Uint8Array([b]), { stream: true });
        text += c;
        if(echo) process.stdout.write(c);
        for(let i = waiters.length - 1; i >= 0; i--) {
            const w = waiters[i];
            const m = w.re.exec(text.slice(w.from));
            if(m) { waiters.splice(i, 1); w.resolve(m); }
        }
    });
    return {
        get text() { return text; },
        waitFor(re, from = text.length) {
            return new Promise((resolve) => waiters.push({ re, from, resolve }));
        },
    };
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }

// Quản lý vòng đời máy ảo v86: khởi động lạnh / khôi phục ảnh chụp,
// console (virtio-console <-> xterm.js), kênh điều khiển ttyS0, lưu trạng thái.
import { V86 } from "v86";
import wasmUrl from "v86/build/v86.wasm?url";
import { applyV86Fixes, createConsoleWriter } from "./v86-fixes.js";
import { GuestFS } from "./guestfs";
import { Persistence } from "./persist";
import * as idb from "./idb";
import {
    IMAGE_URL, BIOS_URL, VGA_BIOS_URL, BASE_CMDLINE, DEFAULT_SETTINGS,
    type MachineSettings, type ImageManifest,
} from "./config";

export type Phase = "idle" | "loading" | "booting" | "restoring" | "snapshot" | "ready" | "error" | "stopped";

export interface MachineStatus {
    phase: Phase;
    message: string;
    progress?: number;        // 0..1
}

export interface BootStats {
    mode: "restore" | "cold";
    totalMs: number;
    detail: Record<string, number>;
}

const SETTINGS_KEY = "settings";

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function gzip(buf: ArrayBuffer): Promise<Blob> {
    const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(stream).blob();
}

async function gunzip(blob: Blob): Promise<ArrayBuffer> {
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
}

export class Machine extends EventTarget {
    emulator: any = null;
    gfs: GuestFS | null = null;
    persist: Persistence | null = null;
    manifest: ImageManifest | null = null;
    settings: MachineSettings = { ...DEFAULT_SETTINGS };
    status: MachineStatus = { phase: "idle", message: "" };
    bootStats: BootStats | null = null;
    serialLog = "";
    private consoleBuffer: Uint8Array[] = [];
    private consoleBufferBytes = 0;
    private writeConsoleRaw: ((d: Uint8Array | string) => void) | null = null;
    private holdInput: Array<Uint8Array | string> | null = null;
    private serialWaiters: Array<{ re: RegExp, from: number, resolve: (m: RegExpExecArray) => void }> = [];
    private size: [number, number] = [80, 24];
    private started = false;

    private setStatus(phase: Phase, message: string, progress?: number) {
        this.status = { phase, message, progress };
        this.dispatchEvent(new CustomEvent("status", { detail: this.status }));
    }

    get snapshotKey() {
        return `snapshot:${this.manifest?.version}:${this.settings.memoryMB}:${this.settings.networkRelay ? 1 : 0}`;
    }

    async loadSettings() {
        const s = await idb.get<MachineSettings>("kv", SETTINGS_KEY).catch(() => undefined);
        this.settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
        return this.settings;
    }

    async saveSettings(s: MachineSettings) {
        this.settings = { ...s };
        await idb.put("kv", SETTINGS_KEY, this.settings);
    }

    async start() {
        if(this.started) return;
        this.started = true;
        const t0 = performance.now();
        const detail: Record<string, number> = {};
        const mark = (k: string) => { detail[k] = Math.round(performance.now() - t0); };
        try {
            this.setStatus("loading", "Đang đọc thông tin ảnh đĩa...");
            await this.loadSettings();
            const res = await fetch(IMAGE_URL + "manifest.json", { cache: "no-cache" }).catch(() => null)
                || await caches.match(IMAGE_URL + "manifest.json").catch(() => undefined);
            if(!res || !res.ok) throw new Error("Không tải được image/manifest.json. Đã dựng ảnh bằng image/build-image.sh chưa?");
            this.manifest = await res.json();
            mark("manifest");
            idb.requestPersistentStorage();

            const snap = await idb.get<Blob>("kv", this.snapshotKey).catch(() => undefined);
            mark("snapshot-lookup");
            const cold = !snap;
            this.createEmulator(cold);
            await new Promise<void>(resolve => this.emulator.add_listener("emulator-loaded", () => resolve()));
            applyV86Fixes(this.emulator);
            this.gfs = new GuestFS(this.emulator.fs9p);
            this.persist = new Persistence(this.emulator.fs9p);
            mark("emulator-loaded");

            if(!cold) {
                this.setStatus("restoring", "Đang khôi phục máy từ ảnh chụp...");
                let state: ArrayBuffer;
                try {
                    state = await gunzip(snap!);
                    mark("snapshot-decompress");
                    await this.emulator.restore_state(state);
                    mark("restore-state");
                } catch(e) {
                    console.warn("Ảnh chụp hỏng, khởi động lại từ đầu", e);
                    await idb.del("kv", this.snapshotKey);
                    location.reload();
                    return;
                }
                this.persist.captureBaseline();
                const n = await this.persist.apply();
                mark("apply-changes");
                await this.emulator.run();
                this.sendAgent("time " + Math.floor(Date.now() / 1000));
                this.resize(...this.size);
                // Terminal mới mở chưa có gì: nhờ bash vẽ lại dấu nhắc (Ctrl+L).
                this.writeConsole("\x0c");
                this.bootStats = { mode: "restore", totalMs: Math.round(performance.now() - t0), detail };
                this.setStatus("ready", `Sẵn sàng (khôi phục ${(this.bootStats.totalMs / 1000).toFixed(1)} s` +
                    (n ? `, áp ${n} thay đổi đã lưu` : "") + ")");
            } else {
                this.setStatus("booting", "Đang khởi động Debian (lần đầu, có thể mất 30-90 giây)...");
                await this.emulator.run();
                const ready = this.waitSerial(/LTHT_READY/);
                const timeout = sleep(300000).then(() => null);
                if(!await Promise.race([ready, timeout])) throw new Error("Hết thời gian chờ máy ảo khởi động");
                mark("boot");
                this.sendAgent("time " + Math.floor(Date.now() / 1000));
                this.resize(...this.size);
                await sleep(1500);
                await this.takeSnapshot();
                mark("snapshot");
                this.persist.captureBaseline();
                const n = await this.persist.apply();
                mark("apply-changes");
                this.bootStats = { mode: "cold", totalMs: Math.round(performance.now() - t0), detail };
                this.setStatus("ready", `Sẵn sàng (khởi động lần đầu ${(this.bootStats.totalMs / 1000).toFixed(1)} s` +
                    (n ? `, áp ${n} thay đổi đã lưu` : "") + "). Lần sau sẽ mở nhanh hơn nhiều.");
            }
            console.info("[ltht] boot", this.bootStats);
            this.persist.start(3000);
            const flush = () => { this.persist?.save(); };
            document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden") flush(); });
            window.addEventListener("pagehide", flush);
            this.dispatchEvent(new Event("ready"));
        } catch(e: any) {
            console.error(e);
            this.setStatus("error", String(e && e.message || e));
        }
    }

    private createEmulator(cold: boolean) {
        const v = this.manifest!.version;
        const opts: any = {
            wasm_path: wasmUrl,
            bios: { url: BIOS_URL },
            vga_bios: { url: VGA_BIOS_URL },
            memory_size: this.settings.memoryMB * 1024 * 1024,
            vga_memory_size: 2 * 1024 * 1024,
            autostart: false,
            disable_keyboard: true,
            disable_mouse: true,
            disable_speaker: true,
            screen_dummy: true,
            virtio_console: true,
            filesystem: { baseurl: IMAGE_URL + "base/" } as any,
        };
        if(cold) {
            opts.bzimage = { url: IMAGE_URL + "bzImage?v=" + v };
            opts.initrd = { url: IMAGE_URL + "initrd.img?v=" + v };
            opts.cmdline = BASE_CMDLINE;
            opts.filesystem.basefs = { url: IMAGE_URL + "fs.json?v=" + v };
        }
        if(this.settings.networkRelay) {
            opts.net_device = { type: "virtio", relay_url: this.settings.networkRelay };
        }
        const emu = new V86(opts);
        this.emulator = emu;
        this.writeConsoleRaw = createConsoleWriter(emu, 0);

        emu.add_listener("download-progress", (e: any) => {
            if(!e || !e.total) return;
            const name = String(e.file_name || "").split("/").pop()?.split("?")[0];
            if(this.status.phase === "ready") return;
            this.setStatus(this.status.phase, `Đang tải ${name}... ${(e.loaded / 1e6).toFixed(1)}/${(e.total / 1e6).toFixed(1)} MB`,
                e.loaded / e.total);
        });
        emu.add_listener("download-error", (e: any) => {
            this.setStatus("error", "Lỗi tải tệp ảnh: " + (e && e.file_name || "") + ". Kiểm tra kết nối mạng.");
        });
        emu.add_listener("virtio-console0-output-bytes", (bytes: Uint8Array) => {
            if(this.listenerCount > 0) {
                this.dispatchEvent(new CustomEvent("console", { detail: bytes }));
            } else {
                this.consoleBuffer.push(bytes.slice());
                this.consoleBufferBytes += bytes.length;
                while(this.consoleBufferBytes > 512 * 1024) this.consoleBufferBytes -= this.consoleBuffer.shift()!.length;
            }
        });
        const dec = new TextDecoder();
        emu.add_listener("serial0-output-byte", (b: number) => {
            this.serialLog += dec.decode(new Uint8Array([b]), { stream: true });
            if(this.serialLog.length > 400000) this.serialLog = this.serialLog.slice(-300000);
            if(b === 10 && this.serialWaiters.length) {
                for(let i = this.serialWaiters.length - 1; i >= 0; i--) {
                    const w = this.serialWaiters[i];
                    const m = w.re.exec(this.serialLog.slice(Math.max(0, w.from - 64)));
                    if(m) { this.serialWaiters.splice(i, 1); w.resolve(m); }
                }
            }
        });
    }

    // ---- console ----
    private listenerCount = 0;

    /** Đăng ký nhận đầu ra console; trả về hàm huỷ. Phát lại phần đã đệm. */
    attachConsole(onData: (bytes: Uint8Array) => void): () => void {
        const h = (e: Event) => onData((e as CustomEvent).detail);
        this.addEventListener("console", h);
        this.listenerCount++;
        for(const b of this.consoleBuffer) onData(b);
        this.consoleBuffer = [];
        this.consoleBufferBytes = 0;
        return () => { this.removeEventListener("console", h); this.listenerCount--; };
    }

    writeConsole(data: Uint8Array | string) {
        if(this.holdInput) { this.holdInput.push(data); return; }
        if(this.writeConsoleRaw && this.emulator) this.writeConsoleRaw(data);
    }

    /** Gõ một lệnh vào terminal như người dùng gõ (hiện rõ trên màn hình). */
    typeCommand(cmd: string) {
        this.writeConsole(cmd + "\r");
    }

    resize(cols: number, rows: number) {
        this.size = [cols, rows];
        // v86 gửi thông điệp VIRTIO_CONSOLE_RESIZE theo thứ tự (rows, cols) còn kernel Linux 6.1
        // đọc thành (cols, rows) - đã kiểm chứng bằng `stty size`. Vì vậy truyền đảo ở đây.
        if(this.emulator) this.emulator.bus.send("virtio-console0-resize", [rows, cols]);
    }

    // ---- kênh điều khiển ttyS0 ----

    sendAgent(line: string) {
        this.emulator?.serial0_send(line + "\n");
    }

    waitSerial(re: RegExp): Promise<RegExpExecArray> {
        return new Promise(resolve => this.serialWaiters.push({ re, from: this.serialLog.length, resolve }));
    }

    // ---- ảnh chụp ----

    async takeSnapshot() {
        this.setStatus("snapshot", "Đang lưu ảnh chụp máy để lần sau mở nhanh...");
        this.holdInput = [];
        try {
            this.sendAgent("drop");
            await sleep(800);
            await this.emulator.stop();
            const state: ArrayBuffer = await this.emulator.save_state();
            await this.emulator.run();
            const blob = await gzip(state);
            for(const k of await idb.keys("kv")) {
                if(k.startsWith("snapshot:") && k !== this.snapshotKey) await idb.del("kv", k);
            }
            await idb.put("kv", this.snapshotKey, blob);
            console.info(`[ltht] snapshot ${(state.byteLength / 1e6).toFixed(0)} MB -> ${(blob.size / 1e6).toFixed(1)} MB`);
        } catch(e) {
            console.warn("Không lưu được ảnh chụp (có thể do hết dung lượng lưu trữ)", e);
            if(this.emulator) await this.emulator.run();
        } finally {
            const held = this.holdInput || [];
            this.holdInput = null;
            for(const d of held) this.writeConsole(d);
        }
    }

    /** Xoá toàn bộ dữ liệu cục bộ (đĩa đã thay đổi + ảnh chụp) rồi tải lại trang. */
    async factoryReset() {
        this.persist?.stop();
        try { await this.emulator?.stop(); } catch { /* bỏ qua */ }
        await idb.clearAll();
        location.reload();
    }

    /** Xoá ảnh chụp (giữ tệp người dùng) - dùng khi đổi cấu hình RAM/mạng. */
    async dropSnapshots() {
        for(const k of await idb.keys("kv")) if(k.startsWith("snapshot:")) await idb.del("kv", k);
    }

    async saveNow() { return this.persist?.save(); }
}

export const machine = new Machine();
(window as any).ltht = machine;   // tiện gỡ lỗi trong DevTools

// Các thao tác dùng chung giữa các ứng dụng (mở tệp, biên dịch & chạy, zip...).
import { zipSync, unzipSync, type Zippable } from "fflate";
import { machine } from "../vm/machine";
import { basename, dirname, join, HOME, type Entry } from "../vm/guestfs";
import { wm } from "./wm";
import { focusTerminal } from "./apps/TerminalApp";

export const TEXT_EXT = new Set(["c", "h", "cpp", "cc", "cxx", "hpp", "hh", "s", "S", "asm", "inc", "txt", "md",
    "sh", "py", "mk", "json", "xml", "csv", "log", "conf", "cfg", "ini", "gdb", "ld", "lst", "map", "out"]);

export function extOf(name: string): string {
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(i + 1) : "";
}

function gfs() {
    if(!machine.gfs) throw new Error("Máy ảo chưa sẵn sàng");
    return machine.gfs;
}

/** Nội dung có vẻ là văn bản (không có byte 0 trong 8 KB đầu và hợp lệ UTF-8). */
export function looksText(data: Uint8Array): boolean {
    const n = Math.min(data.length, 8192);
    for(let i = 0; i < n; i++) if(data[i] === 0) return false;
    try { new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, n)); return true; }
    catch { return n === 8192; }
}

export async function openPath(e: Entry | string) {
    const path = typeof e === "string" ? e : e.path;
    const st = gfs().stat(path, true);
    if(!st) return;
    if(st.type === "dir") { openFiles(path); return; }
    const name = basename(path);
    if(TEXT_EXT.has(extOf(name)) || name === "Makefile" || name.startsWith(".")) { openEditor(path); return; }
    const data = await gfs().read(path);
    if(data.length < 4 * 1024 * 1024 && looksText(data)) { openEditor(path); return; }
    if(data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) {
        if(confirm(`"${name}" là tệp thực thi ELF. Chạy trong terminal?\n\n(Bấm Huỷ để tải tệp xuống máy)`)) {
            runInTerminal(`cd ${shq(dirname(path))} && ./${shq(name)}`);
            return;
        }
    }
    downloadBlob(new Blob([data as BlobPart]), name);
}

export function openEditor(path: string) {
    wm.open("editor", { path, key: "editor:" + path }, basename(path) + " - Trình soạn thảo");
}

export function openFiles(path = HOME) {
    const existing = wm.find(w => w.app === "files");
    if(existing) {
        wm.update(existing.id, { props: { ...existing.props, path, nav: Date.now() } });
        wm.focus(existing.id);
    } else {
        wm.open("files", { path }, "Tệp");
    }
}

export function openTerminal() {
    wm.open("terminal", {}, "Terminal - student@tuxlab");
    focusTerminal();
}

/** Trích dẫn an toàn cho shell (chỉ thêm nháy khi cần, để lệnh hiển thị dễ đọc). */
export function shq(s: string): string {
    if(/^[A-Za-z0-9_\-./~+@%:=]+$/.test(s)) return s;
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

function displayDir(dir: string): string {
    if(dir === HOME) return "~";
    if(dir.startsWith(HOME + "/")) return "~/" + shq(dir.slice(HOME.length + 1));
    return shq(dir);
}

/** Gõ lệnh vào terminal (sinh viên nhìn thấy đúng lệnh được chạy). */
export function runInTerminal(cmd: string) {
    openTerminal();
    machine.typeCommand(cmd);
}

/** Lệnh biên dịch & chạy tương ứng với loại tệp, giống hệt khi gõ tay. */
export function buildCommand(path: string): string | null {
    const dir = dirname(path);
    const name = basename(path);
    const ext = extOf(name);
    const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
    const out = shq(stem);
    const src = shq(name);
    let cmd: string | null = null;
    switch(ext) {
        case "c": cmd = `gcc ${src} -o ${out} && ./${out}`; break;
        case "cpp": case "cc": case "cxx": cmd = `g++ ${src} -o ${out} && ./${out}`; break;
        case "s": cmd = `as -o ${shq(stem + ".o")} ${src} && ld -o ${out} ${shq(stem + ".o")} && ./${out}`; break;
        case "S": cmd = `gcc -c ${src} -o ${shq(stem + ".o")} && ld -o ${out} ${shq(stem + ".o")} && ./${out}`; break;
        case "asm": cmd = `nasm -f elf32 ${src} -o ${shq(stem + ".o")} && ld -o ${out} ${shq(stem + ".o")} && ./${out}`; break;
        default:
            if(name === "Makefile" || name === "makefile") cmd = "make";
            else if(ext === "sh") cmd = `bash ${src}`;
    }
    return cmd ? `cd ${displayDir(dir)} && ${cmd}` : null;
}

// ---- tải lên / tải xuống ----

export function downloadBlob(blob: Blob, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

export async function downloadEntry(path: string) {
    const st = gfs().stat(path, true);
    if(!st) return;
    if(st.type === "dir") {
        const blob = await zipFolder(path);
        downloadBlob(blob, (basename(path) || "root") + ".zip");
    } else {
        downloadBlob(new Blob([await gfs().read(path) as BlobPart]), basename(path));
    }
}

/** Nén thư mục thành .zip (giữ quyền thực thi và thời gian sửa đổi). */
export async function zipFolder(dir: string, withHidden = true): Promise<Blob> {
    const g = gfs();
    const files: Zippable = {};
    const root = dirname(dir);
    for(const e of g.walk(dir)) {
        if(!withHidden && e.name.startsWith(".") && e.path !== dir) continue;
        let rel = e.path.slice(root === "/" ? 1 : root.length + 1);
        const mtime = new Date(Math.max(e.mtime * 1000, Date.UTC(1980, 1, 1)));
        const attrs = (e.mode & 0xffff) << 16;
        if(e.type === "dir") files[rel + "/"] = [new Uint8Array(0), { mtime, attrs, os: 3 }];
        else if(e.type === "file") files[rel] = [await g.read(e.path), { mtime, attrs, os: 3 }];
        else if(e.type === "link") files[rel] = [new TextEncoder().encode(e.target || ""), { mtime, attrs, os: 3 }];
    }
    const data = zipSync(files, { level: 6 });
    return new Blob([data as BlobPart], { type: "application/zip" });
}

/** Giải nén .zip vào thư mục đích. Trả về số tệp đã ghi. */
export async function importZip(file: Blob, destDir: string, overwrite: boolean): Promise<number> {
    const g = gfs();
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    let n = 0;
    for(const [name, data] of Object.entries(entries)) {
        const clean = name.replace(/\\/g, "/").split("/").filter(p => p && p !== "." && p !== "..").join("/");
        if(!clean) continue;
        const target = join(destDir, clean);
        if(name.endsWith("/")) { g.mkdirp(target); continue; }
        g.mkdirp(dirname(target));
        if(g.exists(target) && !overwrite) continue;
        const exec = (data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46) ||
                     (data[0] === 0x23 && data[1] === 0x21);
        await g.write(target, data, { mode: exec ? 0o755 : 0o644 });
        n++;
    }
    return n;
}

/** Tải tệp/thư mục từ máy thật vào guest (từ <input> hoặc kéo-thả). */
export async function uploadFiles(items: Array<{ file: File, relPath: string }>, destDir: string): Promise<string[]> {
    const g = gfs();
    const written: string[] = [];
    for(const { file, relPath } of items) {
        const target = join(destDir, relPath);
        g.mkdirp(dirname(target));
        if(g.exists(target)) {
            const st = g.stat(target)!;
            if(st.type === "dir") continue;
            if(!confirm(`"${relPath}" đã tồn tại. Ghi đè?`)) continue;
        }
        const data = new Uint8Array(await file.arrayBuffer());
        const exec = data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46;
        await g.write(target, data, { mode: exec ? 0o755 : 0o644 });
        written.push(target);
    }
    return written;
}

/** Đọc các mục kéo-thả từ hệ điều hành, kể cả thư mục (webkitGetAsEntry). */
export async function collectDropped(dt: DataTransfer): Promise<Array<{ file: File, relPath: string }>> {
    const out: Array<{ file: File, relPath: string }> = [];
    const entries = [...dt.items].map(i => (i as any).webkitGetAsEntry?.()).filter(Boolean);
    if(!entries.length) {
        for(const f of [...dt.files]) out.push({ file: f, relPath: f.name });
        return out;
    }
    async function walk(entry: any, prefix: string): Promise<void> {
        if(entry.isFile) {
            const file: File = await new Promise((res, rej) => entry.file(res, rej));
            out.push({ file, relPath: prefix + entry.name });
        } else if(entry.isDirectory) {
            const reader = entry.createReader();
            let batch: any[];
            do {
                batch = await new Promise((res, rej) => reader.readEntries(res, rej));
                for(const e of batch) await walk(e, prefix + entry.name + "/");
            } while(batch.length);
        }
    }
    for(const e of entries) await walk(e, "");
    return out;
}

export function pickFiles(opts: { directory?: boolean, accept?: string } = {}): Promise<Array<{ file: File, relPath: string }>> {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        if(opts.accept) input.accept = opts.accept;
        if(opts.directory) (input as any).webkitdirectory = true;
        input.onchange = () => {
            const files = [...(input.files || [])];
            resolve(files.map(f => ({ file: f, relPath: (f as any).webkitRelativePath || f.name })));
        };
        input.click();
    });
}

export function formatSize(n: number): string {
    if(n < 1024) return n + " B";
    if(n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if(n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

export function formatMode(mode: number): string {
    const t = (mode & 0o170000) === 0o040000 ? "d" : (mode & 0o170000) === 0o120000 ? "l" : "-";
    const r = (b: number, c: string) => (mode & b ? c : "-");
    return t + r(0o400, "r") + r(0o200, "w") + ((mode & 0o4000) ? "s" : r(0o100, "x")) +
        r(0o40, "r") + r(0o20, "w") + ((mode & 0o2000) ? "s" : r(0o10, "x")) +
        r(0o4, "r") + r(0o2, "w") + ((mode & 0o1000) ? "t" : r(0o1, "x"));
}

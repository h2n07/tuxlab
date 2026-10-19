#!/usr/bin/env node
// Kiểm thử nghiệm thu ảnh Debian cuối cùng trong v86 (Node.js): khởi động,
// gõ lệnh thật vào terminal (virtio-console hvc0, giống bản web) và kiểm
// tra đầu ra. Kết quả ghi vào <WORK>/image/test-results.json và in bảng.
import path from "node:path";
import fs from "node:fs";
import { createVM, serialWatcher, WORK, BASE_CMDLINE, sleep } from "./vm-node.mjs";
import { createConsoleWriter } from "../src/vm/v86-fixes.js";

const IMG = process.env.LTHT_IMAGE_DIR || path.join(WORK, "image");
const results = [];
const t0 = Date.now();

const emulator = createVM({ fsDir: IMG, kernelDir: IMG, memoryMB: 512, virtioConsole: true, cmdline: BASE_CMDLINE + " quiet loglevel=3" });
const serial = serialWatcher(emulator, { echo: false });
const write = createConsoleWriter(emulator, 0);

let out = "";
const dec = new TextDecoder();
emulator.add_listener("virtio-console0-output-bytes", (b) => {
    const s = dec.decode(b, { stream: true });
    out += s;
    if(process.env.LTHT_TEST_ECHO) process.stdout.write(s);
});

function waitOut(re, from, ms = 600000) {
    return new Promise((resolve, reject) => {
        const t = setInterval(() => {
            const m = re.exec(out.slice(from));
            if(m) { clearInterval(t); clearTimeout(to); resolve(m); }
        }, 20);
        const to = setTimeout(() => { clearInterval(t); reject(new Error("timeout chờ " + re + "\n--- đầu ra ---\n" + out.slice(from).slice(-2000))); }, ms);
    });
}

let seq = 0;
/** Gõ lệnh vào shell và đợi kết thúc; trả về {output, rc, ms}. */
async function sh(cmd, ms) {
    const n = ++seq;
    const from = out.length;
    const start = Date.now();
    write(`${cmd}; echo "__E${n}__$?__"\r`);
    const m = await waitOut(new RegExp(`__E${n}__(\\d+)__`), from, ms);
    // bỏ dòng lệnh vọng lại (echo) và dấu nhắc
    let text = out.slice(from);
    const echoEnd = text.indexOf(`__E${n}__$?__"`);
    const nl = text.indexOf("\n", echoEnd);
    text = text.slice(nl + 1, text.lastIndexOf(`__E${n}__`));
    return { output: text.replace(/\r/g, "").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trim(), rc: +m[1], ms: Date.now() - start };
}

function record(id, name, pass, detail, extra = {}) {
    results.push({ id, name, pass, detail, ...extra });
    console.log(`${pass ? "ĐẠT     " : "KHÔNG ĐẠT"} [${id}] ${name}${detail ? " — " + detail.split("\n")[0].slice(0, 140) : ""}`);
}

async function test(id, name, fn) {
    try { await fn(); }
    catch(e) { record(id, name, false, "Lỗi: " + e.message); }
}

// ---------------------------------------------------------------------------
const bootStart = Date.now();
await serial.waitFor(/LTHT_READY/);
const bootMs = Date.now() - bootStart;
await sleep(500);
emulator.bus.send("virtio-console0-resize", [40, 160]);   // (rows, cols) - xem src/vm/machine.ts resize()
await sleep(300);
emulator.serial0_send("time " + Math.floor(Date.now() / 1000) + "\n");
console.log(`Khởi động lạnh tới dấu nhắc: ${(bootMs / 1000).toFixed(1)} s`);

await test("0", "Hệ thống: Debian 12 i386, người dùng student", async () => {
    const r = await sh("cat /etc/debian_version; uname -m; id -un; echo $LANG");
    const ok = /^12\.\d+/m.test(r.output) && /i686/.test(r.output) && /student/.test(r.output);
    record("0", "Hệ thống: Debian 12 i386, người dùng student", ok, r.output.replace(/\n/g, " | "));
});

await test("1", "as --version và ld --version", async () => {
    const a = await sh("as --version | head -n1");
    const l = await sh("ld --version | head -n1");
    record("1", "as --version và ld --version", a.rc === 0 && l.rc === 0 && /GNU assembler/.test(a.output) && /GNU ld/.test(l.output),
        a.output + " / " + l.output);
});

await test("2", "Hello World assembly (as, ld, ./example)", async () => {
    await sh("cd ~/LTHT/Lab2");
    const as = await sh("as -o example.o example.s");
    const ld = await sh("ld -o example example.o");
    const run = await sh("./example");
    record("2", "Hello World assembly (as, ld, ./example)", as.rc === 0 && ld.rc === 0 && run.output === "Hello, World" && run.rc === 0,
        `as ${as.ms} ms, ld ${ld.ms} ms, ./example -> "${run.output}" (mã thoát ${run.rc})`, { as_ms: as.ms, ld_ms: ld.ms });
});

await test("3", "sys_read từ bàn phím rồi sys_write (echo.s, reverse.s)", async () => {
    await sh("as -o echo.o echo.s && ld -o echo echo.o && as -o reverse.o reverse.s && ld -o reverse reverse.o");
    // gõ thật vào terminal khi chương trình đang chờ sys_read
    const n = ++seq;
    const from = out.length;
    write(`./echo; echo "__E${n}__$?__"\r`);
    await waitOut(/Nhap mot chuoi: /, from, 60000);
    await sleep(200);
    write("SV 20201234 Nguyen Van A\r");
    await waitOut(new RegExp(`__E${n}__0__`), from, 60000);
    const echoed = /Ban vua nhap: SV 20201234 Nguyen Van A/.test(out.slice(from));
    const rev = await sh("echo 'Lap trinh he thong' | ./reverse");
    record("3", "sys_read từ bàn phím rồi sys_write (echo.s, reverse.s)",
        echoed && rev.output === "gnoht eh hnirt paL", `echo: ${echoed ? "đúng" : "sai"}; reverse -> "${rev.output}"`);
});

await test("4", "Lab1-template.cpp với g++", async () => {
    await sh("cd ~/LTHT/Lab1");
    const c = await sh("g++ Lab1-template.cpp -o lab1");
    const r = await sh("./lab1");
    if(process.env.LTHT_TEST_DEBUG) console.log(JSON.stringify(c), JSON.stringify(r));
    const ok = c.rc === 0 && /Pass\./.test(r.output) && /Failed\./.test(r.output) && /Your score/.test(r.output);
    record("4", "Lab1-template.cpp với g++", ok,
        `g++ ${(c.ms / 1000).toFixed(1)} s; ${r.output.split("\n").filter(l => /score/.test(l))[0] || ""}`, { gpp_ms: c.ms });
});

await test("5", "Đồng bộ hai chiều GUI <-> terminal", async () => {
    // GUI -> terminal: tạo thư mục trực tiếp trong hệ tệp 9p (như Trình quản lý tệp làm)
    const fs9p = emulator.fs9p;
    const home = fs9p.SearchPath("/home/student/LTHT").id;
    const id = fs9p.CreateDirectory("tao-tu-GUI", home);
    fs9p.inodes[id].uid = 1000; fs9p.inodes[id].gid = 1000;
    const ls = await sh("ls ~/LTHT");
    // terminal -> GUI
    await sh("mkdir ~/LTHT/tao-tu-terminal && echo 'noi dung' > ~/LTHT/tao-tu-terminal/a.txt");
    const p = fs9p.SearchPath("/home/student/LTHT/tao-tu-terminal/a.txt");
    const data = p.id === -1 ? null : new TextDecoder().decode(await emulator.read_file("/home/student/LTHT/tao-tu-terminal/a.txt"));
    const ok = /tao-tu-GUI/.test(ls.output) && data === "noi dung\n";
    record("5", "Đồng bộ hai chiều GUI <-> terminal", ok, `ls thấy tao-tu-GUI: ${/tao-tu-GUI/.test(ls.output)}; GUI đọc a.txt: ${JSON.stringify(data)}`);
    await sh("rm -r ~/LTHT/tao-tu-GUI ~/LTHT/tao-tu-terminal");
});

await test("6", "gdb ./example và objdump -d example", async () => {
    await sh("cd ~/LTHT/Lab2");
    const g = await sh("gdb -q -batch -ex 'break _start' -ex run -ex 'info registers eip' -ex 'x/s &output' ./example 2>&1", 300000);
    const o = await sh("objdump -d example | head -n 20");
    const ok = /Breakpoint 1/.test(g.output) && /eip/.test(g.output) && /Hello, World/.test(g.output) && /mov\s+\$0xd,%edx/.test(o.output);
    record("6", "gdb ./example và objdump -d example", ok,
        `gdb ${(g.ms / 1000).toFixed(1)} s; objdump: ${(o.output.match(/mov\s+\$0xd,%edx/) || ["?"])[0]}`, { gdb_ms: g.ms });
});

await test("8b", "Thời gian biên dịch C đơn giản (gcc)", async () => {
    await sh("cd ~/LTHT/Lab1");
    const a = await sh("gcc bits.c -o bits");
    const b = await sh("gcc bits.c -o bits");
    const r = await sh("./bits | head -n1");
    record("8b", "Thời gian biên dịch C đơn giản (gcc)", a.rc === 0 && /x\s+= 0x12345678/.test(r.output),
        `gcc bits.c: lần 1 ${(a.ms / 1000).toFixed(1)} s, lần 2 ${(b.ms / 1000).toFixed(1)} s`, { gcc_first_ms: a.ms, gcc_ms: b.ms });
});

// ---- các yêu cầu terminal khác ----
await test("T1", "Kích thước terminal (stty size) theo cửa sổ", async () => {
    emulator.bus.send("virtio-console0-resize", [30, 100]);
    await sleep(400);
    const r = await sh("stty size");
    record("T1", "Kích thước terminal (stty size) theo cửa sổ", r.output === "30 100", "stty size -> " + r.output);
});

await test("T2", "Ctrl+C ngắt chương trình, Ctrl+Z tạm dừng", async () => {
    let from = out.length;
    write("sleep 100\r");
    await sleep(1500);
    write("\x03");
    const r = await sh("echo rc_truoc_do");
    from = out.length;
    write("sleep 200\r");
    await sleep(1500);
    write("\x1a");
    await waitOut(/Stopped/, from, 30000);
    const j = await sh("jobs; kill %1");
    record("T2", "Ctrl+C ngắt chương trình, Ctrl+Z tạm dừng", /rc_truoc_do/.test(r.output) && /sleep 200/.test(j.output),
        "Ctrl+C ok; jobs: " + j.output.split("\n")[0]);
});

await test("T3", "Hoàn thành bằng Tab, UTF-8 tiếng Việt", async () => {
    const from = out.length;
    write("ech\t");
    await waitOut(/echo /, from, 10000);
    write(`"Xin chào Việt Nam"; echo "__TAB__"\r`);
    await waitOut(/__TAB__\r?\n/, from, 10000);
    const ok = /Xin chào Việt Nam\r?\n/.test(out.slice(from));
    record("T3", "Hoàn thành bằng Tab, UTF-8 tiếng Việt", ok, ok ? "ech<Tab> -> echo; in đúng chữ có dấu" : out.slice(from).slice(-200));
});

await test("T4", "Thông báo lỗi và mã thoát như Linux thật", async () => {
    const r = await sh("gcc khong-co.c");
    const s = await sh("sudo -n true && echo SUDO_OK");
    record("T4", "Thông báo lỗi và mã thoát như Linux thật",
        /cc1: fatal error: khong-co.c: No such file or directory/.test(r.output) && /compilation terminated/.test(r.output) && r.rc === 1 && /SUDO_OK/.test(s.output),
        `${r.output.split("\n")[0]} (mã ${r.rc}); sudo không mật khẩu: ${/SUDO_OK/.test(s.output)}`);
});

await test("T5", "apt khi không có mạng báo lỗi rõ ràng", async () => {
    const r = await sh("sudo apt-get update 2>&1 | head -n 8", 120000);
    record("T5", "apt khi không có mạng báo lỗi rõ ràng", /CHƯA có mạng/.test(r.output), r.output.split("\n").slice(0, 2).join(" | "));
});

// ---- ảnh chụp (snapshot) ----
await test("S", "Kích thước và thời gian khôi phục ảnh chụp", async () => {
    emulator.serial0_send("drop\n");
    await sleep(1000);
    await emulator.stop();
    const ts = Date.now();
    const state = await emulator.save_state();
    const saveMs = Date.now() - ts;
    const zlib = await import("node:zlib");
    const tz = Date.now();
    const gz = zlib.gzipSync(Buffer.from(state), { level: 6 });
    const gzMs = Date.now() - tz;
    const tr = Date.now();
    const raw = zlib.gunzipSync(gz);
    await emulator.restore_state(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    await emulator.run();
    const r = await sh("echo sau_khoi_phuc");
    const restoreMs = Date.now() - tr;
    record("S", "Kích thước và thời gian khôi phục ảnh chụp", /sau_khoi_phuc/.test(r.output),
        `state ${(state.byteLength / 1e6).toFixed(0)} MB -> gzip ${(gz.length / 1e6).toFixed(1)} MB (lưu ${saveMs} ms + nén ${gzMs} ms); ` +
        `giải nén + khôi phục + lệnh đầu tiên ${restoreMs} ms (Node)`,
        { state_mb: state.byteLength / 1e6, gzip_mb: gz.length / 1e6, restore_ms: restoreMs });
});

const summary = { image: IMG, date: new Date().toISOString(), cold_boot_ms: bootMs, total_ms: Date.now() - t0, results };
fs.writeFileSync(path.join(IMG, "test-results.json"), JSON.stringify(summary, null, 1));
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} đạt. Kết quả: ${path.join(IMG, "test-results.json")}`);
emulator.stop();
process.exit(failed ? 1 : 0);

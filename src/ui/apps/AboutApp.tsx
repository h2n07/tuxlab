import { machine } from "../../vm/machine";
import { useMachineStatus } from "../hooks";
import { formatSize, runInTerminal, openEditor } from "../actions";
import { HOME } from "../../vm/guestfs";

export function AboutApp() {
    const status = useMachineStatus();
    const m = machine.manifest;
    const b = machine.bootStats;
    const ready = status.phase === "ready";
    const cmd = (c: string) => (
        <button className="cmd" disabled={!ready} onClick={() => runInTerminal(c)} title="Gõ lệnh này vào terminal">
            <code>{c}</code>
        </button>
    );
    return (
        <div className="app-about scroll">
            <h2>Máy Linux cho môn Lập trình hệ thống</h2>
            <p>
                Đây là <b>Debian GNU/Linux 12 (bookworm), kiến trúc i386 (32-bit)</b> thật, chạy trong trình duyệt nhờ
                trình giả lập x86 <a href="https://github.com/copy/v86" target="_blank" rel="noreferrer">v86</a> (WebAssembly).
                Mọi lệnh (<code>as</code>, <code>ld</code>, <code>gcc</code>, <code>g++</code>, <code>make</code>, <code>gdb</code>,
                <code>objdump</code>...) là chương trình Linux thật, nên kết quả, thông báo lỗi và mã thoát giống hệt máy Debian i386.
                Skin Ubuntu/Kali/Fedora chỉ là màu sắc.
            </p>

            <h3>Lab 1 - C/C++ thao tác bit</h3>
            <p>Mở <a href="#" onClick={e => { e.preventDefault(); openEditor(HOME + "/LTHT/Lab1/Lab1-template.cpp"); }}>~/LTHT/Lab1/Lab1-template.cpp</a>, sửa rồi bấm <b>▶ Biên dịch &amp; chạy</b> (F5), hoặc gõ:</p>
            {cmd("cd ~/LTHT/Lab1 && g++ Lab1-template.cpp -o lab1 && ./lab1")}
            <p className="muted small">Với tệp C thuần, dùng <code>gcc</code> (nhanh hơn <code>g++</code> + <code>&lt;iostream&gt;</code> trong máy ảo):</p>
            {cmd("cd ~/LTHT/Lab1 && gcc bits.c -o bits && ./bits")}

            <h3>Lab 2 - Assembly AT&amp;T 32-bit</h3>
            {cmd("cd ~/LTHT/Lab2 && as -o example.o example.s && ld -o example example.o && ./example")}
            {cmd("cd ~/LTHT/Lab2 && as -o echo.o echo.s && ld -o echo echo.o && ./echo")}
            {cmd("objdump -d ~/LTHT/Lab2/example")}
            {cmd("cd ~/LTHT/Lab2 && gdb ./example")}
            <p className="muted small">Trong gdb: <code>break _start</code>, <code>run</code>, <code>stepi</code>, <code>info registers</code>, <code>x/s &amp;output</code>, <code>quit</code>.</p>

            <h3>Phím tắt</h3>
            <ul className="small">
                <li>Terminal: Ctrl+C ngắt, Ctrl+D kết thúc nhập (EOF), Ctrl+Z tạm dừng (rồi <code>fg</code>), ↑/↓ lịch sử, Tab hoàn thành.</li>
                <li>Sao chép / dán trong terminal: Ctrl+Shift+C / Ctrl+Shift+V. Đổi cỡ chữ: Ctrl+= / Ctrl+-.</li>
                <li>Trình soạn thảo: Ctrl+S lưu, F5 hoặc Ctrl+Enter biên dịch &amp; chạy, Ctrl+F tìm, Ctrl+Z hoàn tác.</li>
                <li>Tệp: F2 đổi tên, Delete xoá, Ctrl+H hiện tệp ẩn, kéo-thả để di chuyển hoặc tải lên.</li>
            </ul>

            <h3>Thông tin máy</h3>
            <table className="kv small">
                <tbody>
                    <tr><td>Trạng thái</td><td>{status.message}</td></tr>
                    <tr><td>Phiên bản ảnh</td><td className="mono">{m ? `${m.version} (${m.created.slice(0, 10)})` : "?"}</td></tr>
                    <tr><td>Kích thước ảnh</td><td>{m ? `${m.files} tệp, ${formatSize(m.size)} (nén ${formatSize(m.compressed)}, tải theo nhu cầu)` : "?"}</td></tr>
                    <tr><td>RAM máy ảo</td><td>{machine.settings.memoryMB} MB</td></tr>
                    <tr><td>Khởi động gần nhất</td><td>{b ? `${(b.totalMs / 1000).toFixed(2)} s (${b.mode === "restore" ? "khôi phục ảnh chụp" : "khởi động lạnh"})` : "-"}</td></tr>
                    {b && <tr><td>Chi tiết (ms)</td><td className="mono">{Object.entries(b.detail).map(([k, v]) => `${k}=${v}`).join("  ")}</td></tr>}
                </tbody>
            </table>

            <h3>Mã nguồn mở và giấy phép</h3>
            <ul className="small">
                <li>v86 (BSD-2-Clause) - trình giả lập x86, © Fabian Hemmer và cộng sự. SeaBIOS (LGPLv3), VGABIOS (LGPLv2.1).</li>
                <li>Debian GNU/Linux 12 - mỗi gói theo giấy phép riêng, xem <code>/usr/share/doc/*/copyright</code> trong máy ảo.
                    Kernel Linux (GPLv2). Mã nguồn tương ứng có tại <a href="https://sources.debian.org/" target="_blank" rel="noreferrer">sources.debian.org</a> và snapshot.debian.org.</li>
                <li>xterm.js (MIT), CodeMirror 6 (MIT), React (MIT), fflate (MIT), Workbox (MIT).</li>
                <li>Không phải sản phẩm của Debian, Canonical, Offensive Security hay Red Hat. Các skin chỉ mô phỏng phối màu.</li>
            </ul>
        </div>
    );
}

export function LogApp() {
    useMachineStatus();
    return (
        <div className="app-log">
            <div className="toolbar small">
                <span className="muted">Nhật ký cổng nối tiếp ttyS0 (thông báo kernel khi khởi động lạnh, tác tử điều khiển)</span>
            </div>
            <pre className="log scroll">{machine.serialLog || "(trống - máy được khôi phục từ ảnh chụp nên không có nhật ký khởi động)"}</pre>
        </div>
    );
}

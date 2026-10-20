import { useEffect, useState } from "react";
import { machine } from "../../vm/machine";
import { HOME } from "../../vm/guestfs";
import * as idb from "../../vm/idb";
import { IMAGE_URL, PUBLIC_RELAY } from "../../vm/config";
import { SKINS, prefsStore, usePrefs } from "../prefs";
import { SkinLogo } from "../icons";
import { downloadBlob, formatSize, importZip, pickFiles, zipFolder } from "../actions";
import { useMachineStatus } from "../hooks";

export function SettingsApp() {
    const prefs = usePrefs();
    const status = useMachineStatus();
    const [mem, setMem] = useState(machine.settings.memoryMB);
    const [relay, setRelay] = useState(machine.settings.networkRelay);
    const [usage, setUsage] = useState<string>("");
    const [offline, setOffline] = useState<string>("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        idb.storageEstimate().then(e => e && setUsage(`${formatSize(e.usage)} / ${formatSize(e.quota)}`));
    }, [status.phase]);

    const vmChanged = mem !== machine.settings.memoryMB || relay !== machine.settings.networkRelay;

    async function applyVm() {
        if(relay && !/^(wss?|wisps?):\/\/|^fetch(:\/\/.*)?$/.test(relay)) {
            alert("URL mạng phải bắt đầu bằng wss://, ws://, wisp://, wisps:// hoặc là \"fetch\"");
            return;
        }
        if(!confirm("Cần khởi động lại máy ảo để áp dụng. Tệp của bạn được giữ nguyên. Tiếp tục?")) return;
        await machine.saveNow();
        await machine.saveSettings({ memoryMB: mem, networkRelay: relay.trim() });
        location.reload();
    }

    async function exportHome() {
        setBusy(true);
        try { downloadBlob(await zipFolder(HOME + "/LTHT"), "LTHT.zip"); }
        catch(e: any) { alert(e.message); }
        finally { setBusy(false); }
    }

    async function importHome() {
        const items = await pickFiles({ accept: ".zip,application/zip" });
        if(!items.length) return;
        const overwrite = confirm(`Giải nén "${items[0].file.name}" vào thư mục nhà (${HOME}).\n\nOK = ghi đè tệp trùng tên, Huỷ = giữ tệp đang có`);
        setBusy(true);
        try { alert(`Đã nhập ${await importZip(items[0].file, HOME, overwrite)} tệp`); }
        catch(e: any) { alert(e.message); }
        finally { setBusy(false); }
    }

    async function reset() {
        if(!confirm("ĐẶT LẠI MÁY sẽ XOÁ TOÀN BỘ tệp bạn đã tạo/sửa trong máy ảo và dựng lại từ ảnh gốc.\n\nNên xuất .zip trước. Tiếp tục?")) return;
        if(prompt('Gõ chữ "XOA" để xác nhận đặt lại máy:') !== "XOA") return;
        await machine.factoryReset();
    }

    async function cacheAll() {
        if(!machine.manifest) return;
        if(!confirm(`Tải toàn bộ ảnh Debian (~${formatSize(machine.manifest.compressed)}) vào bộ nhớ đệm để dùng offline hoàn toàn?`)) return;
        setOffline("Đang đọc danh sách tệp...");
        try {
            const fsj = await (await fetch(IMAGE_URL + "fs.json?v=" + machine.manifest.version)).json();
            for(const f of ["bzImage", "initrd.img"]) await fetch(IMAGE_URL + f + "?v=" + machine.manifest.version);
            const names = new Set<string>();
            const walk = (list: any[]) => {
                for(const e of list) {
                    if(Array.isArray(e[6])) walk(e[6]);
                    else if((e[3] & 0o170000) === 0o100000) names.add(e[6]);
                }
            };
            walk(fsj.fsroot);
            const all = [...names];
            let done = 0;
            const cache = await caches.open("ltht-image-base");
            const worker = async () => {
                while(all.length) {
                    const n = all.pop()!;
                    const url = new URL(IMAGE_URL + "base/" + n, location.href).href;
                    if(!await cache.match(url)) {
                        const r = await fetch(url);
                        if(r.ok) await cache.put(url, r);
                    }
                    if(++done % 50 === 0) setOffline(`Đã tải ${done}/${names.size} tệp...`);
                }
            };
            await Promise.all(Array.from({ length: 8 }, worker));
            setOffline(`Xong: ${names.size} tệp đã sẵn sàng offline.`);
        } catch(e: any) {
            setOffline("Lỗi: " + e.message);
        }
    }

    return (
        <div className="app-settings scroll">
            <section>
                <h3>Giao diện (skin)</h3>
                <p className="muted">Skin chỉ đổi màu sắc và biểu tượng. Hệ điều hành bên dưới luôn là Debian 12 (bookworm) i386.</p>
                <div className="skins">
                    {SKINS.map(s => (
                        <button key={s.id} className={"skin-card skin-" + s.id + (prefs.skin === s.id ? " active" : "")}
                                onClick={() => prefsStore.set({ skin: s.id })}>
                            <SkinLogo skin={s.id} size={28} />
                            <b>{s.name}</b>
                            <span className="muted">{s.note}</span>
                        </button>
                    ))}
                </div>
                <label className="field">Cỡ chữ terminal
                    <input type="range" min={10} max={28} value={prefs.termFontSize}
                           onChange={e => prefsStore.set({ termFontSize: +e.target.value })} />
                    <span>{prefs.termFontSize}px</span>
                </label>
                <label className="field">Cỡ chữ trình soạn thảo
                    <input type="range" min={10} max={28} value={prefs.editorFontSize}
                           onChange={e => prefsStore.set({ editorFontSize: +e.target.value })} />
                    <span>{prefs.editorFontSize}px</span>
                </label>
            </section>

            <section>
                <h3>Dự án và dữ liệu</h3>
                <p className="muted">Mọi thay đổi trên đĩa máy ảo được tự động lưu vào trình duyệt (IndexedDB) vài giây một lần.
                    Dung lượng đang dùng: {usage || "?"}{machine.persist ? `, ${machine.persist.changedCount} mục khác ảnh gốc` : ""}.</p>
                <div className="row-buttons">
                    <button onClick={exportHome} disabled={busy || status.phase !== "ready"}>Xuất thư mục dự án ~/LTHT (.zip)</button>
                    <button onClick={importHome} disabled={busy || status.phase !== "ready"}>Nhập .zip vào ~/</button>
                </div>
                <div className="row-buttons">
                    <button onClick={cacheAll} disabled={status.phase !== "ready"}>Tải toàn bộ ảnh để dùng offline</button>
                    {offline && <span className="muted">{offline}</span>}
                </div>
            </section>

            <section>
                <h3>Máy ảo</h3>
                <label className="field">Bộ nhớ RAM
                    <select value={mem} onChange={e => setMem(+e.target.value)}>
                        {[256, 384, 512, 768, 1024].map(m => <option key={m} value={m}>{m} MB</option>)}
                    </select>
                </label>
                <label className="field col">Mạng của máy ảo (relay v86)
                    <input type="text" placeholder="để trống = không có mạng; vd. wss://relay.widgetry.org/ hoặc ws://localhost:8080/" value={relay}
                           onChange={e => setRelay(e.target.value)} />
                </label>
                <div className="row-buttons">
                    <button onClick={() => setRelay(PUBLIC_RELAY)} disabled={relay === PUBLIC_RELAY}>Relay công cộng (mặc định)</button>
                    <button onClick={() => setRelay("")} disabled={!relay}>Tắt mạng</button>
                </div>
                <p className="muted small">Mặc định máy ảo có mạng qua relay công cộng của dự án v86 ({PUBLIC_RELAY}):
                    miễn phí, dùng chung, chậm và có thể quá tải. Khi bật, <b>mọi lưu lượng mạng của máy ảo đi qua relay đó</b>
                    (không gồm tệp của bạn, trừ khi bạn tự gửi lên mạng). Máy tự lấy IP khi khởi động; nếu mất mạng, chạy
                    <code>sudo ltht-net</code>. Kiểm tra: <code>curl -I https://deb.debian.org</code>. Có thể tự chạy relay riêng
                    (wsproxy/wisp) và nhập URL ở trên. Tắt mạng thì <code>apt</code> sẽ báo lỗi rõ ràng.</p>
                <div className="row-buttons">
                    <button className="primary" disabled={!vmChanged} onClick={applyVm}>Áp dụng và khởi động lại</button>
                    <button onClick={async () => { await machine.saveNow(); await machine.dropSnapshots(); location.reload(); }}>
                        Khởi động lại từ đầu (giữ tệp)
                    </button>
                </div>
            </section>

            <section className="danger-zone">
                <h3>Đặt lại máy</h3>
                <p className="muted">Xoá toàn bộ thay đổi và ảnh chụp, dựng lại máy từ ảnh Debian gốc (kèm thư mục mẫu ~/LTHT).</p>
                <button className="danger" onClick={reset}>Đặt lại máy...</button>
            </section>
        </div>
    );
}

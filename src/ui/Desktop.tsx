import { useEffect, useState, type ReactNode } from "react";
import { useWindows, wm, type AppKind, type Win } from "./wm";
import { WindowFrame } from "./WindowFrame";
import { MenuHost } from "./Menu";
import { usePrefs, SKINS } from "./prefs";
import { useMachineStatus, useNow } from "./hooks";
import { machine } from "../vm/machine";
import { HOME } from "../vm/guestfs";
import { IconEditor, IconFolder, IconHelp, IconLog, IconSettings, IconTerminal, SkinLogo } from "./icons";
import { TerminalApp } from "./apps/TerminalApp";
import { FilesApp } from "./apps/FilesApp";
import { EditorApp } from "./apps/EditorApp";
import { SettingsApp } from "./apps/SettingsApp";
import { AboutApp, LogApp } from "./apps/AboutApp";
import { openEditor, openFiles, openTerminal } from "./actions";

const ICONS: Record<AppKind, (s?: number) => ReactNode> = {
    terminal: (s = 16) => <IconTerminal size={s} />,
    files: (s = 16) => <IconFolder size={s} />,
    editor: (s = 16) => <IconEditor size={s} />,
    settings: (s = 16) => <IconSettings size={s} />,
    about: (s = 16) => <IconHelp size={s} />,
    log: (s = 16) => <IconLog size={s} />,
};

function AppBody({ win }: { win: Win }) {
    switch(win.app) {
        case "terminal": return <TerminalApp />;
        case "files": return <FilesApp winId={win.id} path={win.props.path} nav={win.props.nav} />;
        case "editor": return <EditorApp winId={win.id} path={win.props.path} />;
        case "settings": return <SettingsApp />;
        case "about": return <AboutApp />;
        case "log": return <LogApp />;
    }
}

function newEditor() {
    const name = prompt("Tên tệp mới trong ~/LTHT (vd. Lab1/bai1.c hoặc Lab2/bai1.s):", "Lab1/bai1.c");
    if(name) openEditor(HOME + "/LTHT/" + name.replace(/^\/+/, ""));
}

export function Desktop() {
    const wins = useWindows();
    const prefs = usePrefs();
    const status = useMachineStatus();
    const now = useNow();
    const [menuOpen, setMenuOpen] = useState(false);
    const [saved, setSaved] = useState<number | null>(null);
    const top = wm.topId();

    useEffect(() => { document.documentElement.dataset.skin = prefs.skin; }, [prefs.skin]);
    useEffect(() => {
        const t = setInterval(() => setSaved(machine.persist?.lastSaveTime || null), 3000);
        return () => clearInterval(t);
    }, []);
    useEffect(() => {
        if(!menuOpen) return;
        const close = () => setMenuOpen(false);
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [menuOpen]);

    const launchers: Array<{ app: AppKind, label: string, run: () => void }> = [
        { app: "terminal", label: "Terminal", run: openTerminal },
        { app: "files", label: "Tệp", run: () => openFiles() },
        { app: "editor", label: "Trình soạn thảo", run: newEditor },
    ];

    const phaseClass = status.phase === "ready" ? "ok" : status.phase === "error" ? "err" : "busy";
    const skinName = SKINS.find(s => s.id === prefs.skin)?.name;

    return (
        <div className="desktop">
            <div className="wallpaper" />
            <div className="desktop-icons">
                <button className="dicon" onDoubleClick={openTerminal} onClick={e => e.detail === 1 && (e.currentTarget as HTMLElement).focus()}>
                    <IconTerminal size={44} /><span>Terminal</span>
                </button>
                <button className="dicon" onDoubleClick={() => openFiles()}>
                    <IconFolder size={44} /><span>Thư mục nhà</span>
                </button>
                <button className="dicon" onDoubleClick={() => openFiles(HOME + "/LTHT")}>
                    <IconFolder size={44} /><span>LTHT</span>
                </button>
                <button className="dicon" onDoubleClick={() => openEditor(HOME + "/LTHT/Lab1/Lab1-template.cpp")}>
                    <IconEditor size={44} /><span>Lab1-template.cpp</span>
                </button>
                <button className="dicon" onDoubleClick={() => openEditor(HOME + "/LTHT/Lab2/example.s")}>
                    <IconEditor size={44} /><span>example.s</span>
                </button>
                <button className="dicon" onDoubleClick={() => wm.open("about", {}, "Hướng dẫn và thông tin")}>
                    <IconHelp size={44} /><span>Hướng dẫn</span>
                </button>
            </div>

            {wins.map(w => (
                <WindowFrame key={w.id} win={w} active={w.id === top} icon={ICONS[w.app](16)}>
                    <AppBody win={w} />
                </WindowFrame>
            ))}

            {status.phase === "error" && (
                <div className="boot-error">
                    <b>Không khởi động được máy ảo</b>
                    <p>{status.message}</p>
                    <button onClick={() => location.reload()}>Thử lại</button>
                </div>
            )}

            {menuOpen && (
                <div className="startmenu" onPointerDown={e => e.stopPropagation()}>
                    <div className="sm-head"><SkinLogo skin={prefs.skin} size={30} />
                        <div><b>LTHT Linux Lab</b><div className="muted small">Debian 12 i386 · {skinName}</div></div></div>
                    {[
                        { icon: ICONS.terminal(22), label: "Terminal", run: openTerminal },
                        { icon: ICONS.files(22), label: "Tệp", run: () => openFiles() },
                        { icon: ICONS.editor(22), label: "Trình soạn thảo (tệp mới)", run: newEditor },
                        { icon: ICONS.files(22), label: "Lab 1 (C/C++)", run: () => openFiles(HOME + "/LTHT/Lab1") },
                        { icon: ICONS.files(22), label: "Lab 2 (Assembly)", run: () => openFiles(HOME + "/LTHT/Lab2") },
                        { icon: ICONS.settings(22), label: "Cài đặt, xuất/nhập .zip, đặt lại máy", run: () => wm.open("settings", {}, "Cài đặt") },
                        { icon: ICONS.log(22), label: "Nhật ký khởi động", run: () => wm.open("log", {}, "Nhật ký khởi động (ttyS0)") },
                        { icon: ICONS.about(22), label: "Hướng dẫn và thông tin", run: () => wm.open("about", {}, "Hướng dẫn và thông tin") },
                    ].map((it, i) => (
                        <button key={i} onClick={() => { setMenuOpen(false); it.run(); }}>{it.icon}<span>{it.label}</span></button>
                    ))}
                </div>
            )}

            <div className="taskbar">
                <button className={"start" + (menuOpen ? " open" : "")} title="Ứng dụng"
                        onPointerDown={e => e.stopPropagation()} onClick={() => setMenuOpen(o => !o)}>
                    <SkinLogo skin={prefs.skin} size={24} />
                </button>
                {launchers.map(l => (
                    <button key={l.app} className="launcher" title={l.label} onClick={l.run}>{ICONS[l.app](24)}</button>
                ))}
                <div className="tasks">
                    {wins.map(w => (
                        <button key={w.id} className={"task" + (w.id === top ? " active" : "") + (w.minimized ? " min" : "")}
                                title={w.title}
                                onClick={() => (w.id === top && !w.minimized) ? wm.minimize(w.id) : wm.focus(w.id)}>
                            {ICONS[w.app](16)}<span>{w.title}</span>
                        </button>
                    ))}
                </div>
                <div className="tray">
                    <span className={"vmstate " + phaseClass} title={status.message}
                          onClick={() => wm.open("about", {}, "Hướng dẫn và thông tin")}>
                        <i />{status.phase === "ready" ? "Debian i386" : status.phase === "error" ? "Lỗi" : (status.message || "Đang chuẩn bị...").slice(0, 46)}
                        {status.progress !== undefined && status.phase !== "ready" && <progress value={status.progress} max={1} />}
                    </span>
                    {status.phase === "ready" && (
                        <span className="saved" title={machine.persist?.lastError ? "Lỗi lưu: " + machine.persist.lastError : "Đĩa máy ảo được tự động lưu vào trình duyệt"}>
                            {machine.persist?.lastError ? "⚠ Lỗi lưu" : saved ? "✓ Đã lưu" : "Đang lưu"}
                        </span>
                    )}
                    <span className="clock">{now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}<br />
                        <small>{now.toLocaleDateString("vi-VN")}</small></span>
                </div>
            </div>
            <MenuHost />
        </div>
    );
}

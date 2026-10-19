import { useEffect, useState, type ReactNode } from "react";
import { useWindows, wm, type AppKind, type Win } from "./wm";
import { WindowFrame } from "./WindowFrame";
import { MenuHost } from "./Menu";
import { usePrefs, SKINS } from "./prefs";
import { useMachineStatus, useNow } from "./hooks";
import { machine } from "../vm/machine";
import { HOME } from "../vm/guestfs";
import { IconEditor, IconFolder, IconHelp, IconLog, IconPenguin, IconSettings, IconTerminal, SkinLogo } from "./icons";
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

function GitHubMark({ size = 16 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
    );
}

function toggleFullscreen() {
    const d = document as any;
    if(document.fullscreenElement || d.webkitFullscreenElement) {
        (document.exitFullscreen || d.webkitExitFullscreen).call(document);
    } else {
        const el = document.documentElement as any;
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: "hide" })?.catch?.(() => { /* bỏ qua */ });
    }
}

function useFullscreen() {
    const [fs, setFs] = useState(!!document.fullscreenElement);
    useEffect(() => {
        const on = () => setFs(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
        document.addEventListener("fullscreenchange", on);
        document.addEventListener("webkitfullscreenchange", on);
        return () => { document.removeEventListener("fullscreenchange", on); document.removeEventListener("webkitfullscreenchange", on); };
    }, []);
    return fs;
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
    const fullscreen = useFullscreen();

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
            <div className="wallpaper-mark" aria-hidden>
                <IconPenguin size={150} />
                <span className="wm-title">TuxLab</span>
                <span className="wm-sub">Debian GNU/Linux · i386 · in your browser</span>
            </div>
            <a className="watermark" href="https://github.com/h2n07" target="_blank" rel="noreferrer" title="github.com/h2n07">
                <GitHubMark size={18} />
                <span><b>h2n07</b><small>github.com/h2n07</small></span>
            </a>
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
                        <div><b>TuxLab</b><div className="muted small">Debian 12 i386 · {skinName}</div></div></div>
                    {[
                        { icon: ICONS.terminal(22), label: "Terminal", run: openTerminal },
                        { icon: ICONS.files(22), label: "Tệp", run: () => openFiles() },
                        { icon: ICONS.editor(22), label: "Trình soạn thảo (tệp mới)", run: newEditor },
                        { icon: ICONS.files(22), label: "Lab 1 (C/C++)", run: () => openFiles(HOME + "/LTHT/Lab1") },
                        { icon: ICONS.files(22), label: "Lab 2 (Assembly)", run: () => openFiles(HOME + "/LTHT/Lab2") },
                        { icon: ICONS.settings(22), label: "Cài đặt, xuất/nhập .zip, đặt lại máy", run: () => wm.open("settings", {}, "Cài đặt") },
                        { icon: ICONS.log(22), label: "Nhật ký khởi động", run: () => wm.open("log", {}, "Nhật ký khởi động (ttyS0)") },
                        { icon: ICONS.about(22), label: "Hướng dẫn và thông tin", run: () => wm.open("about", {}, "Hướng dẫn và thông tin") },
                        { icon: <span className="fs-ico">⛶</span>, label: fullscreen ? "Thoát toàn màn hình" : "Toàn màn hình", run: toggleFullscreen },
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
                    <button className="fsbtn" onClick={toggleFullscreen} title={fullscreen ? "Thoát toàn màn hình (Esc)" : "Toàn màn hình"}
                            aria-label="Toàn màn hình">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            {fullscreen
                                ? <path d="M7 2v5H2M11 2v5h5M7 16v-5H2M11 16v-5h5" />
                                : <path d="M2 7V2h5M16 7V2h-5M2 11v5h5M16 11v5h-5" />}
                        </svg>
                    </button>
                    <span className="clock">{now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}<br />
                        <small>{now.toLocaleDateString("vi-VN")}</small></span>
                </div>
            </div>
            <MenuHost />
        </div>
    );
}

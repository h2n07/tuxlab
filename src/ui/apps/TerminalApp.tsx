import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { machine } from "../../vm/machine";
import { prefsStore, usePrefs } from "../prefs";
import { useMachineStatus } from "../hooks";

let activeTerm: Terminal | null = null;

/** Đưa con trỏ bàn phím vào terminal (sau khi bấm "Biên dịch & chạy"). */
export function focusTerminal() {
    setTimeout(() => activeTerm?.focus(), 50);
}

const THEMES: Record<string, any> = {
    ubuntu: { background: "#300a24", foreground: "#eeeeec", cursor: "#eeeeec", selectionBackground: "#6a4a64",
              black: "#2e3436", red: "#cc0000", green: "#4e9a06", yellow: "#c4a000", blue: "#3465a4",
              magenta: "#75507b", cyan: "#06989a", white: "#d3d7cf", brightBlack: "#555753", brightRed: "#ef2929",
              brightGreen: "#8ae234", brightYellow: "#fce94f", brightBlue: "#729fcf", brightMagenta: "#ad7fa8",
              brightCyan: "#34e2e2", brightWhite: "#eeeeec" },
    kali: { background: "#1a1b26", foreground: "#d6dbe5", cursor: "#43b0ff", selectionBackground: "#2f4a6a",
            black: "#1a1b26", red: "#f7768e", green: "#4ece5a", yellow: "#e0af68", blue: "#43b0ff",
            magenta: "#bb9af7", cyan: "#2ac3de", white: "#c0caf5", brightBlack: "#565f89", brightRed: "#ff7a93",
            brightGreen: "#73ff8a", brightYellow: "#ffd479", brightBlue: "#7aa2f7", brightMagenta: "#c8a6ff",
            brightCyan: "#7dcfff", brightWhite: "#ffffff" },
    fedora: { background: "#1e1f22", foreground: "#e6e6e6", cursor: "#e6e6e6", selectionBackground: "#3c6eb4",
              black: "#1e1f22", red: "#e5534b", green: "#57ab5a", yellow: "#c69026", blue: "#539bf5",
              magenta: "#b083f0", cyan: "#39c5cf", white: "#cdd9e5", brightBlack: "#636e7b", brightRed: "#ff938a",
              brightGreen: "#6bc46d", brightYellow: "#daaa3f", brightBlue: "#6cb6ff", brightMagenta: "#dcbdfb",
              brightCyan: "#56d4dd", brightWhite: "#ffffff" },
};

export function TerminalApp() {
    const host = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const prefs = usePrefs();
    const status = useMachineStatus();
    const [size, setSize] = useState("80x24");

    useEffect(() => {
        const term = new Terminal({
            fontFamily: '"DejaVu Sans Mono", "Ubuntu Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace',
            fontSize: prefsStore.get().termFontSize,
            cursorBlink: true,
            scrollback: 5000,
            theme: THEMES[prefsStore.get().skin] || THEMES.ubuntu,
            allowProposedApi: false,
            rightClickSelectsWord: false,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());
        term.open(host.current!);
        termRef.current = term;
        fitRef.current = fit;
        activeTerm = term;

        // Phím tắt giống GNOME Terminal: Ctrl+Shift+C / Ctrl+Shift+V. Ctrl+C, Ctrl+D, Ctrl+Z... đi thẳng vào Linux.
        term.attachCustomKeyEventHandler((ev) => {
            if(ev.type !== "keydown") return true;
            const k = ev.key.toLowerCase();
            if(ev.ctrlKey && ev.shiftKey && k === "c") { copySelection(term); ev.preventDefault(); return false; }
            // Ctrl+Shift+V: để trình duyệt tự phát sự kiện paste vào xterm (không cần quyền clipboard).
            if(ev.ctrlKey && ev.shiftKey && k === "v") return false;
            if(ev.ctrlKey && (k === "=" || k === "+")) { zoom(1); ev.preventDefault(); return false; }
            if(ev.ctrlKey && k === "-") { zoom(-1); ev.preventDefault(); return false; }
            return true;
        });

        const enc = new TextEncoder();
        const sub = term.onData((d) => machine.writeConsole(enc.encode(d)));
        const subBin = term.onBinary((d) => {
            const b = new Uint8Array(d.length);
            for(let i = 0; i < d.length; i++) b[i] = d.charCodeAt(i) & 0xff;
            machine.writeConsole(b);
        });
        const detach = machine.attachConsole((bytes) => term.write(bytes));

        const doFit = () => {
            try {
                fit.fit();
                machine.resize(term.cols, term.rows);
                setSize(`${term.cols}x${term.rows}`);
            } catch { /* ẩn/thu nhỏ */ }
        };
        const ro = new ResizeObserver(() => requestAnimationFrame(doFit));
        ro.observe(host.current!);
        doFit();
        term.focus();

        return () => {
            ro.disconnect();
            sub.dispose();
            subBin.dispose();
            detach();
            term.dispose();
            if(activeTerm === term) activeTerm = null;
        };
    }, []);

    useEffect(() => {
        const t = termRef.current;
        if(!t) return;
        t.options.fontSize = prefs.termFontSize;
        t.options.theme = THEMES[prefs.skin] || THEMES.ubuntu;
        requestAnimationFrame(() => {
            try {
                fitRef.current?.fit();
                machine.resize(t.cols, t.rows);
                setSize(`${t.cols}x${t.rows}`);
            } catch { /* bỏ qua */ }
        });
    }, [prefs.termFontSize, prefs.skin]);

    function zoom(d: number) {
        const s = Math.max(9, Math.min(32, prefsStore.get().termFontSize + d));
        prefsStore.set({ termFontSize: s });
    }

    const busy = status.phase !== "ready" && status.phase !== "error";
    return (
        <div className="app-terminal">
            <div className="toolbar small">
                <button onClick={() => copySelection(termRef.current!)} title="Sao chép (Ctrl+Shift+C)">Sao chép</button>
                <button onClick={() => pasteInto(termRef.current!)} title="Dán (Ctrl+Shift+V)">Dán</button>
                <span className="sep" />
                <button onClick={() => zoom(-1)} title="Chữ nhỏ hơn (Ctrl+-)">A−</button>
                <span className="muted">{prefs.termFontSize}px</span>
                <button onClick={() => zoom(1)} title="Chữ lớn hơn (Ctrl+=)">A+</button>
                <span className="sep" />
                <button onClick={() => { machine.writeConsole("\x03"); termRef.current?.focus(); }} title="Gửi Ctrl+C (ngắt chương trình)">Ctrl+C</button>
                <button onClick={() => { machine.writeConsole("\x04"); termRef.current?.focus(); }} title="Gửi Ctrl+D (hết dữ liệu vào / EOF)">Ctrl+D</button>
                <span className="grow" />
                <span className="muted" title="Kích thước terminal (cột x dòng) - stty size trong Linux trả về giá trị này">{size}</span>
            </div>
            <div className="term-host" ref={host} onClick={() => termRef.current?.focus()} />
            {busy && (
                <div className="term-overlay">
                    <div className="spinner" />
                    <div>{status.message || "Đang chuẩn bị máy ảo..."}</div>
                    {status.progress !== undefined && <progress value={status.progress} max={1} />}
                </div>
            )}
        </div>
    );
}

function copySelection(term: Terminal) {
    const s = term.getSelection();
    if(s) navigator.clipboard?.writeText(s).catch(() => { /* bỏ qua */ });
    term.focus();
}

async function pasteInto(term: Terminal) {
    try {
        const text = await navigator.clipboard.readText();
        if(text) term.paste(text);
    } catch {
        alert("Trình duyệt chặn đọc clipboard. Hãy dùng Ctrl+Shift+V hoặc chuột phải > Dán trong terminal.");
    }
    term.focus();
}

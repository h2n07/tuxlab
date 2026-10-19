import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
    EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
    highlightSpecialChars, rectangularSelection, crosshairCursor, dropCursor,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import {
    bracketMatching, foldGutter, foldKeymap, indentOnInput, StreamLanguage, syntaxHighlighting,
    defaultHighlightStyle,
} from "@codemirror/language";
import { cpp } from "@codemirror/lang-cpp";
import { gas } from "@codemirror/legacy-modes/mode/gas";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { oneDark } from "@codemirror/theme-one-dark";
import { machine } from "../../vm/machine";
import { basename, dirname, HOME, FsError } from "../../vm/guestfs";
import { useFsVersion, useMachineStatus } from "../hooks";
import { prefsStore, usePrefs } from "../prefs";
import { wm } from "../wm";
import { buildCommand, extOf, runInTerminal, openFiles, downloadEntry } from "../actions";

function languageFor(name: string): Extension {
    const ext = extOf(name);
    if(["c", "h", "cpp", "cc", "cxx", "hpp", "hh"].includes(ext)) return cpp();
    if(["s", "S", "asm", "inc"].includes(ext)) return StreamLanguage.define(gas);
    if(ext === "sh" || name === ".bashrc" || name === ".profile") return StreamLanguage.define(shell);
    return [];
}

function languageLabel(name: string): string {
    const ext = extOf(name);
    if(ext === "c" || ext === "h") return "C";
    if(["cpp", "cc", "cxx", "hpp", "hh"].includes(ext)) return "C++";
    if(["s", "S"].includes(ext)) return "Assembly (AT&T / GNU as)";
    if(ext === "asm") return "Assembly";
    if(ext === "sh") return "Shell";
    if(name === "Makefile") return "Makefile";
    return "Văn bản";
}

export function EditorApp({ winId, path }: { winId: string, path: string }) {
    const host = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const fontComp = useRef(new Compartment());
    const loaded = useRef<{ mtime: number, size: number, text: string } | null>(null);
    const [dirty, setDirty] = useState(false);
    const [msg, setMsg] = useState<string>("");
    const [cursor, setCursor] = useState("1:1");
    const prefs = usePrefs();
    const status = useMachineStatus();
    const ver = useFsVersion();
    const name = basename(path);
    const dirtyRef = useRef(false);
    dirtyRef.current = dirty;

    const fontTheme = (size: number) => EditorView.theme({
        "&": { fontSize: size + "px", height: "100%" },
        ".cm-scroller": { fontFamily: '"DejaVu Sans Mono", "Ubuntu Mono", "Cascadia Mono", Consolas, monospace' },
    });

    // tạo editor một lần
    useEffect(() => {
        const save = () => { doSave(); return true; };
        const run = () => { compileRun(); return true; };
        const state = EditorState.create({
            doc: "",
            extensions: [
                lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(),
                drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true), indentOnInput(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }), bracketMatching(), closeBrackets(),
                autocompletion(), rectangularSelection(), crosshairCursor(), highlightActiveLine(),
                highlightSelectionMatches(), EditorState.tabSize.of(4),
                keymap.of([
                    { key: "Mod-s", run: save, preventDefault: true },
                    { key: "F5", run, preventDefault: true },
                    { key: "Ctrl-Enter", run, preventDefault: true },
                    ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap,
                    ...completionKeymap, indentWithTab,
                ]),
                languageFor(name),
                oneDark,
                fontComp.current.of(fontTheme(prefsStore.get().editorFontSize)),
                EditorView.updateListener.of(u => {
                    if(u.docChanged && loaded.current) setDirty(u.state.doc.toString() !== loaded.current.text);
                    if(u.selectionSet || u.docChanged) {
                        const pos = u.state.selection.main.head;
                        const line = u.state.doc.lineAt(pos);
                        setCursor(`${line.number}:${pos - line.from + 1}`);
                    }
                }),
            ],
        });
        const view = new EditorView({ state, parent: host.current! });
        viewRef.current = view;
        wm.setCloseGuard(winId, () => !dirtyRef.current || confirm(`"${name}" có thay đổi chưa lưu. Đóng mà không lưu?`));
        return () => { view.destroy(); wm.setCloseGuard(winId, null); };
    }, [path]);

    useEffect(() => {
        viewRef.current?.dispatch({ effects: fontComp.current.reconfigure(fontTheme(prefs.editorFontSize)) });
    }, [prefs.editorFontSize]);

    useEffect(() => { wm.setTitle(winId, (dirty ? "● " : "") + name + " - Trình soạn thảo"); }, [dirty, name, winId]);

    // nạp tệp khi máy sẵn sàng; tự nạp lại nếu tệp bị đổi từ terminal mà chưa sửa gì
    useEffect(() => {
        if(status.phase !== "ready" || !machine.gfs) return;
        const st = machine.gfs.stat(path);
        if(!st) {
            if(loaded.current) setMsg("Tệp đã bị xoá hoặc đổi tên bên ngoài. Lưu (Ctrl+S) sẽ tạo lại tệp.");
            else if(!loaded.current) { loaded.current = { mtime: 0, size: 0, text: "" }; setMsg("Tệp mới (chưa có trên đĩa)"); }
            return;
        }
        if(loaded.current && loaded.current.mtime === st.mtime && loaded.current.size === st.size) return;
        if(loaded.current && dirtyRef.current) {
            setMsg("Tệp vừa bị thay đổi bên ngoài (terminal). Lưu sẽ ghi đè thay đổi đó.");
            return;
        }
        machine.gfs.readText(path).then(text => {
            const view = viewRef.current!;
            const first = !loaded.current;
            loaded.current = { mtime: st.mtime, size: st.size, text };
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
            setDirty(false);
            setMsg(first ? "" : "Đã nạp lại vì tệp thay đổi bên ngoài");
            if(first) view.focus();
        }).catch(e => setMsg("Không đọc được tệp: " + e.message));
    }, [status.phase, ver, path]);

    async function doSave(): Promise<boolean> {
        const view = viewRef.current;
        if(!view || !machine.gfs) return false;
        const text = view.state.doc.toString();
        try {
            await machine.gfs.write(path, text);
            const st = machine.gfs.stat(path)!;
            loaded.current = { mtime: st.mtime, size: st.size, text };
            setDirty(false);
            setMsg("Đã lưu " + new Date().toLocaleTimeString("vi-VN"));
            machine.saveNow();
            return true;
        } catch(e: any) {
            setMsg(e instanceof FsError ? e.message : "Lỗi khi lưu: " + e.message);
            return false;
        }
    }

    async function compileRun() {
        const cmd = buildCommand(path);
        if(!cmd) { setMsg("Chưa biết cách biên dịch loại tệp này"); return; }
        if(dirtyRef.current && !await doSave()) return;
        runInTerminal(cmd);
    }

    function zoom(d: number) {
        prefsStore.set({ editorFontSize: Math.max(9, Math.min(32, prefsStore.get().editorFontSize + d)) });
    }

    const cmd = buildCommand(path);
    const shortPath = path.startsWith(HOME) ? "~" + path.slice(HOME.length) : path;
    return (
        <div className="app-editor">
            <div className="toolbar">
                <button onClick={doSave} disabled={!dirty} title="Lưu vào máy ảo (Ctrl+S)">Lưu</button>
                <button className="primary" onClick={compileRun} disabled={!cmd || status.phase !== "ready"}
                        title={cmd ? "Mở terminal và gõ: " + cmd + "  (F5)" : "Không hỗ trợ loại tệp này"}>
                    ▶ Biên dịch &amp; chạy
                </button>
                <span className="sep" />
                <button onClick={() => zoom(-1)} title="Chữ nhỏ hơn">A−</button>
                <button onClick={() => zoom(1)} title="Chữ lớn hơn">A+</button>
                <button onClick={() => openFiles(dirname(path))} title="Mở thư mục chứa tệp">Thư mục</button>
                <button onClick={() => downloadEntry(path)} title="Tải tệp về máy thật">Tải xuống</button>
                <span className="grow" />
                {cmd && <code className="cmd-preview" title="Lệnh sẽ được gõ vào terminal">{cmd}</code>}
            </div>
            <div className="editor-host" ref={host} />
            <div className="statusbar">
                <span className="mono">{shortPath}</span>
                <span>{dirty ? "● Chưa lưu" : "Đã lưu"}</span>
                {msg && <span className="muted">{msg}</span>}
                <span className="grow" />
                <span className="muted">{languageLabel(name)}</span>
                <span className="muted">Dòng:Cột {cursor}</span>
            </div>
        </div>
    );
}

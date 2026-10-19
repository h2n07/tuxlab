import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as RMouseEvent } from "react";
import { machine } from "../../vm/machine";
import { HOME, basename, dirname, join, normalize, type Entry, FsError } from "../../vm/guestfs";
import { useFsVersion, useMachineStatus } from "../hooks";
import { prefsStore, usePrefs } from "../prefs";
import { wm } from "../wm";
import { IconBinary, IconFile, IconFolder, IconLink } from "../icons";
import {
    buildCommand, collectDropped, downloadEntry, extOf, formatMode, formatSize, importZip, openPath,
    pickFiles, runInTerminal, shq, uploadFiles, zipFolder, downloadBlob, openEditor,
} from "../actions";
import { showMenu, type MenuItem } from "../Menu";

const PLACES = [
    { label: "Thư mục nhà", path: HOME },
    { label: "LTHT", path: HOME + "/LTHT" },
    { label: "Lab1", path: HOME + "/LTHT/Lab1" },
    { label: "Lab2", path: HOME + "/LTHT/Lab2" },
    { label: "Hệ thống tệp ( / )", path: "/" },
    { label: "/tmp (trong RAM)", path: "/tmp" },
    { label: "/usr/include", path: "/usr/include" },
];

const DND_TYPE = "application/x-ltht-paths";

function report(e: any) {
    alert(e instanceof FsError ? e.message : "Lỗi: " + (e && e.message || e));
}

function isExecutable(e: Entry) {
    return e.type === "file" && (e.mode & 0o111) !== 0;
}

function EntryIcon({ e, size = 20 }: { e: Entry, size?: number }) {
    const t = e.type === "link" ? e.targetType : e.type;
    let icon;
    if(t === "dir") icon = <IconFolder size={size} />;
    else if(isExecutable(e) && !extOf(e.name)) icon = <IconBinary size={size} />;
    else icon = <IconFile size={size} ext={extOf(e.name) || undefined} />;
    return <span className="entry-icon">{icon}{e.type === "link" && <span className="link-badge"><IconLink /></span>}</span>;
}

export function FilesApp({ winId, path: initialPath, nav }: { winId: string, path?: string, nav?: number }) {
    const status = useMachineStatus();
    const ver = useFsVersion();
    const prefs = usePrefs();
    const [cwd, setCwd] = useState(normalize(initialPath || HOME));
    const [history, setHistory] = useState<string[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [editingPath, setEditingPath] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [sort, setSort] = useState<{ key: "name" | "size" | "mtime", dir: 1 | -1 }>({ key: "name", dir: 1 });
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const lastClicked = useRef<string | null>(null);

    useEffect(() => { if(initialPath) go(initialPath, false); }, [initialPath, nav]);
    useEffect(() => { wm.setTitle(winId, `${cwd === HOME ? "Thư mục nhà" : basename(cwd) || "/"} - Tệp`); }, [cwd, winId]);

    const ready = status.phase === "ready" && machine.gfs;
    const { entries, error } = useMemo(() => {
        if(!ready) return { entries: [] as Entry[], error: null };
        try {
            let list = machine.gfs!.list(cwd);
            if(!prefs.showHidden) list = list.filter(e => !e.name.startsWith("."));
            const isDir = (e: Entry) => (e.type === "dir" || (e.type === "link" && e.targetType === "dir")) ? 0 : 1;
            list.sort((a, b) => isDir(a) - isDir(b) || (sort.key === "name"
                ? a.name.localeCompare(b.name, "vi", { numeric: true })
                : (a[sort.key] - b[sort.key])) * sort.dir);
            return { entries: list, error: null };
        } catch(e: any) {
            return { entries: [] as Entry[], error: e.message as string };
        }
    }, [ready, cwd, ver, prefs.showHidden, sort]);

    function go(p: string, push = true) {
        const n = normalize(p);
        if(push && n !== cwd) setHistory(h => [...h.slice(-30), cwd]);
        setCwd(n);
        setSelected(new Set());
        setRenaming(null);
    }

    function back() {
        const prev = history[history.length - 1];
        if(prev) { setHistory(h => h.slice(0, -1)); go(prev, false); }
    }

    function clickEntry(e: Entry, ev: RMouseEvent) {
        const next = new Set(ev.ctrlKey || ev.metaKey ? selected : []);
        if(ev.shiftKey && lastClicked.current) {
            const a = entries.findIndex(x => x.path === lastClicked.current);
            const b = entries.findIndex(x => x.path === e.path);
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for(let i = lo; i <= hi; i++) next.add(entries[i].path);
        } else if((ev.ctrlKey || ev.metaKey) && selected.has(e.path)) {
            next.delete(e.path);
        } else {
            next.add(e.path);
        }
        lastClicked.current = e.path;
        setSelected(next);
    }

    function open(e: Entry) {
        const isDir = e.type === "dir" || (e.type === "link" && e.targetType === "dir");
        if(isDir) go(e.type === "link" ? resolveLinkDir(e) : e.path);
        else openPath(e).catch(report);
    }

    function resolveLinkDir(e: Entry) {
        const t = e.target || "";
        return t.startsWith("/") ? t : join(dirname(e.path), t);
    }

    async function run(label: string, fn: () => Promise<any> | any) {
        try { setBusy(label); await fn(); }
        catch(e) { report(e); }
        finally { setBusy(null); }
    }

    const g = () => machine.gfs!;

    function newFolder() {
        run("Tạo thư mục", () => {
            const name = g().uniqueName(cwd, "Thư mục mới");
            g().mkdir(join(cwd, name));
            setSelected(new Set([join(cwd, name)]));
            setRenaming(join(cwd, name));
        });
    }

    function newFile() {
        run("Tạo tệp", async () => {
            const name = g().uniqueName(cwd, "tep-moi", ".c");
            await g().write(join(cwd, name), "");
            setSelected(new Set([join(cwd, name)]));
            setRenaming(join(cwd, name));
        });
    }

    async function commitRename(path: string, newName: string) {
        setRenaming(null);
        newName = newName.trim();
        if(!newName || newName === basename(path)) return;
        if(newName.includes("/")) { alert("Tên không được chứa dấu /"); return; }
        await run("Đổi tên", () => g().rename(path, join(dirname(path), newName)));
        setSelected(new Set([join(dirname(path), newName)]));
    }

    function remove(paths: string[]) {
        if(!paths.length) return;
        const names = paths.map(p => basename(p)).join(", ");
        if(!confirm(`Xoá vĩnh viễn ${paths.length > 1 ? paths.length + " mục" : `"${names}"`}?\n(Giống lệnh rm -r, không có thùng rác.)`)) return;
        run("Xoá", () => { for(const p of paths) g().remove(p); setSelected(new Set()); });
    }

    async function moveInto(paths: string[], dir: string, copy: boolean) {
        await run(copy ? "Sao chép" : "Di chuyển", async () => {
            for(const p of paths) {
                if(dirname(p) === normalize(dir) && !copy) continue;
                const dest = join(dir, copy && dirname(p) === normalize(dir) ? g().uniqueName(dir, basename(p) + " (bản sao)") : basename(p));
                if(copy) await g().copy(p, dest); else await g().rename(p, dest);
            }
        });
    }

    async function upload(dirMode: boolean) {
        const items = await pickFiles({ directory: dirMode });
        if(items.length) await run("Tải lên", () => uploadFiles(items, cwd));
    }

    async function exportZip(dir = cwd) {
        await run("Nén zip", async () => downloadBlob(await zipFolder(dir), (basename(dir) || "root") + ".zip"));
    }

    async function importZipHere() {
        const items = await pickFiles({ accept: ".zip,application/zip" });
        if(!items.length) return;
        const overwrite = confirm("Ghi đè các tệp trùng tên?\nOK = ghi đè, Huỷ = giữ tệp đang có");
        await run("Giải nén", async () => {
            const n = await importZip(items[0].file, cwd, overwrite);
            alert(`Đã giải nén ${n} tệp vào ${cwd}`);
        });
    }

    // ---- kéo-thả ----
    function onDragStartEntry(e: Entry, ev: DragEvent) {
        const paths = selected.has(e.path) ? [...selected] : [e.path];
        if(!selected.has(e.path)) setSelected(new Set([e.path]));
        ev.dataTransfer.setData(DND_TYPE, JSON.stringify(paths));
        ev.dataTransfer.setData("text/plain", paths.join("\n"));
        ev.dataTransfer.effectAllowed = "copyMove";
    }

    function onDragOver(target: string, ev: DragEvent) {
        const internal = ev.dataTransfer.types.includes(DND_TYPE);
        const external = ev.dataTransfer.types.includes("Files");
        if(!internal && !external) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = internal ? (ev.ctrlKey ? "copy" : "move") : "copy";
        setDropTarget(target);
    }

    async function onDrop(target: string, ev: DragEvent) {
        ev.preventDefault();
        ev.stopPropagation();
        setDropTarget(null);
        const internal = ev.dataTransfer.getData(DND_TYPE);
        if(internal) {
            const paths: string[] = JSON.parse(internal);
            if(paths.includes(target)) return;
            await moveInto(paths, target, ev.ctrlKey);
            return;
        }
        if(ev.dataTransfer.types.includes("Files")) {
            const items = await collectDropped(ev.dataTransfer);
            await run("Tải lên", () => uploadFiles(items, target));
        }
    }

    function contextMenu(ev: RMouseEvent, e: Entry | null) {
        ev.preventDefault();
        ev.stopPropagation();
        let sel = selected;
        if(e && !selected.has(e.path)) { sel = new Set([e.path]); setSelected(sel); }
        const paths = e ? [...sel] : [];
        const items: MenuItem[] = [];
        if(e) {
            const isDir = e.type === "dir" || (e.type === "link" && e.targetType === "dir");
            items.push({ label: isDir ? "Mở" : "Mở bằng Trình soạn thảo", action: () => isDir ? open(e) : openEditor(e.path) });
            const cmd = !isDir && buildCommand(e.path);
            if(cmd) items.push({ label: "Biên dịch & chạy", hint: cmd, action: () => runInTerminal(cmd) });
            if(isExecutable(e)) items.push({ label: "Chạy trong terminal", action: () => runInTerminal(`cd ${shq(dirname(e.path))} && ./${shq(e.name)}`) });
            items.push({ sep: true });
            items.push({ label: "Đổi tên", hint: "F2", disabled: paths.length !== 1, action: () => setRenaming(e.path) });
            items.push({ label: isDir ? "Tải xuống (.zip)" : "Tải xuống", action: () => run("Tải xuống", () => downloadEntry(e.path)) });
            items.push({ label: "Nhân bản", action: () => moveInto(paths, cwd, true) });
            items.push({ label: (e.mode & 0o111) ? "Bỏ quyền thực thi (chmod -x)" : "Cho phép thực thi (chmod +x)",
                         disabled: e.type !== "file",
                         action: () => run("chmod", () => g().chmod(e.path, (e.mode & 0o111) ? e.mode & ~0o111 : e.mode | 0o111)) });
            items.push({ sep: true });
            items.push({ label: "Xoá", hint: "Delete", danger: true, action: () => remove(paths) });
        } else {
            items.push({ label: "Thư mục mới", action: newFolder });
            items.push({ label: "Tệp mới", action: newFile });
            items.push({ sep: true });
            items.push({ label: "Tải tệp lên...", action: () => upload(false) });
            items.push({ label: "Tải thư mục lên...", action: () => upload(true) });
            items.push({ label: "Nhập .zip vào đây...", action: importZipHere });
            items.push({ label: "Xuất thư mục này (.zip)", action: () => exportZip() });
            items.push({ sep: true });
            items.push({ label: "Mở terminal tại đây", action: () => runInTerminal(`cd ${shq(cwd)}`) });
            items.push({ label: prefs.showHidden ? "Ẩn tệp ẩn" : "Hiện tệp ẩn", hint: "Ctrl+H", action: () => prefsStore.set({ showHidden: !prefs.showHidden }) });
        }
        showMenu(ev.clientX, ev.clientY, items);
    }

    function onKey(ev: React.KeyboardEvent) {
        if(renaming || editingPath !== null) return;
        const one = selected.size === 1 ? entries.find(e => selected.has(e.path)) : undefined;
        if(ev.key === "Delete") remove([...selected]);
        else if(ev.key === "F2" && one) setRenaming(one.path);
        else if(ev.key === "Enter" && one) open(one);
        else if(ev.key === "Backspace") go(dirname(cwd));
        else if(ev.ctrlKey && ev.key.toLowerCase() === "h") { ev.preventDefault(); prefsStore.set({ showHidden: !prefs.showHidden }); }
        else if(ev.ctrlKey && ev.key.toLowerCase() === "a") { ev.preventDefault(); setSelected(new Set(entries.map(e => e.path))); }
        else return;
        ev.preventDefault();
    }

    const crumbs = cwd === "/" ? [""] : cwd.split("/");
    const sortBy = (key: "name" | "size" | "mtime") => setSort(s => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }));
    const arrow = (key: string) => sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "";

    return (
        <div className="app-files" tabIndex={0} onKeyDown={onKey}>
            <div className="toolbar">
                <button onClick={back} disabled={!history.length} title="Quay lại">◀</button>
                <button onClick={() => go(dirname(cwd))} disabled={cwd === "/"} title="Lên thư mục cha (Backspace)">▲</button>
                {editingPath !== null ? (
                    <input className="pathbar" autoFocus value={editingPath}
                           onChange={e => setEditingPath(e.target.value)}
                           onBlur={() => setEditingPath(null)}
                           onKeyDown={e => {
                               if(e.key === "Enter") { const p = editingPath.replace(/^~/, HOME); setEditingPath(null); go(p); }
                               if(e.key === "Escape") setEditingPath(null);
                           }} />
                ) : (
                    <div className="crumbs" onDoubleClick={() => setEditingPath(cwd)} title="Nhấp đúp để gõ đường dẫn">
                        {crumbs.map((c, i) => {
                            const p = crumbs.slice(0, i + 1).join("/") || "/";
                            return <button key={i} className="crumb" onClick={() => go(p)}
                                           onDragOver={ev => onDragOver(p, ev)} onDrop={ev => onDrop(p, ev)}>{i === 0 ? "/" : c}</button>;
                        })}
                        <button className="crumb edit" onClick={() => setEditingPath(cwd)} title="Gõ đường dẫn">✎</button>
                    </div>
                )}
                <span className="grow" />
                <button onClick={newFolder} title="Thư mục mới">+ Thư mục</button>
                <button onClick={newFile} title="Tệp mới">+ Tệp</button>
                <button onClick={() => upload(false)} title="Tải tệp từ máy thật lên thư mục này">Tải lên</button>
                <button onClick={() => selected.size ? [...selected].forEach(p => run("Tải xuống", () => downloadEntry(p))) : exportZip()}
                        title="Tải mục đã chọn xuống (thư mục được nén .zip)">Tải xuống</button>
                <button onClick={() => runInTerminal(`cd ${shq(cwd)}`)} title="Mở terminal tại thư mục này">Terminal</button>
            </div>
            <div className="files-main">
                <nav className="sidebar">
                    {PLACES.map(p => (
                        <button key={p.path} className={cwd === p.path ? "active" : ""} onClick={() => go(p.path)}
                                onDragOver={ev => onDragOver(p.path, ev)} onDrop={ev => onDrop(p.path, ev)}>
                            <IconFolder size={16} /> {p.label}
                        </button>
                    ))}
                    <div className="sidebar-note">
                        Kéo tệp từ máy thật vào đây để tải lên. Kéo mục vào thư mục để di chuyển (giữ Ctrl để sao chép).
                    </div>
                </nav>
                <div className={"filelist" + (dropTarget === cwd ? " drop" : "")}
                     onContextMenu={ev => contextMenu(ev, null)}
                     onClick={ev => { if(ev.target === ev.currentTarget) setSelected(new Set()); }}
                     onDragOver={ev => onDragOver(cwd, ev)} onDragLeave={() => setDropTarget(null)}
                     onDrop={ev => onDrop(cwd, ev)}>
                    <div className="row head">
                        <span className="c-name" onClick={() => sortBy("name")}>Tên{arrow("name")}</span>
                        <span className="c-size" onClick={() => sortBy("size")}>Kích thước{arrow("size")}</span>
                        <span className="c-time" onClick={() => sortBy("mtime")}>Sửa đổi{arrow("mtime")}</span>
                        <span className="c-mode">Quyền</span>
                    </div>
                    {!ready && <div className="empty">Đang chờ máy ảo khởi động...</div>}
                    {error && <div className="empty error">{error}</div>}
                    {ready && !error && !entries.length && <div className="empty">Thư mục trống. Chuột phải để tạo mới hoặc kéo tệp vào đây.</div>}
                    {entries.map(e => {
                        const isDir = e.type === "dir" || (e.type === "link" && e.targetType === "dir");
                        return (
                            <div key={e.path}
                                 className={"row" + (selected.has(e.path) ? " sel" : "") + (dropTarget === e.path ? " drop" : "")}
                                 draggable={renaming !== e.path}
                                 onDragStart={ev => onDragStartEntry(e, ev)}
                                 onDragOver={isDir ? (ev => onDragOver(e.path, ev)) : undefined}
                                 onDragLeave={isDir ? (() => setDropTarget(null)) : undefined}
                                 onDrop={isDir ? (ev => onDrop(e.path, ev)) : undefined}
                                 onClick={ev => clickEntry(e, ev)}
                                 onDoubleClick={() => open(e)}
                                 onContextMenu={ev => contextMenu(ev, e)}
                                 title={e.type === "link" ? `${e.name} -> ${e.target}` : e.name}>
                                <span className="c-name">
                                    <EntryIcon e={e} />
                                    {renaming === e.path ? (
                                        <RenameBox initial={e.name} onDone={v => commitRename(e.path, v)} onCancel={() => setRenaming(null)} />
                                    ) : <span className="nm">{e.name}</span>}
                                </span>
                                <span className="c-size">{isDir ? "" : formatSize(e.size)}</span>
                                <span className="c-time">{new Date(e.mtime * 1000).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}</span>
                                <span className="c-mode mono">{formatMode(e.mode)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="statusbar">
                <span>{entries.length} mục{selected.size ? `, đã chọn ${selected.size}` : ""}</span>
                <span className="grow" />
                {busy && <span className="muted">{busy}...</span>}
                <span className="muted mono">{cwd}</span>
            </div>
        </div>
    );
}

function RenameBox({ initial, onDone, onCancel }: { initial: string, onDone: (v: string) => void, onCancel: () => void }) {
    const ref = useRef<HTMLInputElement>(null);
    const done = useRef(false);
    const finish = (v: string | null) => {
        if(done.current) return;
        done.current = true;
        if(v === null) onCancel(); else onDone(v);
    };
    useEffect(() => {
        const el = ref.current!;
        el.focus();
        const dot = initial.lastIndexOf(".");
        el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    }, [initial]);
    return (
        <input ref={ref} className="rename" defaultValue={initial}
               onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
               onBlur={e => finish(e.currentTarget.value)}
               onKeyDown={e => {
                   e.stopPropagation();
                   if(e.key === "Enter") finish(e.currentTarget.value);
                   if(e.key === "Escape") finish(null);
               }} />
    );
}

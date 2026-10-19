import { useRef, type ReactNode, type PointerEvent as RPointerEvent } from "react";
import { wm, type Win } from "./wm";

const MIN_W = 320;
const MIN_H = 200;
const TASKBAR = 48;

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function WindowFrame({ win, active, icon, children }: {
    win: Win, active: boolean, icon: ReactNode, children: ReactNode,
}) {
    const ref = useRef<HTMLDivElement>(null);

    function startDrag(e: RPointerEvent) {
        if(e.button !== 0 || win.maximized) return;
        if((e.target as HTMLElement).closest("button")) return;
        e.preventDefault();
        wm.focus(win.id);
        const sx = e.clientX, sy = e.clientY, ox = win.x, oy = win.y;
        const el = ref.current!;
        el.classList.add("dragging");
        const move = (ev: PointerEvent) => {
            const x = Math.min(window.innerWidth - 80, Math.max(-win.w + 80, ox + ev.clientX - sx));
            const y = Math.min(window.innerHeight - TASKBAR - 30, Math.max(0, oy + ev.clientY - sy));
            el.style.left = x + "px";
            el.style.top = y + "px";
        };
        const up = (ev: PointerEvent) => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            el.classList.remove("dragging");
            const x = Math.min(window.innerWidth - 80, Math.max(-win.w + 80, ox + ev.clientX - sx));
            const y = Math.min(window.innerHeight - TASKBAR - 30, Math.max(0, oy + ev.clientY - sy));
            // Kéo lên mép trên: phóng to
            if(ev.clientY <= 2) wm.update(win.id, { maximized: true });
            else wm.update(win.id, { x, y });
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }

    function startResize(edge: Edge, e: RPointerEvent) {
        if(e.button !== 0 || win.maximized) return;
        e.preventDefault();
        e.stopPropagation();
        wm.focus(win.id);
        const sx = e.clientX, sy = e.clientY;
        const o = { x: win.x, y: win.y, w: win.w, h: win.h };
        const el = ref.current!;
        el.classList.add("dragging");
        let cur = { ...o };
        const move = (ev: PointerEvent) => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            cur = { ...o };
            if(edge.includes("e")) cur.w = Math.max(MIN_W, o.w + dx);
            if(edge.includes("s")) cur.h = Math.max(MIN_H, o.h + dy);
            if(edge.includes("w")) { cur.w = Math.max(MIN_W, o.w - dx); cur.x = o.x + o.w - cur.w; }
            if(edge.includes("n")) { cur.h = Math.max(MIN_H, o.h - dy); cur.y = Math.max(0, o.y + o.h - cur.h); }
            Object.assign(el.style, { left: cur.x + "px", top: cur.y + "px", width: cur.w + "px", height: cur.h + "px" });
        };
        const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            el.classList.remove("dragging");
            wm.update(win.id, cur);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
    }

    const style = win.maximized
        ? { left: 0, top: 0, width: "100%", height: `calc(100% - ${TASKBAR}px)`, zIndex: win.z }
        : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

    return (
        <div ref={ref}
             className={"window" + (active ? " active" : "") + (win.maximized ? " maximized" : "") + (win.minimized ? " minimized" : "")}
             style={style}
             onPointerDownCapture={() => wm.focus(win.id)}
             role="dialog" aria-label={win.title}>
            <div className="titlebar" onPointerDown={startDrag} onDoubleClick={() => wm.toggleMax(win.id)}>
                <span className="title-icon">{icon}</span>
                <span className="title-text">{win.title}</span>
                <div className="title-buttons">
                    <button title="Thu nhỏ" aria-label="Thu nhỏ" onClick={() => wm.minimize(win.id)}>
                        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 8h8" stroke="currentColor" strokeWidth="1.5" /></svg>
                    </button>
                    <button title={win.maximized ? "Khôi phục" : "Phóng to"} aria-label="Phóng to" onClick={() => wm.toggleMax(win.id)}>
                        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
                    </button>
                    <button className="close" title="Đóng" aria-label="Đóng" onClick={() => wm.requestClose(win.id)}>
                        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" /></svg>
                    </button>
                </div>
            </div>
            <div className="window-body">{children}</div>
            {!win.maximized && (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as Edge[]).map(edge => (
                <div key={edge} className={"rz rz-" + edge} onPointerDown={e => startResize(edge, e)} />
            ))}
        </div>
    );
}

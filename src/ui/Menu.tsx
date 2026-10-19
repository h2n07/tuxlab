// Menu ngữ cảnh (chuột phải) dùng chung.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
    | { sep: true }
    | { label: string, hint?: string, action: () => void, disabled?: boolean, danger?: boolean, sep?: false };

let setter: ((m: { x: number, y: number, items: MenuItem[] } | null) => void) | null = null;

export function showMenu(x: number, y: number, items: MenuItem[]) {
    setter?.({ x, y, items });
}

export function MenuHost() {
    const [menu, setMenu] = useState<{ x: number, y: number, items: MenuItem[] } | null>(null);
    useEffect(() => {
        setter = setMenu;
        const close = () => setMenu(null);
        window.addEventListener("pointerdown", close);
        window.addEventListener("blur", close);
        window.addEventListener("keydown", (e) => { if(e.key === "Escape") close(); });
        return () => { setter = null; window.removeEventListener("pointerdown", close); window.removeEventListener("blur", close); };
    }, []);
    if(!menu) return null;
    const h = menu.items.reduce((a, i) => a + ("label" in i ? 30 : 9), 8);
    const x = Math.min(menu.x, window.innerWidth - 300);
    const y = Math.min(menu.y, window.innerHeight - h - 8);
    return createPortal(
        <div className="ctxmenu" style={{ left: x, top: Math.max(4, y) }} onPointerDown={e => e.stopPropagation()}
             onContextMenu={e => e.preventDefault()}>
            {menu.items.map((it, i) => "label" in it ? (
                <button key={i} disabled={it.disabled} className={it.danger ? "danger" : ""}
                        onClick={() => { setMenu(null); it.action(); }}>
                    <span>{it.label}</span>{it.hint && <span className="hint">{it.hint}</span>}
                </button>
            ) : <div key={i} className="msep" />)}
        </div>,
        document.body);
}

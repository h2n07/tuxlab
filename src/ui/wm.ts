// Trình quản lý cửa sổ (store nhỏ dùng với useSyncExternalStore).
import { useSyncExternalStore } from "react";

export type AppKind = "terminal" | "files" | "editor" | "settings" | "about" | "log";

export interface Win {
    id: string;
    app: AppKind;
    title: string;
    props: Record<string, any>;
    x: number; y: number; w: number; h: number;
    z: number;
    minimized: boolean;
    maximized: boolean;
}

const DEFAULT_SIZE: Record<AppKind, [number, number]> = {
    terminal: [820, 500],
    files: [860, 540],
    editor: [880, 600],
    settings: [640, 560],
    about: [640, 560],
    log: [760, 480],
};

/** Ứng dụng chỉ mở một cửa sổ (mở lại = đưa lên trước). */
const SINGLE: AppKind[] = ["terminal", "settings", "about", "log"];

let wins: Win[] = [];
const closeGuards = new Map<string, () => boolean>();
let zTop = 10;
let seq = 0;
const listeners = new Set<() => void>();
let snapshot = wins;

function emit() {
    snapshot = wins.slice();
    for(const l of listeners) l();
}

function workArea() {
    const tb = 48;
    return { w: window.innerWidth, h: window.innerHeight - tb };
}

export const wm = {
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    get(): Win[] { return snapshot; },
    find(pred: (w: Win) => boolean) { return wins.find(pred); },

    open(app: AppKind, props: Record<string, any> = {}, title?: string): string {
        const key = props.key as string | undefined;
        const existing = wins.find(w => (SINGLE.includes(app) && w.app === app) || (key && w.props.key === key));
        if(existing) {
            if(Object.keys(props).length) existing.props = { ...existing.props, ...props };
            existing.minimized = false;
            existing.z = ++zTop;
            emit();
            return existing.id;
        }
        const area = workArea();
        let [w, h] = DEFAULT_SIZE[app];
        w = Math.min(w, area.w - 20);
        h = Math.min(h, area.h - 20);
        const n = wins.length % 8;
        const x = Math.max(10, Math.min(area.w - w - 10, 60 + n * 28 + (app === "editor" ? 120 : 0)));
        const y = Math.max(10, Math.min(area.h - h - 10, 30 + n * 24));
        const id = "w" + (++seq);
        wins.push({ id, app, title: title || app, props, x, y, w, h, z: ++zTop, minimized: false,
                    maximized: area.w < 760 });
        emit();
        return id;
    },
    close(id: string) { closeGuards.delete(id); wins = wins.filter(w => w.id !== id); emit(); },
    /** Đóng có hỏi (vd. trình soạn thảo còn thay đổi chưa lưu). */
    requestClose(id: string) {
        const g = closeGuards.get(id);
        if(g && !g()) return;
        wm.close(id);
    },
    setCloseGuard(id: string, guard: (() => boolean) | null) {
        if(guard) closeGuards.set(id, guard); else closeGuards.delete(id);
    },
    focus(id: string) {
        const w = wins.find(w => w.id === id);
        if(w && (w.z !== zTop || w.minimized)) { w.z = ++zTop; w.minimized = false; emit(); }
    },
    update(id: string, patch: Partial<Win>) {
        const w = wins.find(w => w.id === id);
        if(w) { Object.assign(w, patch); emit(); }
    },
    minimize(id: string) { wm.update(id, { minimized: true }); },
    toggleMax(id: string) {
        const w = wins.find(w => w.id === id);
        if(w) wm.update(id, { maximized: !w.maximized });
    },
    setTitle(id: string, title: string) {
        const w = wins.find(w => w.id === id);
        if(w && w.title !== title) { w.title = title; emit(); }
    },
    topId(): string | null {
        const vis = wins.filter(w => !w.minimized);
        if(!vis.length) return null;
        return vis.reduce((a, b) => (a.z > b.z ? a : b)).id;
    },
};

export function useWindows(): Win[] {
    return useSyncExternalStore(wm.subscribe, wm.get);
}

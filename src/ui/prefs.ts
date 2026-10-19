// Tuỳ chọn giao diện (lưu trong localStorage).
import { useSyncExternalStore } from "react";

export type Skin = "ubuntu" | "kali" | "fedora";

export interface Prefs {
    skin: Skin;
    termFontSize: number;
    editorFontSize: number;
    showHidden: boolean;
}

export const SKINS: Array<{ id: Skin, name: string, note: string }> = [
    { id: "ubuntu", name: "Kiểu Ubuntu", note: "Tông cam - tím" },
    { id: "kali", name: "Kiểu Kali", note: "Tông xanh đen" },
    { id: "fedora", name: "Kiểu Fedora", note: "Tông xanh dương - xám" },
];

const KEY = "ltht-prefs";
const DEFAULTS: Prefs = { skin: "ubuntu", termFontSize: 15, editorFontSize: 15, showHidden: false };

function load(): Prefs {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
    catch { return { ...DEFAULTS }; }
}

let prefs = load();
const listeners = new Set<() => void>();

export const prefsStore = {
    get: () => prefs,
    set(patch: Partial<Prefs>) {
        prefs = { ...prefs, ...patch };
        try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* bỏ qua */ }
        for(const l of listeners) l();
    },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function usePrefs(): Prefs {
    return useSyncExternalStore(prefsStore.subscribe, prefsStore.get);
}

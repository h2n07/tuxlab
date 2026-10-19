// Biểu tượng SVG tự vẽ (không dùng logo thương hiệu của các bản phân phối).
import type { JSX } from "react";

type P = { size?: number, className?: string };

export function IconTerminal({ size = 24, className }: P) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <rect x="2" y="3.5" width="20" height="17" rx="2.5" fill="#2b2b2b" stroke="var(--icon-stroke, #888)" />
            <path d="M6 9l3.2 3L6 15" fill="none" stroke="#4ee36a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11 15.5h6" stroke="#e6e6e6" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

export function IconFolder({ size = 24, className, open }: P & { open?: boolean }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <path d="M2.5 6.5a2 2 0 0 1 2-2h4.6l2 2h8.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="var(--folder-back, #c98a1b)" />
            <path d={open ? "M4 10h17.5l-2 9.5h-17z" : "M2.5 9h19v8.5a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"} fill="var(--folder, #f0b23a)" />
        </svg>
    );
}

export function IconFile({ size = 24, className, ext }: P & { ext?: string }) {
    const colors: Record<string, string> = {
        c: "#5c8dd6", h: "#7f9fd6", cpp: "#a05cd6", cc: "#a05cd6", hpp: "#b98ae0", s: "#d6845c",
        S: "#d6845c", asm: "#d6845c", txt: "#8a8a8a", md: "#6aa06a", sh: "#5fae5f", o: "#777", zip: "#c9a227",
    };
    const color = (ext && colors[ext]) || "#9aa4b0";
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <path d="M5.5 2.5h9l4.5 4.5v14a1 1 0 0 1-1 1h-12.5a1 1 0 0 1-1-1v-17.5a1 1 0 0 1 1-1z" fill="#f4f4f4" stroke="#b5b5b5" />
            <path d="M14.5 2.5v4.5h4.5" fill="#dcdcdc" stroke="#b5b5b5" />
            {ext ? (
                <>
                    <rect x="3" y="13" width="15" height="6.5" rx="1.2" fill={color} />
                    <text x="10.5" y="18" fontSize="5.2" fontFamily="sans-serif" fontWeight="700" fill="#fff" textAnchor="middle">
                        {ext.slice(0, 4).toUpperCase()}
                    </text>
                </>
            ) : null}
        </svg>
    );
}

export function IconBinary({ size = 24, className }: P) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="3" fill="#3d4a5c" />
            <path d="M7 9l3 3-3 3" fill="none" stroke="#9fe39f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x="15" y="16" fontSize="7" fontFamily="monospace" fill="#fff" textAnchor="middle">01</text>
        </svg>
    );
}

export function IconLink({ size = 12 }: P) {
    return (
        <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
            <rect x="0.5" y="0.5" width="11" height="11" rx="2" fill="#fff" stroke="#666" />
            <path d="M3 9l5-5M5 3.5h3.5V7" fill="none" stroke="#333" strokeWidth="1.3" />
        </svg>
    );
}

export function IconEditor({ size = 24, className }: P) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <rect x="3" y="2.5" width="15" height="19" rx="2" fill="#fafafa" stroke="#9a9a9a" />
            <path d="M6 7h8M6 10h6M6 13h7" stroke="#7a8ca8" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M13.5 19.5l1-3.5 6.2-6.2 2.5 2.5-6.2 6.2z" fill="var(--accent, #e95420)" stroke="#333" strokeWidth=".6" />
        </svg>
    );
}

export function IconSettings({ size = 24, className }: P) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <path fill="#8d99a6" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z" />
            <circle cx="12" cy="12" r="3.6" fill="#f2f2f2" />
        </svg>
    );
}

export function IconHelp({ size = 24, className }: P) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <circle cx="12" cy="12" r="10" fill="#3f8ed8" />
            <path d="M9.2 9.3a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1-1.4 2v.6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="17.6" r="1.2" fill="#fff" />
        </svg>
    );
}

export function IconLog({ size = 24, className }: P) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" fill="#1d2330" />
            <path d="M6 8h10M6 11h12M6 14h8M6 17h11" stroke="#9cc4ff" strokeWidth="1.3" />
        </svg>
    );
}

export function IconPenguin({ size = 24, className }: P) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
            <ellipse cx="12" cy="13.5" rx="7" ry="8.5" fill="#222" />
            <ellipse cx="12" cy="15" rx="4.6" ry="6" fill="#fafafa" />
            <circle cx="10" cy="8.4" r="1.5" fill="#fff" /><circle cx="14" cy="8.4" r="1.5" fill="#fff" />
            <circle cx="10.3" cy="8.6" r=".7" fill="#000" /><circle cx="13.7" cy="8.6" r=".7" fill="#000" />
            <path d="M10.2 10.6h3.6l-1.8 1.8z" fill="#f2b01e" />
            <ellipse cx="8.6" cy="21.6" rx="2.6" ry="1.1" fill="#f2b01e" /><ellipse cx="15.4" cy="21.6" rx="2.6" ry="1.1" fill="#f2b01e" />
        </svg>
    );
}

/** Biểu tượng "logo" của từng skin - hình học đơn giản, chỉ gợi màu sắc. */
export function SkinLogo({ skin, size = 22 }: { skin: string, size?: number }): JSX.Element {
    if(skin === "kali") {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="11" fill="#367bf0" />
                <path d="M5 15c3-6 8-8 14-6-3 0-5 1-6 3 2 0 3 1 4 3-2-1-4-1-6 0-2 .8-4 .5-6 0z" fill="#fff" />
            </svg>
        );
    }
    if(skin === "fedora") {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="11" fill="#3c6eb4" />
                <path d="M9 18v-6.5a3.5 3.5 0 0 1 6-2.4M9 12.5h5.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
        );
    }
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="11" fill="#e95420" />
            <circle cx="12" cy="12" r="4.6" fill="none" stroke="#fff" strokeWidth="2" />
            <circle cx="12" cy="5.6" r="1.9" fill="#fff" /><circle cx="6.4" cy="15.2" r="1.9" fill="#fff" />
            <circle cx="17.6" cy="15.2" r="1.9" fill="#fff" />
        </svg>
    );
}

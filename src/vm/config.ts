// Cấu hình máy ảo dùng chung (phải khớp với image/vm-node.mjs).

export const IMAGE_URL: string = (import.meta.env.VITE_IMAGE_URL || "./image/").replace(/\/?$/, "/");
export const BIOS_URL = "./v86/seabios.bin";
export const VGA_BIOS_URL = "./v86/vgabios.bin";

export const BASE_CMDLINE = [
    "console=ttyS0",
    "spectre_v2=off", "pti=off", "mitigations=off",
    "tsc=reliable", "no_timer_check",
    "init_on_free=on",
    "random.trust_cpu=on",
    "quiet", "loglevel=3",
].join(" ");

export interface MachineSettings {
    memoryMB: number;
    /** URL backend mạng của v86 ("" = tắt). vd. wisps://... hoặc wss://... */
    networkRelay: string;
}

export const DEFAULT_SETTINGS: MachineSettings = {
    memoryMB: 512,
    networkRelay: "",
};

export interface ImageManifest {
    version: string;
    created: string;
    entries: number;
    files: number;
    size: number;
    compressed: number;
}

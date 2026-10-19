/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
declare module "*.wasm?url" { const url: string; export default url; }
declare module "./v86-fixes.js" {
    export function applyV86Fixes(emulator: any): void;
    export function createConsoleWriter(emulator: any, port?: number): (data: Uint8Array | string) => void;
}

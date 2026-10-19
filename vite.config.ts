import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";

// Thư mục ảnh Debian do image/build-image.sh tạo ra (fs.json, base/, bzImage, initrd.img, manifest.json).
const IMAGE_DIR = path.resolve(
    process.env.LTHT_IMAGE_DIR ||
    path.join(process.env.LTHT_BUILD_DIR || path.join(__dirname, ".build"), "image"));
// Nếu ảnh được host ở chỗ khác (CDN, GitHub Releases...), đặt VITE_IMAGE_URL và ảnh sẽ không bị chép vào dist.
const EXTERNAL_IMAGE = !!process.env.VITE_IMAGE_URL;

const TYPES: Record<string, string> = {
    ".json": "application/json",
    ".zst": "application/octet-stream",
    ".bin": "application/octet-stream",
    ".img": "application/octet-stream",
    ".txt": "text/plain; charset=utf-8",
};

function serveImage(): Plugin {
    const middleware = (req: any, res: any, next: any) => {
        const url: string = req.url || "";
        if(!url.startsWith("/image/")) return next();
        const rel = decodeURIComponent(url.slice("/image/".length).split("?")[0]);
        const file = path.join(IMAGE_DIR, rel);
        if(!file.startsWith(IMAGE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.statusCode = 404;
            return res.end("not found");
        }
        res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
        res.setHeader("Cache-Control", rel.startsWith("base/") ? "public, max-age=31536000, immutable" : "no-cache");
        fs.createReadStream(file).pipe(res);
    };
    return {
        name: "ltht-serve-image",
        configureServer(server) { server.middlewares.use(middleware); },
        configurePreviewServer(server) { server.middlewares.use(middleware); },
        closeBundle() {
            if(EXTERNAL_IMAGE || process.env.LTHT_SKIP_IMAGE_COPY) return;
            if(!fs.existsSync(path.join(IMAGE_DIR, "fs.json"))) {
                console.warn(`[ltht] Chưa có ảnh ở ${IMAGE_DIR} - hãy chạy image/build-image.sh`);
                return;
            }
            const out = path.resolve(__dirname, "dist/image");
            console.log(`[ltht] chép ảnh ${IMAGE_DIR} -> ${out}`);
            fs.cpSync(IMAGE_DIR, out, { recursive: true, filter: (src) => !src.endsWith("build-log.txt") });
        },
    };
}

export default defineConfig({
    base: "./",
    plugins: [
        react(),
        serveImage(),
        VitePWA({
            registerType: "autoUpdate",
            injectRegister: null,
            manifest: {
                name: "TuxLab",
                short_name: "TuxLab",
                description: "A real Debian 12 i386 Linux desktop in your browser (v86/WebAssembly)",
                lang: "vi",
                theme_color: "#2c001e",
                background_color: "#1e1e1e",
                display: "standalone",
                icons: [{ src: "icons/tux.svg", sizes: "any", type: "image/svg+xml" }],
            },
            workbox: {
                globPatterns: ["**/*.{js,css,html,svg,woff2,wasm,bin}"],
                globIgnores: ["image/**"],
                maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
                navigateFallbackDenylist: [/\/image\//],
                runtimeCaching: [
                    {
                        // Tệp nội dung trong base/ đặt tên theo sha256: không bao giờ đổi.
                        urlPattern: ({ url }) => url.pathname.includes("/image/base/"),
                        handler: "CacheFirst",
                        options: { cacheName: "ltht-image-base", cacheableResponse: { statuses: [200] } },
                    },
                    {
                        // fs.json, bzImage, initrd.img được gắn ?v=<phiên bản ảnh>.
                        urlPattern: ({ url }) => url.pathname.includes("/image/") && url.searchParams.has("v"),
                        handler: "CacheFirst",
                        options: { cacheName: "ltht-image-meta", cacheableResponse: { statuses: [200] },
                                   expiration: { maxEntries: 12 } },
                    },
                    {
                        urlPattern: ({ url }) => url.pathname.endsWith("/image/manifest.json"),
                        handler: "NetworkFirst",
                        options: { cacheName: "ltht-image-manifest", networkTimeoutSeconds: 3 },
                    },
                ],
            },
        }),
    ],
    build: {
        target: "es2022",
        chunkSizeWarningLimit: 4000,
    },
    worker: { format: "es" },
});

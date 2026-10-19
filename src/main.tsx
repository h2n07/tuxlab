import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { Desktop } from "./ui/Desktop";
import { machine } from "./vm/machine";
import { wm } from "./ui/wm";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<Desktop />);

// Mở terminal ngay để thấy quá trình khởi động / dấu nhắc lệnh.
wm.open("terminal", {}, "Terminal - student@tuxlab");
machine.start();

if(import.meta.env.PROD && "serviceWorker" in navigator) {
    registerSW({ immediate: true });
}

// Cảnh báo khi đóng tab lúc đang có thay đổi chưa kịp ghi (hiếm: dữ liệu được lưu mỗi 3 giây).
window.addEventListener("beforeunload", (e) => {
    machine.saveNow();
    if(machine.status.phase === "snapshot") { e.preventDefault(); e.returnValue = ""; }
});

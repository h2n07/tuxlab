import { useEffect, useState, useSyncExternalStore } from "react";
import { machine, type MachineStatus } from "../vm/machine";

function subscribeStatus(cb: () => void) {
    machine.addEventListener("status", cb);
    machine.addEventListener("ready", cb);
    return () => { machine.removeEventListener("status", cb); machine.removeEventListener("ready", cb); };
}

export function useMachineStatus(): MachineStatus {
    return useSyncExternalStore(subscribeStatus, () => machine.status);
}

/** Phiên bản cây tệp của guest - đổi mỗi khi có thay đổi (từ terminal hoặc giao diện). */
export function useFsVersion(): number {
    const [v, setV] = useState(0);
    useEffect(() => {
        let gfs = machine.gfs;
        const on = () => setV(x => x + 1);
        const attach = () => { gfs = machine.gfs; gfs?.addEventListener("change", on); on(); };
        if(gfs) attach(); else machine.addEventListener("ready", attach, { once: true });
        // thay đổi quyền (chmod) từ guest không qua hàm FS nào: làm mới định kỳ
        const t = setInterval(on, 4000);
        return () => { gfs?.removeEventListener("change", on); machine.removeEventListener("ready", attach); clearInterval(t); };
    }, []);
    return v;
}

export function useNow(intervalMs = 15000) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => { const t = setInterval(() => setNow(new Date()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
    return now;
}

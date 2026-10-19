// Lớp bọc IndexedDB tối giản (không phụ thuộc thư viện).
// CSDL "ltht-vm":
//   kv      : khoá-giá trị (ảnh chụp máy, cài đặt, siêu dữ liệu)
//   files   : đường dẫn -> bản ghi tệp/thư mục người dùng đã thay đổi so với ảnh gốc
//   deleted : đường dẫn -> true (tệp của ảnh gốc đã bị xoá)

const DB_NAME = "ltht-vm";
const DB_VERSION = 1;
export const STORES = ["kv", "files", "deleted"] as const;
export type StoreName = typeof STORES[number];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
    if(!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                for(const s of STORES) if(!db.objectStoreNames.contains(s)) db.createObjectStore(s);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error("IndexedDB bị chặn bởi một tab khác"));
        });
    }
    return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function get<T = any>(store: StoreName, key: string): Promise<T | undefined> {
    const db = await openDB();
    return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function put(store: StoreName, key: string, value: any): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    await done(tx);
}

export async function del(store: StoreName, key: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    await done(tx);
}

export async function keys(store: StoreName): Promise<string[]> {
    const db = await openDB();
    return wrap(db.transaction(store).objectStore(store).getAllKeys()) as Promise<string[]>;
}

export async function getAll<T = any>(store: StoreName): Promise<Array<[string, T]>> {
    const db = await openDB();
    const os = db.transaction(store).objectStore(store);
    const [k, v] = await Promise.all([wrap(os.getAllKeys()), wrap(os.getAll())]);
    return (k as string[]).map((key, i) => [key, v[i] as T]);
}

/** Ghi nhiều thay đổi trong một giao dịch (nguyên tử). */
export async function batch(ops: Array<{ store: StoreName, key: string, value?: any, delete?: boolean }>): Promise<void> {
    if(!ops.length) return;
    const db = await openDB();
    const names = [...new Set(ops.map(o => o.store))];
    const tx = db.transaction(names, "readwrite");
    for(const o of ops) {
        const os = tx.objectStore(o.store);
        if(o.delete) os.delete(o.key); else os.put(o.value, o.key);
    }
    await done(tx);
}

export async function clearAll(): Promise<void> {
    const db = await openDB();
    const tx = db.transaction([...STORES], "readwrite");
    for(const s of STORES) tx.objectStore(s).clear();
    await done(tx);
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Giao dịch IndexedDB bị huỷ"));
    });
}

export async function requestPersistentStorage(): Promise<boolean> {
    try {
        if(navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch { /* bỏ qua */ }
    return false;
}

export async function storageEstimate(): Promise<{ usage: number, quota: number } | null> {
    try {
        const e = await navigator.storage.estimate();
        return { usage: e.usage || 0, quota: e.quota || 0 };
    } catch { return null; }
}

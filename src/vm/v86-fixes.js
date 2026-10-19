// Vá hành vi hệ tệp 9p của v86 (0.5.472) cho đúng ngữ nghĩa POSIX:
// một tệp đã bị unlink nhưng vẫn còn được mở (vd. dpkg tự nâng cấp chính nó,
// chương trình đang chạy bị ghi đè) phải vẫn đọc/stat được cho đến khi
// tham chiếu (fid) cuối cùng được đóng.
//
// v86 gốc: Unlink đặt status = STATUS_UNLINKED -> các yêu cầu read/getattr
// trên fid còn mở trả về ENOENT, và CloseInode xoá dữ liệu ngay ở lần clunk
// đầu tiên kể cả khi fid khác vẫn đang dùng -> tiến trình bị segfault.
//
// Dùng chung cho bản web (src/vm/machine.ts) và các script Node (image/*.mjs).

const STATUS_INVALID = -1;
const STATUS_UNLINKED = 4;

/**
 * Gọi trong sự kiện "emulator-loaded" (khi đó emulator.fs9p mới tồn tại) và
 * TRƯỚC khi CPU chạy (tạo V86 với autostart: false rồi tự gọi run()).
 * @param {any} emulator  đối tượng V86
 */
export function applyV86Fixes(emulator) {
    const fs = emulator.fs9p;
    if(!fs) throw new Error("applyV86Fixes: emulator.fs9p chưa sẵn sàng");
    if(fs.__lthtFixed) return;
    fs.__lthtFixed = true;

    const fidsFor = (id) => {
        const dev = emulator.v86 && emulator.v86.cpu.devices.virtio_9p;
        if(!dev) return 0;
        let n = 0;
        for(const f of dev.fids) if(f && f.inodeid === id) n++;
        return n;
    };

    const origUnlink = fs.Unlink;
    fs.Unlink = function(parentid, name) {
        const idx = this.Search(parentid, name);
        const inode = idx >= 0 ? this.inodes[idx] : null;
        const prev = inode ? inode.status : 0;
        const ret = origUnlink.call(this, parentid, name);
        if(ret === 0 && inode && inode.status === STATUS_UNLINKED) {
            if(fidsFor(idx) > 0) {
                inode.status = prev;          // vẫn đọc được qua fid đang mở
                inode.__lthtUnlinked = true;
            } else {
                inode.status = STATUS_INVALID;
                this.DeleteData(idx);
            }
        }
        return ret;
    };

    // lstat() của liên kết tượng trưng phải có st_size = độ dài đích (byte).
    // v86 để 0 cho liên kết do guest tạo -> dpkg báo "symbolic link ... size has changed".
    const origSymlink = fs.CreateSymlink;
    fs.CreateSymlink = function(filename, parentid, symlink) {
        const id = origSymlink.call(this, filename, parentid, symlink);
        const inode = this.inodes[id];
        if(inode && !this.is_forwarder(inode)) inode.size = new TextEncoder().encode(symlink).length;
        return id;
    };

    const origClose = fs.CloseInode;
    fs.CloseInode = async function(id) {
        const inode = this.inodes[id];
        if(inode && inode.__lthtUnlinked) {
            if(fidsFor(id) <= 1) {           // fid đang clunk là tham chiếu cuối
                inode.__lthtUnlinked = false;
                inode.status = STATUS_INVALID;
                await this.DeleteData(id);
            }
            return;
        }
        return origClose.call(this, id);
    };
}

/**
 * Gửi byte vào virtio-console. v86 bỏ qua dữ liệu khi guest chưa đưa bộ đệm
 * vào hàng đợi (xem "TODO: Buffer" trong virtio_console.js), nên ở đây chia
 * nhỏ dữ liệu và đợi tới khi hàng đợi nhận sẵn sàng.
 */
export function createConsoleWriter(emulator, port = 0) {
    const queue = [];
    let busy = false;
    const CHUNK = 128;
    const qid = port === 0 ? 0 : port * 2 + 2;

    function ready() {
        const dev = emulator.v86 && emulator.v86.cpu.devices.virtio_console;
        if(!dev) return false;
        const q = dev.virtio.queues[qid];
        return q && q.is_configured() && q.has_request();
    }

    function pump() {
        busy = true;
        let spins = 0;
        while(queue.length && ready()) {
            const chunk = queue.shift();
            emulator.bus.send("virtio-console" + port + "-input-bytes", chunk);
            if(++spins > 64) break;
        }
        if(queue.length) setTimeout(pump, 4);
        else busy = false;
    }

    return function write(data) {
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
        for(let i = 0; i < bytes.length; i += CHUNK) queue.push(bytes.slice(i, i + CHUNK));
        if(!busy) pump();
    };
}

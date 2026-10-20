# TuxLab — Debian i386 thật trong trình duyệt

🌐 **Chạy ngay:** https://h2n07.github.io/tuxlab/ · [English](README.md)

Website tĩnh mô phỏng một máy Linux có giao diện cửa sổ, dùng để học lập trình hệ thống, C/C++, assembly x86, dòng lệnh Linux (ban đầu làm cho môn **Lập trình hệ thống**).
Bên dưới là **Debian GNU/Linux 12 (bookworm) i386 thật** chạy trong trình duyệt bằng
trình giả lập x86 [v86](https://github.com/copy/v86) (WebAssembly). Không có trình
giả lập lệnh/hợp dịch/liên kết viết bằng JavaScript: `as`, `ld`, `gcc`, `g++`, `make`,
`gdb`, `objdump`, `strace`, `vim`... đều là bản Debian thật, nên kết quả, thông báo lỗi
và mã thoát giống hệt một máy Debian i386.

> Các skin “Ubuntu / Kali / Fedora” chỉ là màu sắc và biểu tượng tự vẽ. Hệ điều hành
> bên dưới luôn là **Debian 12 i386**. Dự án không liên quan tới Debian, Canonical,
> Offensive Security hay Red Hat.

## Tính năng

- **Desktop**: thanh tác vụ, menu ứng dụng, biểu tượng desktop, nhiều cửa sổ cùng lúc
  (kéo, thu nhỏ, phóng to, đổi kích thước, đóng).
- **Terminal** (xterm.js ↔ `virtio-console` `/dev/hvc0`, `agetty --autologin student`):
  Ctrl+C / Ctrl+D / Ctrl+Z, lịch sử ↑↓, Tab, UTF‑8 tiếng Việt, Ctrl+Shift+C/V,
  đổi cỡ chữ. Khi đổi kích thước cửa sổ, kích thước được gửi vào kernel qua virtio-console
  resize, nên `stty size` và `$COLUMNS` luôn đúng.
- **Tệp**: duyệt cây thư mục thật của guest. GUI đọc/ghi trực tiếp hệ tệp 9p trong JS,
  guest gắn 9p với `cache=none`, nên đồng bộ hai chiều tức thì. Có tạo, đổi tên, xoá,
  di chuyển, kéo-thả (kể cả từ máy thật vào để tải lên), tải xuống tệp hoặc thư mục (.zip),
  `chmod +x`, mở terminal tại thư mục.
- **Trình soạn thảo** CodeMirror 6: tô màu C/C++ và assembly GNU as (AT&T), Ctrl+S lưu
  vào guest, tự nạp lại khi tệp bị đổi từ terminal.
- **▶ Biên dịch & chạy** (F5): mở terminal rồi *gõ* lệnh tương ứng để sinh viên thấy rõ.
  Ví dụ `cd ~/LTHT/Lab2 && as -o example.o example.s && ld -o example example.o && ./example`.
- **Lưu trạng thái** vào IndexedDB, **xuất/nhập .zip**, **đặt lại máy** (có xác nhận).
- **Offline** sau lần tải đầu (service worker / Workbox). Có nút “Tải toàn bộ ảnh để dùng offline”.
- Thư mục mẫu `~/LTHT/Lab1` (Lab1-template.cpp, bits.c) và `~/LTHT/Lab2` (example.s Hello World, echo.s, reverse.s).

## Kiến trúc

```
Trình duyệt
├─ React + TypeScript (Vite)       desktop, cửa sổ, Terminal, Tệp, Soạn thảo, Cài đặt
├─ v86 0.5.472 (WASM)              CPU x86 32-bit, virtio-9p, virtio-console, ttyS0
│   └─ Debian 12 i386, kernel 6.1 (linux-image-686)
│       ├─ /  = 9p "host9p" (cache=none) ← tệp tải theo nhu cầu từ image/base/*.bin.zst
│       ├─ /dev/hvc0  ↔ xterm.js (terminal của sinh viên)
│       └─ /dev/ttyS0 ↔ tác tử điều khiển ltht-agent (đồng bộ giờ, sync) + log kernel
└─ IndexedDB                       ảnh chụp máy (snapshot) + chênh lệch đĩa của người dùng
```

**Khởi động nhanh.** Lần đầu máy khởi động lạnh (tải kernel, `fs.json`, các tệp cần thiết).
Khi tới dấu nhắc lệnh, web lưu `save_state()` của v86 (nén gzip) vào IndexedDB. Những lần
sau chỉ cần giải nén rồi `restore_state()`.

**Lưu đĩa.** Ảnh chụp luôn là trạng thái *sạch* ngay sau khởi động. Mọi thay đổi của người
dùng (từ terminal hay GUI) được quét mỗi 3 giây, so với trạng thái sạch theo đường dẫn, và chỉ
phần khác biệt được ghi vào IndexedDB (`files/<path>`, `deleted/<path>`). Khi mở lại:
khôi phục ảnh chụp, áp chênh lệch, chạy tiếp. Cách này vẫn hoạt động khi cài thêm gói bằng apt.

**Vá v86.** Trong quá trình dựng ảnh mình phát hiện và vá hai lỗi ngữ nghĩa POSIX của
hệ tệp 9p trong v86 0.5.472 (`src/vm/v86-fixes.js`, dùng cho cả bản web và script dựng):
1. Tệp đã unlink nhưng còn mở thì bị trả `ENOENT` và mất dữ liệu ngay, khiến tiến trình
   đang chạy bị segfault (ví dụ dpkg tự nâng cấp chính nó).
2. Liên kết tượng trưng do guest tạo có `st_size = 0` (phải bằng độ dài đích), khiến dpkg
   báo “symbolic link … size has changed”.

Ngoài ra `virtio-console` của v86 bỏ dữ liệu khi guest chưa sẵn bộ đệm, nên bản web chia
nhỏ và chờ trước khi gửi (dán đoạn văn bản dài không bị mất ký tự).

## Dựng ảnh Debian (`image/build-image.sh`)

Yêu cầu: **Python ≥ 3.9**, **Node.js ≥ 23.8** (cần zlib zstd), `npm install`. Chạy được trên
Linux, macOS và Windows (Git Bash). **Không cần root, debootstrap, dpkg hay Docker** trên máy dựng.

```bash
npm install
bash image/build-image.sh --test
```

Các bước:

1. `image/mkrootfs.py`: tương đương `debootstrap --foreign --variant=minbase --arch=i386 bookworm`.
   Tải `Release` → `Packages.xz` (kiểm SHA256) → các `.deb` (kiểm SHA256), giải nén các gói
   `Priority: required` kèm merge `/usr` như debootstrap, ghi `/debootstrap/*` từ chính gói
   `debootstrap` của Debian, lập kho apt cục bộ cho các gói ở `image/packages.txt`. Lấy kernel
   `linux-image-686` và tạo initrd nhỏ (busybox-static + module virtio/9p). Kết quả xuất ra
   định dạng 9p của v86 (`fs.json` v3 + tệp đặt tên theo sha256).
2. `image/run-stage2.mjs`: khởi động kết quả đó trong v86 (Node.js) và chạy `image/stage2.sh`
   làm PID 1: `debootstrap --second-stage`, `apt-get install --no-install-recommends` các gói,
   tạo người dùng `student` (sudo không mật khẩu), chép `image/overlay/` và bài mẫu `samples/`,
   dọn tài liệu thừa. Sau đó xuất hệ tệp thành `.build/image/{fs.json, base/*.bin.zst, bzImage,
   initrd.img, manifest.json}`.
3. `image/test-image.mjs`: kiểm thử nghiệm thu (xem bảng bên dưới).

Muốn dựng lại y hệt một thời điểm, dùng snapshot.debian.org:
`LTHT_MIRROR=https://snapshot.debian.org/archive/debian/20261001T000000Z bash image/build-image.sh`.
Danh sách phiên bản gói đã cài nằm ở `/usr/local/share/ltht/installed-packages.txt` trong máy ảo.

Gói cài thêm (`image/packages.txt`): binutils, gcc, g++, make, build-essential, gdb, strace,
ltrace, nasm, vim, nano, less, man-db, manpages(-dev), bash-completion, file, tree, xxd,
procps, psmisc, zip, unzip, curl, wget, w3m, lynx, nmap, netcat-openbsd, tcpdump, dnsutils,
iputils-ping, traceroute, sudo, kmod, sysvinit-core, udhcpc, iproute2, ca-certificates.

## Chạy và triển khai

```bash
npm run dev        # http://localhost:5173 (ảnh lấy từ .build/image)
npm run build      # dist/ (đã chép ảnh vào dist/image)
npm run preview
```

`dist/` là site tĩnh, host ở đâu cũng được:

- **GitHub Pages**: đẩy `dist/` lên nhánh `gh-pages` (giới hạn 1 GB/site, 100 MB/tệp; ảnh khoảng 300 MB).
- **Cloudflare Pages**: giới hạn 20 000 tệp và 25 MiB/tệp. Nếu ảnh vượt số tệp, host thư mục
  ảnh ở nơi khác (R2, S3...) và dựng web với `VITE_IMAGE_URL=https://.../image/ npm run build`
  (máy chủ ảnh cần bật CORS).

**Mạng mặc định bật** qua relay công cộng của dự án v86 (`wss://relay.widgetry.org/`). Máy tự lấy IP
khi khởi động và sau mỗi lần khôi phục ảnh chụp; nếu mất mạng thì chạy `sudo ltht-net`. Khi bật,
**mọi lưu lượng mạng của máy ảo đi qua relay đó** (bên thứ ba), nhưng tệp của bạn không bị gửi đi
trừ khi bạn tự gửi. Relay miễn phí, dùng chung nên chậm. Có thể tắt mạng hoặc dùng relay riêng
(wsproxy/wisp) trong **Cài đặt → Mạng**. Khi tắt mạng, `apt` in thêm dòng hướng dẫn kèm lỗi thật của apt.
Công cụ mạng có sẵn: curl, wget, nmap, netcat, tcpdump, dig, ping, traceroute, trình duyệt dạng chữ
w3m và lynx. **Chỉ quét (nmap) những máy bạn được phép.**

## Kết quả nghiệm thu

Đo ngày 20/10/2026 trên laptop AMD Ryzen 7 5800H, Windows 11. Bản Node chạy bằng
`node image/test-image.mjs` (14/14 đạt, chi tiết trong `.build/image/test-results.json`).
Bản trình duyệt chạy `vite preview` bản production trên Chromium.

| # | Tiêu chí | Kết quả | Số liệu đo |
|---|----------|---------|------------|
| 1 | `as --version`, `ld --version` | **Đạt** | GNU assembler / GNU ld (GNU Binutils for Debian) 2.40 |
| 2 | Hello World: `as -o example.o example.s`, `ld -o example example.o`, `./example` | **Đạt** | in `Hello, World`, mã thoát 0; as ≈ 0,3 s, ld ≈ 0,5 s |
| 3 | Đọc chuỗi từ bàn phím bằng sys_read(3), in lại bằng sys_write(4) | **Đạt** | `echo.s` nhận đúng chuỗi gõ từ terminal; `reverse.s`: `Lap trinh he thong` → `gnoht eh hnirt paL` |
| 4 | Lab1-template.cpp với `g++`, in `Pass.`/`Failed.` và `Your score` | **Đạt** | g++ + `<iostream>`: **18–27 s** mỗi lần biên dịch; `Your score: 9/11` (bitCount là bài để sinh viên làm) |
| 5 | Tạo thư mục bằng GUI → `ls` thấy ngay, và ngược lại | **Đạt** | tức thì (cùng một cây inode 9p, guest dùng `cache=none`) |
| 6 | `gdb ./example`, `objdump -d example` | **Đạt** | gdb đặt breakpoint `_start`, `info registers`, `x/s` (≈ 10–13 s gồm cả khởi động gdb); objdump hiện `mov $0xd,%edx` |
| 7 | Tắt/tải lại trình duyệt, tệp vẫn còn | **Đạt** | tệp tạo bằng terminal và thư mục tạo bằng GUI còn nguyên sau reload ("áp 4 thay đổi đã lưu") |
| 8 | Khởi động khi đã có cache < 5 s | **Đạt** | khôi phục máy **0,48 s** (giải nén 0,28 s + restore 0,12 s); tính từ lúc bắt đầu tải trang ≈ **2,4 s**. Khởi động lạnh lần đầu: 15–20 s (Node), 27,7 s (trình duyệt, gồm lưu ảnh chụp) |
| 8b | Thời gian biên dịch một tệp C đơn giản | — | `gcc bits.c -o bits`: **≈ 4 s** |

Mạng qua relay công cộng (đạt): tự nhận IP, `curl https://deb.debian.org` trả 200 sau 3,4 s, `w3m` đọc được trang web, vẫn có mạng sau khi khôi phục ảnh chụp.

Kiểm thử bổ sung (đều đạt): `stty size` đúng theo kích thước cửa sổ; Ctrl+C và Ctrl+Z/`jobs`;
Tab hoàn thành lệnh; UTF-8 tiếng Việt; thông báo lỗi thật (`cc1: fatal error: khong-co.c: No such
file or directory`, mã 1); `sudo` không mật khẩu; `apt` không có mạng thì báo rõ. Ảnh chụp máy
512 MB RAM nén còn khoảng 12,5 MB.

**Về tốc độ g++.** Biên dịch C++ có `<iostream>` mất 18–27 s vì `cc1plus` phải phân tích khoảng
30 000 dòng header trên CPU giả lập. Các cách giảm, đã đo hoặc gợi ý:
- Dùng **gcc cho bài C** (≈ 4 s, nhanh khoảng 5 lần). Lab 1 chỉ cần `<stdio.h>`/`printf`.
- Thay `<iostream>` bằng `<cstdio>` trong template nếu được phép.
- Biên dịch lại lần hai không nhanh hơn: header vẫn phải phân tích lại. Có thể dùng precompiled
  header (`g++ -x c++-header`) nếu giảng viên cố định một header chung.

## Giấy phép

- Mã nguồn dự án: MIT.
- v86: BSD-2-Clause. SeaBIOS: LGPLv3. VGABIOS: LGPLv2.1 (`public/v86/`).
- Debian: mỗi gói theo giấy phép riêng (`/usr/share/doc/*/copyright` được giữ trong ảnh).
  Kernel Linux: GPLv2. Theo các giấy phép GPL, mã nguồn tương ứng đúng phiên bản có tại
  `https://snapshot.debian.org/` và `https://sources.debian.org/`. Danh sách phiên bản gói đã
  dùng nằm trong ảnh.
- xterm.js, CodeMirror, React, fflate, Workbox: MIT.

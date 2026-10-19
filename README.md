# TuxLab — a real Linux desktop in your browser

**▶ Try it: https://h2n07.github.io/tuxlab/** · [Tiếng Việt](README.vi.md)

TuxLab is a static website that boots a **real Debian GNU/Linux 12 (bookworm) i386** system
inside your browser using the [v86](https://github.com/copy/v86) x86 emulator (WebAssembly),
and wraps it in a small windowed desktop with a terminal, a file manager and a code editor.

You don't install anything, and there is no backend server or account. Everything runs on
your machine and stays there.

Nothing is simulated in JavaScript. `bash`, `gcc`, `g++`, `as`, `ld`, `make`, `gdb`, `objdump`,
`strace`, `vim` and the rest are the real Debian i386 binaries, so the output, error messages
and exit codes are exactly what you'd get on a physical 32-bit Debian box.

It works well for:
- learning **systems programming**: C/C++, bit manipulation, 32-bit x86 assembly (AT&T or NASM),
  Linux syscalls via `int $0x80`, ELF, linking, debugging;
- teaching labs and workshops where students can't, or shouldn't, install a VM;
- a disposable Linux shell to practise the command line, on any laptop, offline.

> The Ubuntu / Kali / Fedora “skins” only change colours and icons. The OS underneath is always
> Debian 12 i386. This project is not affiliated with Debian, Canonical, OffSec or Red Hat.

## Features

| | |
|---|---|
| **Desktop** | Taskbar, app menu, desktop icons, multiple draggable/resizable windows, fullscreen mode, 3 colour skins |
| **Terminal** | xterm.js ↔ `virtio-console` (`/dev/hvc0`, auto-login as `student`). Ctrl+C/D/Z, history, Tab completion, UTF-8 input (incl. Vietnamese IME), copy/paste, font zoom, correct window size (`stty size`) |
| **Files** | Browses the guest's real file system and syncs both ways instantly: the UI talks to the same 9p inode tree the kernel mounts with `cache=none`. Create, rename, delete, move, drag & drop, upload from your computer (files or folders), download a file or a folder as `.zip`, `chmod +x` |
| **Editor** | CodeMirror 6 with C/C++ and GNU as (AT&T) highlighting, Ctrl+S saves into the guest, reloads when the file changes from the terminal |
| **▶ Build & run** | F5 opens the terminal and *types* the real command (`gcc x.c -o x && ./x`, `as … && ld … && ./x`, `nasm -f elf32 …`, `make`), so learners see exactly what runs |
| **Persistence** | Disk changes are saved to IndexedDB every 3 s; reloading or closing the tab keeps your files. Export/import `.zip`, factory reset |
| **Fast start** | After the first boot, a machine snapshot is stored locally: the next start restores in ~0.5 s |
| **Offline** | Service worker (Workbox); optional “download the whole image for offline use” |
| **Optional network** | Off by default. Point it at your own v86 relay (wsproxy / wisp) to use `apt` |

Bundled tools: binutils, gcc/g++ 12, make, build-essential, gdb 13, strace, ltrace, nasm, vim, nano,
less, man pages, bash-completion, file, tree, xxd, zip/unzip, sudo (passwordless for `student`).
Sample exercises are in `~/LTHT/Lab1` (C/C++ bit manipulation) and `~/LTHT/Lab2` (assembly
Hello World, `sys_read`/`sys_write` echo, string reverse). Change them in [`samples/`](samples/).

## How it works

```
Browser
├─ React + TypeScript (Vite)       desktop, windows, Terminal, Files, Editor, Settings
├─ v86 0.5.472 (WASM JIT)          32-bit x86 PC: virtio-9p, virtio-console, serial
│   └─ Debian 12 i386, Linux 6.1 (linux-image-686)
│       ├─ /  = 9p "host9p", cache=none ← files fetched on demand from image/base/*.bin.zst
│       ├─ /dev/hvc0  ↔ xterm.js
│       └─ /dev/ttyS0 ↔ tiny control agent (clock sync, sync) + kernel log
└─ IndexedDB                       boot snapshot + per-path diff of your changes
```

- **Lazy image.** The root file system is published in v86's 9p format (`fs.json` +
  content-addressed, zstd-compressed files). Only the files that are actually used get
  downloaded. The full image is ~563 MB uncompressed and ~174 MB compressed.
- **Snapshot + diff persistence.** The snapshot is always the *clean* state right after boot.
  Every 3 seconds TuxLab compares the live inode tree with that baseline and writes only the
  differences (`files/<path>`, `deleted/<path>`) to IndexedDB. On start it restores the
  snapshot, replays the diff and resumes. This also survives image updates, and it covers
  packages installed with apt.
- **v86 fixes.** While building the image I found two POSIX bugs in v86's 9p file system and
  patched them at runtime ([`src/vm/v86-fixes.js`](src/vm/v86-fixes.js)):
  1. an unlinked but still-open file returned `ENOENT` and lost its data, which crashed running
     programs, e.g. dpkg upgrading itself;
  2. symlinks created by the guest had `st_size = 0`, so dpkg reported "symbolic link size has
     changed".
  The resize message of v86's virtio-console arrives in Linux with rows and cols swapped, so the
  UI compensates for that. Console input is also chunked, because v86 drops input when the guest
  queue is full.

## Building the Debian image

Requirements: **Python ≥ 3.9** and **Node.js ≥ 23.8** (needs built-in zstd). Runs on Linux, macOS
and Windows (Git Bash). **No root, no Docker, no debootstrap/dpkg on the host.**

```bash
npm install
bash image/build-image.sh --test     # ~30 min, output in .build/image
```

1. [`image/mkrootfs.py`](image/mkrootfs.py) does the equivalent of
   `debootstrap --foreign --variant=minbase --arch=i386 bookworm`: it verifies `Release` →
   `Packages.xz` → every `.deb` by SHA256, unpacks the `Priority: required` set with merged `/usr`,
   installs Debian's own `debootstrap` scripts into `/debootstrap`, prepares a local apt repo for
   [`image/packages.txt`](image/packages.txt), extracts the Debian kernel, and builds a tiny
   busybox initrd that mounts the 9p root.
2. [`image/run-stage2.mjs`](image/run-stage2.mjs) boots that tree in v86 under Node and runs
   [`image/stage2.sh`](image/stage2.sh) as PID 1. That script runs the real
   `debootstrap --second-stage`, then `apt-get install --no-install-recommends …`, creates the
   `student` user and applies [`image/overlay/`](image/overlay) and [`samples/`](samples). The
   result is exported as `fs.json` + `base/*.bin.zst` + kernel + initrd.
3. [`image/test-image.mjs`](image/test-image.mjs) is the automated acceptance test (below).

For a quick change to config files or sample exercises, run `node image/apply-overlay.mjs`. It
patches the built image in seconds instead of rebuilding it. For a bit-for-bit reproducible
build, pin the archive with
`LTHT_MIRROR=https://snapshot.debian.org/archive/debian/20261001T000000Z bash image/build-image.sh`.

## Running and deploying

```bash
npm run dev       # http://localhost:5173 (serves .build/image)
npm run build     # static site in dist/, image copied to dist/image
npm run preview
```

`dist/` is a plain static site:
- **GitHub Pages**: push `dist/` to a `gh-pages` branch. The live demo is hosted this way
  (~205 MB, ~14k files).
- **Cloudflare Pages / Netlify / S3**: also fine. If the host limits the number or size of files,
  host `image/` elsewhere (with CORS) and build with
  `VITE_IMAGE_URL=https://cdn.example.com/image/ npm run build`.

## Acceptance results

Measured 2026-10-20 on an AMD Ryzen 7 5800H laptop, Windows 11. Node: `node image/test-image.mjs`
→ **14/14 passed**. Browser: production build in Chromium.

| Check | Result | Measurement |
|---|---|---|
| `as --version`, `ld --version` | ✅ | GNU Binutils for Debian 2.40 |
| Hello World asm: `as -o example.o example.s && ld -o example example.o && ./example` | ✅ | prints `Hello, World`, exit 0; as ≈ 0.3 s, ld ≈ 0.5 s |
| Read from keyboard with `sys_read` (3), echo with `sys_write` (4); string reverse | ✅ | input typed into the terminal is echoed; `Lap trinh he thong` → `gnoht eh hnirt paL` |
| C++ template with `g++` prints `Pass.`/`Failed.` and `Your score` | ✅ | g++ with `<iostream>`: **18–27 s** per compile |
| Folder made in the GUI shows up in `ls`, and vice versa | ✅ | instant (same inode tree) |
| `gdb ./example` (breakpoint, registers, `x/s`), `objdump -d` | ✅ | gdb ≈ 10–13 s including startup |
| Close/reload the browser: files are still there | ✅ | files from the terminal and folders from the GUI survive a reload |
| Start time with cache < 5 s | ✅ | machine restore **0.48 s**, ≈ **2.4 s** from page load. Cold first boot: 15–20 s (Node), 21–28 s (browser) |
| Compile a small C file | — | `gcc bits.c -o bits` ≈ **4 s** |
| Extra: `stty size`, Ctrl+C, Ctrl+Z/`jobs`, Tab completion, UTF-8, real gcc errors, sudo, apt-offline message | ✅ | |

About C++ compile speed: `cc1plus` has to parse about 30k lines of `<iostream>` headers on an
emulated CPU. Use `gcc` for C exercises (≈ 5× faster), use `<cstdio>` instead of `<iostream>`, or
give the class a precompiled header.

## License

TuxLab itself is MIT © h2n07 ([github.com/h2n07](https://github.com/h2n07)). Third-party
components keep their own licenses: v86 (BSD-2-Clause); SeaBIOS (LGPL-3.0) and VGABIOS
(LGPL-2.1) in `public/v86/`; Debian packages (each package's `/usr/share/doc/*/copyright` is kept
in the image; Linux kernel GPL-2.0; corresponding sources are available on snapshot.debian.org /
sources.debian.org); xterm.js, CodeMirror, React, fflate, Workbox (MIT).

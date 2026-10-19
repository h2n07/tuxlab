#!/usr/bin/env bash
# Dựng lại ảnh Debian 12 (bookworm) i386 cho v86 từ đầu.
#
#   bash image/build-image.sh            # dựng ảnh vào $LTHT_BUILD_DIR (mặc định ./.build)
#   bash image/build-image.sh --test     # dựng xong chạy luôn kiểm thử nghiệm thu
#
# Yêu cầu: Python >= 3.9 và Node.js >= 23.8 (có zlib zstd), đã `npm install`.
# Không cần root, debootstrap, dpkg hay Docker trên máy dựng: phần cần chạy
# trong Linux (debootstrap --second-stage, apt-get install, useradd...) được
# chạy NGAY TRONG máy ảo v86 bằng Node.js.
#
# Biến môi trường:
#   LTHT_BUILD_DIR   thư mục làm việc (cache .deb, stage1, image)
#   LTHT_MIRROR      mirror Debian, vd. https://snapshot.debian.org/archive/debian/20261001T000000Z
#                    (dùng snapshot để dựng lại y hệt một thời điểm)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
export LTHT_BUILD_DIR="${LTHT_BUILD_DIR:-$ROOT/.build}"
# Chọn Python thật (trên Windows "python3" có thể chỉ là lối tắt Microsoft Store).
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
    for c in python3 python py; do
        if command -v "$c" >/dev/null 2>&1 && "$c" -c "import sys; assert sys.version_info >= (3, 9)" >/dev/null 2>&1; then PY="$c"; break; fi
    done
fi
[ -n "$PY" ] || { echo "Cần Python >= 3.9" >&2; exit 1; }
MIRROR_ARGS=()
if [ -n "${LTHT_MIRROR:-}" ]; then MIRROR_ARGS=(--mirror "$LTHT_MIRROR"); fi

# An toàn: chỉ làm việc (và xoá) bên trong thư mục dự án.
mkdir -p "$LTHT_BUILD_DIR"
BUILD_ABS="$(cd "$LTHT_BUILD_DIR" && pwd)"
case "$BUILD_ABS/" in
    "$ROOT"/*) ;;
    *) echo "LTHT_BUILD_DIR phải nằm trong $ROOT (hiện: $BUILD_ABS)" >&2; exit 1 ;;
esac
echo "== Thư mục làm việc: $LTHT_BUILD_DIR"
mkdir -p "$LTHT_BUILD_DIR"

echo "== [1/3] Giai đoạn 1: tải gói, giải nén gói required, tạo kernel + initrd (Python)"
PYTHONIOENCODING=utf-8 "$PY" -u "$HERE/mkrootfs.py" --work "$LTHT_BUILD_DIR" "${MIRROR_ARGS[@]}"

echo "== [2/3] Giai đoạn 2: debootstrap --second-stage + apt-get install trong v86 (Node)"
rm -rf -- "$BUILD_ABS/image"
UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-8}" node "$HERE/run-stage2.mjs"

if [ "${1:-}" = "--test" ]; then
    echo "== [3/3] Kiểm thử nghiệm thu (Node)"
    node "$HERE/test-image.mjs"
else
    echo "== [3/3] Bỏ qua kiểm thử (chạy: node image/test-image.mjs)"
fi
echo "== Xong. Ảnh ở $LTHT_BUILD_DIR/image - chạy 'npm run dev' hoặc 'npm run build'."

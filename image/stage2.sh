#!/bin/sh
# Giai đoạn 2: chạy NGAY TRONG máy ảo (v86) với vai trò PID 1, trên hệ tệp
# gốc 9p được tạo bởi mkrootfs.py. Tương đương `chroot TARGET
# /debootstrap/debootstrap --second-stage` rồi `apt-get install` các gói bổ sung.
# Kết thúc bằng dòng LTHT_STAGE2_OK (hoặc LTHT_STAGE2_FAIL) trên ttyS0.

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/root LANG=C.UTF-8 LC_ALL=C.UTF-8 TERM=dumb
export DEBIAN_FRONTEND=noninteractive DEBCONF_NONINTERACTIVE_SEEN=true

T0=$(date +%s)
log() { echo "[stage2 +$(( $(date +%s) - T0 ))s] $*"; }
fail() {
    echo "LTHT_STAGE2_FAIL: $*"
    tail -n 80 /debootstrap/debootstrap.log 2>/dev/null
    sync
    while :; do sleep 3600; done
}

mount -t proc proc /proc
mount -t sysfs sysfs /sys
mkdir -p /dev/pts /dev/shm
mount -t devpts -o gid=5,mode=620 devpts /dev/pts
mount -t tmpfs -o mode=755 tmpfs /run
mount -t tmpfs tmpfs /dev/shm
ln -sf /proc/self/fd /dev/fd 2>/dev/null

# Không cài tài liệu/bản dịch thừa (giữ trang man tiếng Anh và tệp copyright).
cp /ltht/overlay/etc/dpkg/dpkg.cfg.d/ltht-nodoc /etc/dpkg/dpkg.cfg.d/ltht-nodoc

log "debootstrap --second-stage"
/debootstrap/debootstrap --second-stage || fail "debootstrap --second-stage"
log "debootstrap xong"
# debootstrap gỡ các mount nó tự gắn khi kết thúc: gắn lại cho apt/dpkg.
mountpoint -q /proc || mount -t proc proc /proc
mountpoint -q /sys || mount -t sysfs sysfs /sys
mkdir -p /dev/pts
mountpoint -q /dev/pts || mount -t devpts -o gid=5,mode=620,ptmxmode=666 devpts /dev/pts
[ -e /dev/ptmx ] || ln -sf pts/ptmx /dev/ptmx

# Kho cục bộ chứa .deb đã tải ở giai đoạn 1 (không cần mạng khi dựng).
LIST=/etc/apt/sources.list.d/ltht-build.list
echo "deb [trusted=yes] file:/var/local/ltht-repo ./" > $LIST
APTOPT="-o Dir::Etc::SourceList=$LIST -o Dir::Etc::SourceParts=- -o Acquire::Languages=none"
apt-get $APTOPT update || fail "apt-get update (kho cục bộ)"
log "apt-get install: $(grep -v '^#' /ltht/packages.txt | tr '\n' ' ')"
apt-get $APTOPT install -y --no-install-recommends $(grep -v '^#' /ltht/packages.txt) \
    || fail "apt-get install"
log "cài gói xong"

# --- cấu hình hệ thống ---
cp -a /ltht/overlay/. /
chmod 440 /etc/sudoers.d/student
chmod 755 /usr/local/sbin/* /usr/local/bin/* /usr/local/lib/ltht/* 2>/dev/null

cat > /etc/apt/sources.list <<'EOF'
deb http://deb.debian.org/debian bookworm main
deb http://deb.debian.org/debian bookworm-updates main
deb http://security.debian.org/debian-security bookworm-security main
EOF
rm -f $LIST

echo "LANG=C.UTF-8" > /etc/default/locale
ln -sf /usr/share/zoneinfo/Asia/Ho_Chi_Minh /etc/localtime
echo "Asia/Ho_Chi_Minh" > /etc/timezone
printf '%s\n' "proc /proc proc defaults 0 0" > /etc/fstab

for k in /usr/lib/modules/*; do depmod -a "$(basename "$k")"; done

# Người dùng student (không phải root), sudo không cần mật khẩu.
useradd -m -u 1000 -s /bin/bash -G sudo,dialout,adm student || fail useradd
passwd -d student >/dev/null
passwd -l root >/dev/null
sed -i 's/^#force_color_prompt=yes/force_color_prompt=yes/' /home/student/.bashrc
cat >> /home/student/.bashrc <<'EOF'

# --- LTHT ---
export EDITOR=nano
alias ll='ls -alF'
EOF
cp -a /ltht/samples/. /home/student/
chown -R student:student /home/student

# Dọn dẹp: chỉ mục apt, cache, tài liệu thừa của các gói đã giải nén ở giai đoạn 1.
apt-get clean
rm -rf /var/lib/apt/lists/* /var/cache/apt/*.bin /var/local/ltht-repo /var/log/apt/eipp.log.xz
mkdir -p /var/lib/apt/lists/partial
find /usr/share/doc -mindepth 1 -not -name copyright -not -type d -delete 2>/dev/null
find /usr/share/doc -mindepth 1 -type d -empty -delete 2>/dev/null
rm -rf /usr/share/locale/* /usr/share/info/* /usr/share/lintian /usr/share/linda
find /usr/share/man -mindepth 1 -maxdepth 1 -type d ! -name 'man*' -exec rm -rf {} + 2>/dev/null
rm -f /var/log/*.log /var/cache/debconf/*-old /var/lib/dpkg/*-old
mandb -q 2>/dev/null || true

mkdir -p /usr/local/share/ltht
dpkg-query -W -f='${Package} ${Version}\n' > /usr/local/share/ltht/installed-packages.txt
log "gcc: $(gcc --version | head -n1)"
log "as: $(as --version | head -n1)"
rm -rf /ltht
sync
echo "LTHT_STAGE2_OK"
while :; do sleep 3600; done

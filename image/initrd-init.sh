#!/bin/sh
# /init của initrd tối giản (busybox-static của Debian).
# Nạp module virtio + 9p của kernel Debian, gắn hệ tệp gốc từ thiết bị 9p
# "host9p" do v86 cung cấp rồi chuyển sang init thật của Debian.
/bin/busybox --install -s /bin
export PATH=/bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev

for m in $(cat /modules/load.txt); do
    insmod /modules/$m || echo "initrd: không nạp được $m"
done

init=/sbin/init
rootflags=trans=virtio,version=9p2000.L,msize=512000
for arg in $(cat /proc/cmdline); do
    case "$arg" in
        init=*) init="${arg#init=}" ;;
        ltht.rootflags=*) rootflags="${arg#ltht.rootflags=}" ;;
    esac
done

if ! mount -t 9p -o "$rootflags" host9p /root; then
    echo "initrd: không gắn được 9p root, vào shell cứu hộ"
    exec sh
fi

mkdir -p /root/dev
mount --move /dev /root/dev
umount /proc /sys
exec switch_root /root "$init"

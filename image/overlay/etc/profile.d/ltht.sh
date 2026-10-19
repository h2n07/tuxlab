# LTHT: báo cho giao diện web biết shell đã sẵn sàng (kênh phụ ttyS0, không hiện trong terminal).
if [ "$(tty 2>/dev/null)" = "/dev/hvc0" ] && [ -w /dev/ttyS0 ]; then
    printf '\nLTHT_READY\n' > /dev/ttyS0 2>/dev/null
fi

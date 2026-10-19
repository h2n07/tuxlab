Lab 2 - Assembly AT&T 32-bit trên Linux (int $0x80)

  as -o example.o example.s     # hợp dịch
  ld -o example example.o       # liên kết
  ./example                     # chạy
  echo $?                       # xem mã thoát

Gỡ lỗi:   gdb ./example   (break _start, run, stepi, info registers)
Xem mã:   objdump -d example
Theo dõi lời gọi hệ thống:  strace ./example

Số hiệu lời gọi hệ thống (i386): 1 = sys_exit, 3 = sys_read, 4 = sys_write

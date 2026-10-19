# example.s - Hello World bằng assembly AT&T 32-bit (Linux, int $0x80)
# Hợp dịch:  as -o example.o example.s
# Liên kết:  ld -o example example.o
# Chạy:      ./example
.section .data
output:
    .ascii "Hello, World\n"

.section .text
.globl _start
_start:
    movl $13, %edx          # độ dài chuỗi
    movl $output, %ecx      # địa chỉ chuỗi
    movl $1, %ebx           # fd 1 = stdout
    movl $4, %eax           # sys_write
    int $0x80

    movl $0, %ebx           # mã thoát 0
    movl $1, %eax           # sys_exit
    int $0x80

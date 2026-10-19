# echo.s - đọc một chuỗi từ bàn phím (sys_read) rồi in lại (sys_write)
# as -o echo.o echo.s && ld -o echo echo.o && ./echo
.section .data
prompt:
    .ascii "Nhap mot chuoi: "
prompt_len = . - prompt
answer:
    .ascii "Ban vua nhap: "
answer_len = . - answer

.section .bss
    .lcomm buffer, 256

.section .text
.globl _start
_start:
    movl $4, %eax               # sys_write(1, prompt, prompt_len)
    movl $1, %ebx
    movl $prompt, %ecx
    movl $prompt_len, %edx
    int $0x80

    movl $3, %eax               # sys_read(0, buffer, 256)
    movl $0, %ebx
    movl $buffer, %ecx
    movl $256, %edx
    int $0x80
    movl %eax, %esi             # số byte đã đọc (gồm cả '\n')

    movl $4, %eax               # sys_write(1, answer, answer_len)
    movl $1, %ebx
    movl $answer, %ecx
    movl $answer_len, %edx
    int $0x80

    movl $4, %eax               # sys_write(1, buffer, so_byte)
    movl $1, %ebx
    movl $buffer, %ecx
    movl %esi, %edx
    int $0x80

    movl $1, %eax               # sys_exit(0)
    movl $0, %ebx
    int $0x80

# reverse.s - đọc chuỗi từ bàn phím rồi in chuỗi đảo ngược (bỏ ký tự '\n')
# as -o reverse.o reverse.s && ld -o reverse reverse.o && ./reverse
.section .bss
    .lcomm input, 256
    .lcomm output, 257

.section .text
.globl _start
_start:
    movl $3, %eax               # n = sys_read(0, input, 256)
    movl $0, %ebx
    movl $input, %ecx
    movl $256, %edx
    int $0x80
    cmpl $0, %eax
    jle done

    movl %eax, %ecx             # ecx = n
    cmpb $10, input-1(%ecx)     # bỏ '\n' cuối nếu có
    jne 1f
    decl %ecx
1:
    movl %ecx, %edx             # edx = độ dài chuỗi đảo
    xorl %edi, %edi             # edi = chỉ số ghi
copy:
    cmpl $0, %ecx
    je finish
    decl %ecx
    movb input(%ecx), %al
    movb %al, output(%edi)
    incl %edi
    jmp copy
finish:
    movb $10, output(%edi)      # thêm '\n'
    incl %edx

    movl $4, %eax               # sys_write(1, output, edx)
    movl $1, %ebx
    movl $output, %ecx
    int $0x80
done:
    movl $1, %eax
    movl $0, %ebx
    int $0x80

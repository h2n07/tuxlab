/* bits.c - ví dụ C thuần (gcc nhanh hơn g++ vì không cần <iostream>)
 * gcc bits.c -o bits && ./bits
 */
#include <stdio.h>

static void print_bits(unsigned int x) {
    for (int i = 31; i >= 0; i--) {
        putchar((x >> i) & 1 ? '1' : '0');
        if (i % 8 == 0 && i) putchar(' ');
    }
    putchar('\n');
}

int main(void) {
    int x = 0x12345678;
    printf("x      = 0x%08x\n", x);
    printf("bits   = "); print_bits(x);
    printf("x << 4 = 0x%08x\n", x << 4);
    printf("x >> 4 = 0x%08x\n", x >> 4);
    printf("~x     = 0x%08x\n", ~x);
    return 0;
}

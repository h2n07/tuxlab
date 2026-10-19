// Lab1-template.cpp - Bài thực hành thao tác bit (bit manipulation)
//
// LƯU Ý: đây là file mẫu TẠM THỜI do trình dựng ảnh tạo ra. Giảng viên thay
// bằng file Lab1-template.cpp chính thức (đặt vào samples/LTHT/Lab1/ rồi dựng
// lại ảnh, hoặc tải lên bằng Trình quản lý tệp).
//
// Biên dịch và chạy:   g++ Lab1-template.cpp -o lab1 && ./lab1
//
// Quy tắc: chỉ dùng các toán tử ! ~ & ^ | + << >> trong các hàm bên dưới,
// không dùng if/vòng lặp, không dùng hằng lớn hơn 0xFF.
#include <iostream>

using namespace std;

// 1. Trả về x & y chỉ dùng ~ và |
int bitAnd(int x, int y) {
    return ~(~x | ~y);
}

// 2. Trả về byte thứ n (0..3) của x
int getByte(int x, int n) {
    return (x >> (n << 3)) & 0xFF;
}

// 3. Trả về số nhỏ nhất của bù hai 32 bit
int tmin() {
    return 1 << 31;
}

// 4. Trả về -x (tên negate trùng std::negate khi dùng using namespace std)
int negateNum(int x) {
    return ~x + 1;
}

// 5. Trả về 1 nếu x >= 0, ngược lại 0
int isPositiveOrZero(int x) {
    return !(x >> 31);
}

// 6. Đếm số bit 1 trong x (sinh viên tự cài đặt)
int bitCount(int x) {
    // TODO: sinh viên viết ở đây
    return 0;
}

// ---------------------------------------------------------------------------
// Phần chấm điểm - không sửa
static int score = 0, total = 0;

static void check(const char *name, int got, int expected) {
    total++;
    cout << name << ": ";
    if (got == expected) {
        score++;
        cout << "Pass." << endl;
    } else {
        cout << "Failed. (got " << got << ", expected " << expected << ")" << endl;
    }
}

int main() {
    check("bitAnd(6, 5)", bitAnd(6, 5), 6 & 5);
    check("bitAnd(-1, 0x55)", bitAnd(-1, 0x55), -1 & 0x55);
    check("getByte(0x12345678, 1)", getByte(0x12345678, 1), 0x56);
    check("getByte(0x12345678, 3)", getByte(0x12345678, 3), 0x12);
    check("tmin()", tmin(), (int)0x80000000);
    check("negateNum(5)", negateNum(5), -5);
    check("negateNum(0)", negateNum(0), 0);
    check("isPositiveOrZero(7)", isPositiveOrZero(7), 1);
    check("isPositiveOrZero(-3)", isPositiveOrZero(-3), 0);
    check("bitCount(5)", bitCount(5), 2);
    check("bitCount(-1)", bitCount(-1), 32);
    cout << "Your score: " << score << "/" << total << endl;
    return 0;
}

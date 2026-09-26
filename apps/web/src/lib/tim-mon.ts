// Khớp từ khoá cho ô tìm ở tab "Món đã bán" (2026-09-09, chủ quán yêu cầu).
//
// KHOẢNG TRẮNG NGƯỜI DÙNG GÕ LÀ MỘT PHẦN CỦA TỪ KHOÁ. Đây là cả điểm của hàm này.
//
// Ô tìm cũ dùng `khongDau` — hàm đó `.trim()` từ khoá, nên gõ "ga " thành "ga" và "Ngao" vẫn
// nhảy vào kết quả (chữ "ga" nằm giữa N-**ga**-o). Menu quán có hàng trăm món nên kiểu khớp
// giữa-từ này làm ô tìm gần như vô dụng với các âm ngắn: "ga", "ca", "bo", "cua"...
//
// Cách chữa: giữ nguyên khoảng trắng của từ khoá, và ĐỆM tên món bằng một khoảng trắng ở hai
// đầu trước khi so. Nhờ đó:
//
//     "ga "  khớp "Gà nướng", "Lẩu gà"   — KHÔNG khớp "Ngao hấp"
//     " ga"  khớp "Gà nướng", "Lẩu gà"   — KHÔNG khớp "Ngao hấp"
//     "ga"   khớp cả ba                   — không gõ khoảng trắng thì vẫn khớp giữa từ như cũ
//
// Đệm hai đầu là phần bắt buộc: thiếu nó thì "ga " không khớp "Lẩu gà" (tên hết ở chữ "gà",
// không có khoảng trắng nào theo sau) — người dùng gõ để LỌC BỚT chứ không phải để mất luôn
// món mình đang tìm.
//
// DẤU NGƯỜI DÙNG GÕ CŨNG LÀ MỘT PHẦN CỦA TỪ KHOÁ (2026-09-26, chủ quán báo gõ "gà" ra cả
// "ngải"). Bỏ dấu cả hai phía là tiện cho ai gõ không dấu, nhưng ai đã mất công gõ "gà" thì
// "ngải" (n-**gả**-i, bỏ dấu thành n-ga-i) không phải thứ họ tìm. Luật: từ khoá KHÔNG dấu → so
// bỏ dấu như cũ; từ khoá CÓ dấu → so giữ dấu. Không phải một công tắc riêng: người dùng đã nói
// ý mình bằng chính cách gõ.

/** Bỏ dấu + thường hoá, GIỮ NGUYÊN khoảng trắng hai đầu.
 *
 * Tách khỏi `khongDau` (ở `supplier-stats.ts`) cho ô tìm kiếm nào coi khoảng trắng là một phần
 * của từ khoá — gõ "ga " để loại "Ngao" thì đúng cái `.trim()` bên đó là thứ làm hỏng ý đó.
 */
export function boDau(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

/** Thường hoá nhưng GIỮ dấu. `NFC` trước: bàn phím iOS hay gõ ra dạng tách rời (a + dấu huyền),
 *  tên món trong DB lại là dạng gộp — không chuẩn hoá thì "gà" gõ trên iPhone không khớp "gà"
 *  trong DB dù nhìn y hệt. */
function giuDau(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

/** Từ khoá có dấu tiếng Việt (hoặc chữ đ) không — tức là bỏ dấu đi thì nó đổi khác. */
function coDau(tuKhoa: string): boolean {
  return boDau(tuKhoa) !== giuDau(tuKhoa);
}

/** Gộp mọi chuỗi khoảng trắng thành một dấu cách. Tên món nhập tay hay có hai dấu cách liền,
 *  và tab/xuống dòng lọt vào khi người dùng dán từ chỗ khác. */
function gonKhoangTrang(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/**
 * Tên món (hoặc tên nhóm) có khớp từ khoá không.
 *
 * Từ khoá rỗng = khớp tất cả. Từ khoá chỉ có khoảng trắng cũng khớp tất cả — mọi tên sau khi
 * đệm đều chứa một dấu cách, và đó là hành vi đúng: người dùng chưa gõ gì có nghĩa.
 */
export function khopTuKhoa(ten: string, tuKhoa: string): boolean {
  const chuan = coDau(tuKhoa) ? giuDau : boDau;
  const k = gonKhoangTrang(chuan(tuKhoa));
  if (!k) return true;
  return ` ${gonKhoangTrang(chuan(ten)).trim()} `.includes(k);
}

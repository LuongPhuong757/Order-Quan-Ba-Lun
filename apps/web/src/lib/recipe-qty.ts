// Phần TÍNH SỐ của màn "Nguyên liệu món" (2026-09-11) — tách khỏi component để test được
// không cần dựng React: đây là chỗ một lỗi nhỏ đi thẳng vào cột định lượng của DB và chỉ lộ ra
// nhiều tuần sau, lúc báo cáo tiêu hao ra số lạ.
//
// Cả 4 hàm đều THUẦN, không đụng DOM, không đụng API.

/** Hiển thị định lượng cho người đọc — khớp `formatQty` ở BE: 1500g đọc lên là "1,5 kg". */
export function fmtQty(qty: number, unit: string): string {
  const n = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (unit === 'g' && qty >= 1000) return `${n(qty / 1000)} kg`;
  if (unit === 'ml' && qty >= 1000) return `${n(qty / 1000)} l`;
  return `${n(qty)} ${unit}`;
}

/** Bước nhảy của hai nút −/+, theo đơn vị GỐC của nguyên liệu.
 *
 * Gram/ml nhảy 10 vì định lượng bếp toàn số hàng chục ("150g thịt"): bước 1 thì bấm 150 lần.
 * Đơn vị đếm (quả, lá, con, kể cả từ lạ như "mẹt" — đơn vị tuỳ ý từ 2026-09-07) nhảy 1. */
export function stepFor(unit: string): number {
  const u = unit.toLowerCase();
  if (u === 'g' || u === 'ml') return 10;
  if (u === 'kg' || u === 'l') return 0.1;
  return 1;
}

/** Làm tròn về 3 chữ số thập phân — đúng bằng `decimal(12,3)` của `recipe_lines`.
 *
 * Không có bước này thì 0,1 + 0,2 của JS ra 0,30000000000000004: FE hiện một số, DB lưu số đã
 * cắt cụt, và lần mở sau hai bên lệch nhau. */
export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Một lần bấm phím trên bàn phím số tự vẽ: chuỗi đang nhập + phím → chuỗi mới.
 *
 * Làm việc trên CHUỖI chứ không trên số, vì "1," và "1" là hai trạng thái khác nhau với người
 * đang gõ mà `Number()` không phân biệt được — chuyển sang số quá sớm thì vừa gõ dấu phẩy xong
 * nó biến mất ngay dưới tay.
 *
 * Quy tắc: chỉ một dấu phẩy; ",5" tự thành "0,5"; không có "007"; tối đa 9 ký tự. */
export function numpadPress(current: string, key: string): string {
  if (key === '⌫') return current.slice(0, -1);
  if (key === ',') {
    if (current.includes(',')) return current;
    return current === '' ? '0,' : current + ',';
  }
  if (current === '0') return key;
  if (current.length >= 9) return current;
  return current + key;
}

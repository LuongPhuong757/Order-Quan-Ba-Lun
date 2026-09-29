// Đọc ô định lượng ở màn Công thức món.
//
// Chấp nhận PHÂN SỐ vì đó là cách chủ quán nghĩ về nguyên liệu bán theo kiện: bia mua cả thùng
// 24 lon, một món dùng đúng 1 lon — gõ "1/24" tự nhiên hơn nhiều so với tự bấm máy tính ra
// 0,041666 rồi gõ lại. Cũng nhận dấu phẩy thập phân kiểu Việt Nam.
//
// Làm tròn 3 chữ số vì cột `recipe_lines.qty_per_serving` là `decimal(14,3)` — giữ nhiều chữ số
// hơn ở màn hình chỉ tạo ra một con số khác với con số thật sự được lưu.

/** Số chữ số thập phân cột `qty_per_serving` giữ được. */
const DECIMALS = 3;

/**
 * @returns số dương đã làm tròn, hoặc `null` khi không đọc được / không hợp lệ.
 *   `null` phải để nút Thêm tắt, KHÔNG được coi là 0: ghi lặng lẽ 0 vào định lượng làm
 *   giá vốn món hụt đi mà không ai biết.
 */
export function parseQty(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '.');
  if (!s) return null;

  const parts = s.split('/');
  if (parts.length > 2) return null;

  const num = Number(parts[0]);
  if (!Number.isFinite(num)) return null;

  let value: number;
  if (parts.length === 2) {
    const den = Number(parts[1]);
    // Mẫu số 0 cho ra Infinity, và Infinity lọt xuống DB thành một con số vô nghĩa.
    if (!Number.isFinite(den) || den === 0) return null;
    value = num / den;
  } else {
    value = num;
  }

  if (!(value > 0)) return null;

  const rounded = Number(value.toFixed(DECIMALS));
  // Làm tròn ra 0 nghĩa là định lượng nhỏ hơn mức cột lưu được. Từ chối thay vì ghi 0.
  if (!(rounded > 0)) return null;
  return rounded;
}

/** Chuỗi hiện cho người dùng thấy kết quả họ vừa gõ sẽ được lưu thành gì. */
export function formatQtyPreview(raw: string, unit: string): string | null {
  if (!raw.includes('/')) return null;
  const v = parseQty(raw);
  if (v === null) return null;
  return `= ${v.toLocaleString('vi-VN', { maximumFractionDigits: DECIMALS })} ${unit}`;
}

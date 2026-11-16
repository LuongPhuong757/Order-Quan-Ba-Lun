// Ô tìm của Sổ webhook đọc được SỐ TIỀN (chủ quán chốt 2026-11-16).
//
// Ca thật: khách bảo "em chuyển 650 rồi" — người ta gõ đúng con số khách nói. Ở quán, "650" luôn
// là 650 NGHÌN, nên ngoài khoản đúng 650đ còn phải ra cả khoản 650.000đ. Gõ đủ "650.000",
// "650,000", "650k" hay "650000đ" cũng phải ra cùng kết quả.
//
// Chuỗi có chữ cái khác (BAN05, tên khách…) thì KHÔNG phải số tiền — trả `[]`, và màn chỉ tìm
// trong nội dung như trước.

/** Các số tiền (đồng) mà chuỗi tìm `q` có thể là. `[]` = không phải số tiền. */
export function soTienTimDuoc(q: string): number[] {
  const s = q.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,3}(?:[.,]\d{3})+|\d+)(k|đ|d|vnd)?$/.exec(s);
  if (!m) return [];
  const n = Number(m[1].replace(/[.,]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return [];
  if (m[2] === 'k') return [n * 1000];
  // Có dấu nhóm nghìn hoặc chữ "đ" = người ta đã gõ ĐỦ số, lấy đúng số đó.
  if (/[.,]/.test(m[1]) || m[2]) return [n];
  // Gõ trần dưới 1 triệu thì có thể là "nghìn" — thêm ×1000. Từ 1 triệu trở lên người ta đã gõ
  // đủ số, ×1000 thành tiền tỷ chỉ làm lẫn kết quả.
  return n < 1_000_000 ? [n, n * 1000] : [n];
}

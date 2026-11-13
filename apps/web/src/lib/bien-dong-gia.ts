// Phần tính toán của tab "Biến động giá" — tách khỏi component để có test.
//
// Vì sao có `locDoiGia`: API `/supplier-reports/pairs` trả `change_pct = 0` (không phải `null`) cho
// mặt hàng nhập lại ĐÚNG giá cũ. Bản cũ chỉ bỏ `null` nên 59/65 dòng "Giảm giá" trên máy local là
// 60.000đ → 60.000đ, 0,0% — đếm sai và làm trang dài ~7.500px trên điện thoại (chủ quán duyệt
// 2026-11-13: ẨN HẲN mặt hàng giữ nguyên giá).

/** Đủ trường để lọc/xếp — `PairReport` thật có nhiều hơn. */
export type DoiGiaLite = {
  ingredient_name: string;
  change_pct: number | null;
  last_date: string;
};

/** Ngưỡng nhãn cảnh báo. 20% / 10% giữ từ bản cũ: 10% là mức một lần nhập ăn hết biên lãi món
 *  dùng nguyên liệu đó, 20% là mức phải gọi hỏi lại NCC ngay. */
export const NGUONG_MANH = 20;
export const NGUONG_CHU_Y = 10;

/** Có ĐỔI giá thật không — theo đúng con số người dùng NHÌN THẤY (1 chữ số thập phân). Dòng
 *  0,04% hiện ra "0,0%" mà vẫn lọt vào danh sách thì chính là lỗi cũ quay lại. */
export function coDoiGia(pct: number | null): pct is number {
  return pct !== null && Number.isFinite(pct) && Math.round(Math.abs(pct) * 10) > 0;
}

export type MucDo = 'manh' | 'chu-y' | null;
/** Chỉ TĂNG giá mới có nhãn — giảm giá là tin tốt, không cần cảnh báo. */
export function mucDo(pct: number): MucDo {
  if (pct >= NGUONG_MANH) return 'manh';
  if (pct >= NGUONG_CHU_Y) return 'chu-y';
  return null;
}

export type LocHuong = 'tatca' | 'tang' | 'giam';
export type XepDoiGia = 'manh' | 'moi' | 'ten';

export function locDoiGia<T extends DoiGiaLite>(rows: T[], tu: string, khongDau: (s: string) => string): T[] {
  const k = khongDau(tu.trim());
  return rows.filter((p) => coDoiGia(p.change_pct) && (!k || khongDau(p.ingredient_name).includes(k)));
}

export function theoHuong<T extends DoiGiaLite>(rows: T[], h: LocHuong): T[] {
  if (h === 'tatca') return rows;
  return rows.filter((p) => ((p.change_pct ?? 0) > 0) === (h === 'tang'));
}

export function xepDoiGia<T extends DoiGiaLite>(rows: T[], xep: XepDoiGia): T[] {
  const doLon = (p: T) => Math.abs(p.change_pct ?? 0);
  return [...rows].sort((a, b) => {
    if (xep === 'ten') return a.ingredient_name.localeCompare(b.ingredient_name, 'vi');
    if (xep === 'moi') return b.last_date.localeCompare(a.last_date) || doLon(b) - doLon(a);
    return doLon(b) - doLon(a) || a.ingredient_name.localeCompare(b.ingredient_name, 'vi');
  });
}

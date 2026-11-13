// Luật lọc / xếp / tóm tắt của tab "Giá vốn món" (làm lại 2026-11-13). Tách khỏi component để
// test được — ngưỡng 25/50 và thứ tự "món thiếu giá xuống cuối" là quyết định nghiệp vụ, không
// phải chi tiết giao diện.

/** Dưới 25%: mỏng tới mức một lần NCC tăng giá là lỗ. 25–50%: đáng để mắt. Từ 50%: ổn. Ngưỡng giữ
 *  nguyên như bảng cũ — chỉ đổi màu (cam / xanh ngọc thay đỏ / xanh lá, quy tắc màu admin). */
export const NGUONG_MONG = 25;
export const NGUONG_VUA = 50;

export type MucLai = 'mong' | 'vua' | 'on';

export function mucLai(pct: number | null): MucLai | null {
  if (pct === null) return null;
  if (pct < NGUONG_MONG) return 'mong';
  if (pct < NGUONG_VUA) return 'vua';
  return 'on';
}

/** Phần tối thiểu mỗi dòng cần để lọc/xếp — để test không phải dựng cả `FoodCostRow`. */
export type DongGiaVon = {
  menu_item_name: string;
  complete: boolean;
  margin_pct: number | null;
};

export type LocGiaVon = 'all' | 'duoi50' | 'thieu';
export type XepGiaVon = 'mong' | 'nhieu' | 'ten';

/** "Dưới 50%" chỉ tính món ĐỦ giá: món thiếu giá có giá vốn thấp hơn thật nên % lãi của nó chưa
 *  đáng tin — đã có nút "Thiếu giá" riêng. */
export const duoiNguong = (r: DongGiaVon) => r.complete && r.margin_pct !== null && r.margin_pct < NGUONG_VUA;

export function locGiaVon<T extends DongGiaVon>(rows: T[], loc: LocGiaVon): T[] {
  if (loc === 'duoi50') return rows.filter(duoiNguong);
  if (loc === 'thieu') return rows.filter((r) => !r.complete);
  return rows;
}

/** Món chưa đủ giá luôn xuống cuối khi xếp theo lãi — con số của chúng chưa dùng để quyết định
 *  được, để lẫn lên đầu chỉ gây hiểu nhầm (giữ từ bảng cũ). Không đổi mảng gốc. */
export function xepGiaVon<T extends DongGiaVon>(rows: T[], xep: XepGiaVon): T[] {
  const out = [...rows];
  if (xep === 'ten') return out.sort((a, b) => a.menu_item_name.localeCompare(b.menu_item_name, 'vi'));
  const huong = xep === 'mong' ? 1 : -1;
  return out.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    const pa = a.margin_pct ?? huong * 999;
    const pb = b.margin_pct ?? huong * 999;
    return (pa - pb) * huong;
  });
}

/** Dải 3 số: món lãi mỏng nhất · số món dưới 50% · biên LN trung bình (bình quân đơn giản của các
 *  món đủ giá — món nào cũng một phiếu bầu, không gia trọng theo giá bán). */
export function tomTatGiaVon<T extends DongGiaVon>(rows: T[]): { mongNhat: T | null; duoi50: number; trungBinh: number | null } {
  const du = rows.filter((r) => r.complete && r.margin_pct !== null);
  const mongNhat = du.reduce<T | null>((m, r) => (!m || (r.margin_pct as number) < (m.margin_pct as number) ? r : m), null);
  const trungBinh = du.length === 0 ? null : du.reduce((s, r) => s + (r.margin_pct as number), 0) / du.length;
  return { mongNhat, duoi50: du.filter(duoiNguong).length, trungBinh };
}

/** Tên nguyên liệu BE ghép sẵn NCC ("Bạch Tuộc · Nguyệt Ốc Tôm", từ 2026-10-19 một món có thể có
 *  hai dòng cùng nguyên liệu khác NCC) → tách để in NCC thành dòng phụ nhỏ. */
export function tachTenNcc(ten: string): { ten: string; ncc: string | null } {
  const i = ten.indexOf(' · ');
  return i < 0 ? { ten, ncc: null } : { ten: ten.slice(0, i), ncc: ten.slice(i + 3) };
}

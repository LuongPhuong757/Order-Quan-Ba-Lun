// Hàm nhỏ dùng chung cho hộp Công thức (`RecipePanel.tsx`) và ô thêm nguyên liệu
// (`RecipeAddLine.tsx`). Tách ra 2026-11-12 khi làm lại hộp theo góp ý — file cũ đã ~650 dòng.

/** Một dòng gợi ý = một cặp nguyên liệu × NCC (`GET /recipes/options`). `supplier_id: null` =
 * nguyên liệu chưa có NCC nào đang bán. */
export type Option = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_unit: string | null;
  last_unit_price: number | null;
  used_in_items: number;
};

export type RecipeLine = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  /** Đơn vị GỐC của nguyên liệu (g, ml, hộp, lon…) — `qty_per_serving` tính theo đơn vị này. */
  unit: string;
  qty_per_serving: number;
  /** `null` = dòng khai trước 2026-10-19 của nguyên liệu nhiều NCC, chưa chọn NCC. */
  supplier_id: string | null;
  supplier_name: string | null;
};

/** Điền sẵn ô thêm dòng — bấm "Chọn NCC" ở một dòng chưa chọn NCC. `n` đổi mỗi lần bấm để bấm
 * lại cùng dòng vẫn điền lại. */
export type Prefill = { name: string; qty: string; unit: string; n: number };

export const optKey = (o: { ingredient_id: string; supplier_id: string | null }) => `${o.ingredient_id}|${o.supplier_id ?? ''}`;

/** Đơn vị dùng khi tạo nguyên liệu MỚI (chưa có đơn vị gốc nào để bám). */
export const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'quả', 'lá', 'củ', 'bó', 'gói', 'hộp', 'lát', 'con', 'miếng', 'cái'];

/** Đơn vị ĐỔI ĐƯỢC sang đơn vị gốc của nguyên liệu (góp ý 2026-11-11: Nem Chua tính theo hộp mà
 *  ô đơn vị để "g" — nhập 1 thành 1 gam). Cùng luật `toBaseQty` ở BE: g↔kg, ml↔l; đơn vị đếm
 *  (hộp, lon, con…) chỉ có chính nó. Nhập g/kg cho thứ đo bằng ml thì BE cũng từ chối. */
export function convertibleUnits(base: string): string[] {
  const b = base.trim().toLowerCase();
  if (b === 'g' || b === 'kg') return ['g', 'kg'];
  if (b === 'ml' || b === 'l') return ['ml', 'l'];
  return [base.trim() || 'cái'];
}

/** Bỏ dấu để so khớp gợi ý — cùng quy tắc với `normalizeName` ở BE, giữ hai bên hiểu giống nhau. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim();
}

/** Số gọn kiểu Việt: 0,5 · 1.000 · 12,25 (tối đa 2 số lẻ). */
export function so(v: number): string {
  return v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/** Tiền làm tròn đồng: "10.000đ". Còn nguyên liệu chưa có giá thì là mức tối thiểu → "≥ ". */
export function tien(v: number, complete = true): string {
  return `${complete ? '' : '≥ '}${Math.round(v).toLocaleString('vi-VN')}đ`;
}

/** % làm tròn — một số lẻ khi dưới 10% (phần phụ thường chỉ vài %). Không hiện 0% cho số dương. */
export function phanTram(v: number, base: number): string {
  const p = (v / base) * 100;
  return p < 10 && p > 0 ? `${Math.max(0.1, Math.round(p * 10) / 10).toLocaleString('vi-VN')}%` : `${Math.round(p)}%`;
}

/** Đơn giá theo đơn vị DỄ ĐỌC: giá trên 1 g → "20.000đ/kg", trên 1 ml → "/l", đơn vị đếm giữ nguyên. */
export function donGia(unitPriceBase: number | null | undefined, base: string): string | null {
  if (unitPriceBase === null || unitPriceBase === undefined) return null;
  const b = base.trim().toLowerCase();
  if (b === 'g') return `${tien(unitPriceBase * 1000)}/kg`;
  if (b === 'ml') return `${tien(unitPriceBase * 1000)}/l`;
  return `${tien(unitPriceBase)}/${base}`;
}

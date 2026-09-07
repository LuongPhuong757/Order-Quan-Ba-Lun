// Chuẩn hoá tên nguyên liệu + quy đổi đơn vị. THUẦN, không DB — để test được không cần MySQL.
//
// Hai việc ở đây đều phục vụ MỘT mục tiêu: mỗi thứ nguyên liệu chỉ tồn tại ĐÚNG MỘT dòng, đo
// bằng ĐÚNG MỘT đơn vị. Nếu "thịt bò" nằm ở 3 dòng, hoặc cùng một dòng lúc ghi gram lúc ghi kg,
// thì báo cáo "tháng này hết bao nhiêu thịt bò" không cộng lại được và cả tính năng vô nghĩa.

/** Bỏ dấu tiếng Việt + thường hoá + gộp khoảng trắng.
 *
 * Dùng làm `ingredients.name_key` (UNIQUE): "Thịt Bò", "thit bo", "Thịt  bò" đều ra `thit bo`
 * nên khi nhập công thức gõ kiểu nào cũng trỏ về đúng dòng đang có, KHÔNG đẻ thêm dòng mới.
 *
 * Chỉ chặn được trùng CHÍNH TẢ. Trùng NGỮ NGHĨA ("bò" vs "thịt bò") là hai key khác nhau —
 * đó là việc của chức năng gộp nguyên liệu, xem `IngredientsService.merge`.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')                    // tách chữ và dấu thành 2 ký tự
    .replace(/[̀-ͯ]/g, '') // xoá toàn bộ dấu thanh + dấu mũ vừa tách ra
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')                  // đ/Đ không phải tổ hợp dấu nên NFD không tách được
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nhóm đơn vị. Mỗi nguyên liệu thuộc đúng 1 nhóm và được LƯU bằng đơn vị gốc của nhóm đó
 * (đơn vị nhỏ nhất) — nhập 0,2kg thì lưu 200g. Lưu nguyên si "0.2 kg" cạnh "150 g" là tự tay
 * tạo ra hai thang đo trong cùng một cột. */
export type UnitKind = 'mass' | 'volume' | 'count';

/** Đơn vị GỐC của mỗi nhóm — luôn là đơn vị nhỏ nhất để mọi định lượng là số nguyên đẹp. */
export const BASE_UNIT: Record<UnitKind, string> = {
  mass: 'g',
  volume: 'ml',
  count: 'cái',
};

/** Hệ số quy về đơn vị gốc. Nhóm `count` cố ý KHÔNG có bội số: "quả", "lá", "cái", "củ" là các
 * đơn vị đếm KHÁC NHAU, không quy đổi lẫn nhau được (3 lá chanh ≠ 3 quả chanh) — mỗi cái là một
 * đơn vị gốc riêng, xem `parseUnit`. */
// Cố ý KHÔNG nhận "lạng": miền Bắc hiểu là 100g, nơi khác hiểu khác — đơn vị mà hai người đọc
// ra hai số thì không được phép lọt vào cột định lượng.
const MASS_FACTORS: Record<string, number> = { g: 1, gr: 1, gram: 1, kg: 1000 };
const VOLUME_FACTORS: Record<string, number> = { ml: 1, l: 1000, lit: 1000, lít: 1000 };

/** Các đơn vị đếm được chấp nhận. Người nhập gõ tự do nhưng chỉ những từ này mới coi là đơn vị
 * đếm hợp lệ — tránh đơn vị rác kiểu "ít", "vừa" lọt vào rồi không cộng được. */
// 'hộp' thêm 2026-09-07 sau bug production: nhập hàng khai mặt hàng mới ("sữa đặc", "bơ") với
// đơn vị HỘP bị 400. Đây là kiểu đóng gói người nhập gõ thật, và một hộp là một hộp — đếm được,
// không nhập nhằng như "lạng", nên không có lý do chặn.
const COUNT_UNITS = ['cái', 'quả', 'trái', 'củ', 'lá', 'nhánh', 'bó', 'gói', 'hộp', 'lát', 'con', 'miếng'];

/** Danh sách đơn vị hợp lệ để in ra trong thông báo lỗi. Sinh TỪ chính các bảng trên chứ không
 * gõ tay: bản gõ tay đã lệch một lần (thêm đơn vị mà quên sửa câu lỗi, người dùng đọc câu lỗi
 * rồi tưởng đơn vị mình gõ vẫn không được nhận). */
export const ACCEPTED_UNITS: string[] = [
  ...Object.keys(MASS_FACTORS),
  ...Object.keys(VOLUME_FACTORS),
  ...COUNT_UNITS,
];

export type ParsedUnit = { kind: UnitKind; base_unit: string; factor: number };

/** Nhận diện đơn vị người dùng gõ → (nhóm, đơn vị gốc, hệ số quy đổi).
 *
 * `factor` là số nhân để ra đơn vị gốc: 'kg' → 1000 (1kg = 1000g), 'g' → 1, 'quả' → 1.
 * Trả `null` khi không nhận ra — caller PHẢI báo lỗi thay vì đoán bừa; đoán sai đơn vị là sai
 * số liệu tiêu hao gấp 1000 lần mà không ai nhìn ra.
 */
export function parseUnit(raw: string): ParsedUnit | null {
  const u = normalizeName(raw);
  if (!u) return null;

  // So khớp trên chuỗi ĐÃ BỎ DẤU: người nhập gõ 'lít' hay 'lit' đều ra cùng một thứ.
  const massKey = Object.keys(MASS_FACTORS).find((k) => normalizeName(k) === u);
  if (massKey) return { kind: 'mass', base_unit: BASE_UNIT.mass, factor: MASS_FACTORS[massKey] };

  const volKey = Object.keys(VOLUME_FACTORS).find((k) => normalizeName(k) === u);
  if (volKey) return { kind: 'volume', base_unit: BASE_UNIT.volume, factor: VOLUME_FACTORS[volKey] };

  // Đơn vị đếm: mỗi từ TỰ NÓ là đơn vị gốc, không quy về 'cái'. Giữ nguyên chữ người dùng gõ
  // (có dấu) để báo cáo đọc lên vẫn là "12 quả trứng" chứ không phải "12 cái trứng".
  const countUnit = COUNT_UNITS.find((k) => normalizeName(k) === u);
  if (countUnit) return { kind: 'count', base_unit: countUnit, factor: 1 };

  return null;
}

/** Quy định lượng người nhập về đơn vị gốc của nguyên liệu.
 *
 * Trả `null` khi đơn vị không nhận ra HOẶC khác NHÓM với đơn vị gốc (nhập 'ml' cho nguyên liệu
 * đo bằng gram) — hai lỗi này phải chặn ở chỗ nhập, không được ghi vào rồi tính sau.
 */
export function toBaseQty(qty: number, unit: string, base_unit: string): number | null {
  const from = parseUnit(unit);
  const to = parseUnit(base_unit);
  if (!from || !to) return null;
  if (from.kind !== to.kind) return null;
  // Trong nhóm đếm, 'quả' và 'lá' cùng kind nhưng KHÔNG đổi cho nhau được.
  if (from.kind === 'count' && from.base_unit !== to.base_unit) return null;
  return qty * from.factor;
}

/** MỘT đơn vị người nhập gõ bằng bao nhiêu đơn vị gốc — tức `qty_base_per_unit` của phiếu nhập.
 *
 * Sinh ra sau bug production 2026-09-07: màn Nhập hàng ghim cứng hệ số = 1 với MỌI đơn vị, nên
 * khai mặt hàng mới theo "KG" (BE lưu đơn vị gốc là 'g') làm tồn kho và giá gốc lệch đúng 1000
 * lần — nhập 10 KG giá 100.000đ ghi thành 10 g giá 100.000 đ/g. Hệ số phải TỰ TÍNH ở server từ
 * hai đơn vị thật, không được nhận từ client: client không có bảng đơn vị nên không thể biết.
 *
 * Trả `null` khi không suy ra được — đơn vị lạ ("thùng", "mẹt") hoặc khác nhóm với đơn vị gốc.
 * Caller giữ nguyên hệ số người dùng khai, KHÔNG được coi `null` là 1: đó đúng là cái bug này.
 */
export function baseUnitsPerUnit(purchase_unit: string, base_unit: string): number | null {
  const from = parseUnit(purchase_unit);
  const to = parseUnit(base_unit);
  if (!from || !to) return null;
  if (from.kind !== to.kind) return null;
  // Trong nhóm đếm, 'quả' và 'lá' cùng kind nhưng KHÔNG đổi cho nhau được.
  if (from.kind === 'count' && from.base_unit !== to.base_unit) return null;
  // Chia cho `to.factor` chứ không giả định nó bằng 1: đơn vị gốc trong DB là do `resolveUnit`
  // sinh ra nên hôm nay luôn là đơn vị nhỏ nhất, nhưng phép tính đúng thì không cần giả định đó.
  return from.factor / to.factor;
}

/** Hiển thị định lượng cho người đọc: 1500 g → "1,5 kg", 800 g → "800 g".
 *
 * Chỉ đổi lên đơn vị lớn khi số đủ lớn — báo cáo tháng ra "45,2 kg thịt bò" dễ đọc hơn nhiều so
 * với "45200 g", còn "150 g" thì giữ nguyên vì "0,15 kg" khó hình dung hơn. */
export function formatQty(qty_base: number, base_unit: string): string {
  const p = parseUnit(base_unit);
  const n = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  if (p?.kind === 'mass' && qty_base >= 1000) return `${n(qty_base / 1000)} kg`;
  if (p?.kind === 'volume' && qty_base >= 1000) return `${n(qty_base / 1000)} l`;
  return `${n(qty_base)} ${base_unit}`;
}

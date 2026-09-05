// Quy đổi đơn vị mua + so sánh giá. THUẦN, không DB — để test được không cần MySQL, cùng lệ
// với `ingredient-units.ts`.
//
// Toàn bộ tính năng cảnh báo giá đứng trên một ý duy nhất: **so sánh phải cùng thước**. NCC báo
// giá theo thứ họ cầm trên tay ("180 nghìn một thùng"), mà thùng thì đổi cỡ được và tuần sau họ
// có thể báo theo kg. Nên mọi con số đi vào so sánh đều phải quy về đơn vị gốc của nguyên liệu
// trước (M3.D-36). Đây là chỗ làm việc đó.

/** Ngưỡng mặc định (M3.D-22), % lệch của giá quy đổi.
 *
 * 5% quá nhạy với giá chợ Việt Nam — rau thịt nhảy 5% là chuyện hằng ngày, cảnh báo suốt thì
 * tuần thứ hai người dùng bấm bừa và tính năng chết. 10% là mức chủ quán thật sự quan tâm. */
export const DEFAULT_WARN_PCT = 10;

/** Trên mức này thì bắt duyệt TỪNG DÒNG, không cho bấm "Duyệt tất cả" (M3.D-22). 30% không còn
 * là biến động mùa vụ mà là chuyện bất thường, đáng để dừng lại nhìn từng cái. */
export const STRICT_PCT = 30;

export type AlertLevel = 'none' | 'warn' | 'strict';

/** Kết quả quy đổi một dòng hàng. Ba số này là các đẳng thức bất biến của spec (mục 5) — service
 * KHÔNG được nhận chúng từ client mà phải tính lại ở đây. */
export type LineAmounts = {
  /** = qty_purchase × qty_base_per_unit. Con số đi vào tồn kho. */
  qty_base: number;
  /** = unit_price ÷ qty_base_per_unit. Con số duy nhất so sánh được. */
  unit_price_base: number;
  /** = qty_purchase × unit_price, làm tròn về đồng. */
  amount: number;
};

/** Quy một dòng hàng về đơn vị gốc.
 *
 * `qty_base_per_unit` phải > 0: bằng 0 thì `unit_price_base` là chia cho 0, và một dòng hàng
 * "1 thùng = 0 ml" vốn đã vô nghĩa từ lúc khai. Ném lỗi ở đây thay vì để `Infinity` lọt vào DB
 * rồi phát hiện lúc xem báo cáo.
 */
export function computeLineAmounts(input: {
  qty_purchase: number;
  unit_price: number;
  qty_base_per_unit: number;
}): LineAmounts {
  const { qty_purchase, unit_price, qty_base_per_unit } = input;
  if (!(qty_base_per_unit > 0)) {
    throw new Error(`qty_base_per_unit phải > 0, nhận được ${qty_base_per_unit}`);
  }
  return {
    qty_base: round(qty_purchase * qty_base_per_unit, 3),
    unit_price_base: round(unit_price / qty_base_per_unit, 6),
    // Tiền Việt không có phần lẻ. Làm tròn ở đây, MỘT lần, để tổng phiếu luôn bằng đúng tổng các
    // dòng — cộng số chưa tròn rồi mới tròn ở tổng thì hai chỗ lệch nhau vài đồng và người dùng
    // sẽ tưởng hệ thống tính sai.
    amount: Math.round(qty_purchase * unit_price),
  };
}

/** % thay đổi của giá quy đổi so với lần nhập trước. `null` khi chưa có lần trước (M3.D-25) —
 * mặt hàng nhập lần đầu ở NCC này thì không có gì để so, cảnh báo lúc đó chỉ gây nhiễu.
 *
 * Dương = đắt lên, âm = rẻ đi.
 */
export function priceChangePct(prev_base: number | null, next_base: number): number | null {
  if (prev_base === null || !(prev_base > 0)) return null;
  return round(((next_base - prev_base) / prev_base) * 100, 2);
}

/** Mức cảnh báo cho một dòng.
 *
 * Xét trên TRỊ TUYỆT ĐỐI: giảm giá 40% cũng đáng dừng lại nhìn như tăng 40%. Giảm mạnh bất
 * thường thường là gõ nhầm số 0, hoặc nhầm đơn vị mua — cả hai đều làm hỏng số liệu y như tăng
 * giá, chỉ khác là không ai để ý vì "rẻ hơn thì tốt chứ sao".
 *
 * `threshold_pct` là ngưỡng riêng của mặt hàng (M3.D-23); để trống thì dùng ngưỡng chung.
 */
export function alertLevel(pct: number | null, threshold_pct?: number | null): AlertLevel {
  if (pct === null) return 'none';
  const warn = threshold_pct ?? DEFAULT_WARN_PCT;
  // Mức `strict` phải GIÃN THEO ngưỡng riêng, giữ đúng tỉ lệ 1:3 của cặp mặc định (10% → 30%).
  // Nếu neo cứng ở 30 thì mặt hàng nới ngưỡng lên 30% mất sạch dải `warn`: mọi thứ vượt ngưỡng
  // đều nhảy thẳng lên "bắt duyệt từng dòng", tức là nới ngưỡng xong lại bị hỏi nhiều hơn trước.
  // `max` với STRICT_PCT để ngưỡng siết chặt (5%) không kéo mức strict xuống 15% — 15% vẫn còn
  // là biến động mùa vụ bình thường, chưa đáng dừng từng dòng.
  const strict = Math.max(STRICT_PCT, warn * 3);
  const abs = Math.abs(pct);
  if (abs > strict) return 'strict';
  if (abs > warn) return 'warn';
  return 'none';
}

/** Cỡ đóng gói có đổi không (M3.D-37).
 *
 * Đây là kiểu tăng giá ngụy trang: NCC giữ nguyên "180.000/thùng" nhưng rút thùng từ 24 chai
 * xuống 20. `unit_price` không đổi một đồng nào, mà giá thật đã tăng 20%. Vì `unit_price_base`
 * đã tính trên hệ số nên `priceChangePct` bắt được — hàm này chỉ để nói RÕ trên popup rằng
 * nguyên nhân là đổi cỡ, chứ không phải NCC báo giá khác.
 */
export function packSizeChanged(prev: number | null, next: number): boolean {
  if (prev === null) return false;
  // So trên số đã làm tròn 3 chữ số: hệ số lưu dạng decimal(14,3) nên chênh lệch nhỏ hơn thế chỉ
  // là rác của phép chia, không phải người dùng khai lại cỡ thùng.
  return round(prev, 3) !== round(next, 3);
}

/** Làm tròn về `digits` chữ số thập phân. `Number.EPSILON` bù sai số nhị phân: không có nó thì
 * `round(1.005, 2)` ra 1 thay vì 1,01. */
function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((v + Number.EPSILON * Math.sign(v) * Math.abs(v)) * f) / f;
}

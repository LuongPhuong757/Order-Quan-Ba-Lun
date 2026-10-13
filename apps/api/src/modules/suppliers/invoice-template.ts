// Mẫu hoá đơn in cho NCC (2026-10-13).
//
// Vấn đề gốc: mỗi NCC tự viết hoá đơn một kiểu, chữ tay, thứ tự lung tung — chủ quán đọc mất
// công. Quán in sẵn một mẫu cố định cho từng NCC (danh sách mặt hàng họ hay giao), NCC chỉ điền
// số lượng + giá. File này giữ phần logic thuần để test được không cần DB.

/** Số lần nhập đếm trong bao nhiêu ngày gần nhất. 90 ngày theo được thực đơn hiện tại: món quán
 * bỏ bán tự tụt xuống cuối thay vì bám đầu phiếu vì lịch sử cũ. */
export const TEMPLATE_WINDOW_DAYS = 90;

export type TemplateRow = {
  ingredient_id: string;
  ingredient_name: string;
  /** Đơn vị NCC báo hàng ("thùng", "kg") — đây là chữ in ở cột ĐVT. */
  purchase_unit: string;
  /** Số PHIẾU (không phải tổng số lượng) có mặt hàng này trong kỳ. Tổng số lượng không so được
   * giữa kg và thùng; số lần giao thì so được, và đúng là thứ quyết định NCC dò tìm dòng nào. */
  times: number;
  last_delivery_date: string;
  hidden: boolean;
  /** Sinh ra sau lần lưu mẫu gần nhất — chủ quán chưa từng thấy nó trên màn cấu hình. */
  is_new: boolean;
};

/** Ngày bắt đầu kỳ đếm, 'YYYY-MM-DD', tính lùi từ `today` (đã là ngày giờ VN). Tính bằng UTC
 * trên chuỗi ngày nên không lệch theo múi giờ máy chạy. */
export function windowStart(today: string, days: number = TEMPLATE_WINDOW_DAYS): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/** Thứ tự trên mẫu: nhập nhiều lên đầu → bằng nhau thì món giao gần đây hơn → cuối cùng theo
 * tên. Bậc thứ ba bắt buộc phải có: thiếu nó thì hai lần in liền nhau có thể đảo thứ tự hai món
 * ngang điểm, NCC quen vị trí sẽ điền nhầm dòng. */
export function sortTemplateRows(rows: readonly TemplateRow[]): TemplateRow[] {
  return [...rows].sort(
    (a, b) =>
      b.times - a.times ||
      b.last_delivery_date.localeCompare(a.last_delivery_date) ||
      a.ingredient_name.localeCompare(b.ingredient_name, 'vi'),
  );
}

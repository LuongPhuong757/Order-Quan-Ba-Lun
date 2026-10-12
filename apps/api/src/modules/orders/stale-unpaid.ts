// "BÀN NGỒI QUÁ LÂU CHƯA THANH TOÁN" — dải đỏ trên đầu mọi màn (chủ quán chốt 2026-10-12).
//
// Module THUẦN: không import gì từ @nestjs/* hay typeorm, để test được mà không dựng app/DB
// (cùng lệ với `stale-open-order.ts`, `checkout-total.ts`).
//
// KHÁC HẲN "bàn treo" ở `stale-open-order.ts`, đừng gộp:
//  - Bàn treo = đơn mở mà KHÔNG còn món nào → hệ thống TỰ tính lại giờ vào, không ai thấy gì.
//  - Ở đây = đơn mở VẪN CÒN MÓN mà chưa thu tiền → báo cho NGƯỜI nhìn, hệ thống không tự làm gì.
//    Đơn này là tiền thật đang treo: khách quên trả, nhân viên quên bấm thu, hoặc thu rồi mà quên
//    ghi vào app. Tự đóng hộ là sai cả ba trường hợp.
//
// Chủ quán chốt: tính từ LÚC MỞ BÀN (`opened_at`), báo MỌI loại đơn (tại bàn, mang về, online),
// mọi tài khoản đều thấy, chỉ hết báo khi đơn đã thu tiền / đóng / ghi nợ. Đơn ghi nợ đã có
// `closed_at` nên tự rơi khỏi danh sách, không cần điều kiện riêng.

/** Dòng thô từ SQL — mysql2 trả số có thể là STRING, nên chuẩn hoá ở `pickStaleUnpaid`. */
export type StaleUnpaidRow = {
  id: string;
  table_id: string;
  table_code: string;
  table_name: string | null;
  source: string;
  customer_name: string | null;
  opened_ms: string | number;
};

export type StaleUnpaidItem = {
  order_id: string;
  table_id: string;
  /** Chữ hiện trên dải đỏ: tên bàn, đơn online thì kèm tên khách để nhận ra ngay là đơn nào. */
  label: string;
  opened_at: number;
  /** Đã mở bao lâu (ms) tính tới `nowMs` — FE tự đổi ra "3 giờ 10 phút". */
  open_ms: number;
};

/** `thresholdMin <= 0` = chủ quán TẮT cảnh báo → luôn rỗng.
 *
 * `nowMs` LUÔN truyền vào, không đọc giờ hệ thống bên trong — cùng lệ với `stale-open-order.ts`,
 * để test được ngưỡng mà không cần fake timer.
 *
 * Trả về đơn LÂU NHẤT lên đầu: dải đỏ trên điện thoại chỉ đủ chỗ cho vài bàn, bàn ngồi lâu nhất
 * là bàn có nguy cơ khách đã về mà chưa trả. */
export function pickStaleUnpaid(
  rows: readonly StaleUnpaidRow[],
  nowMs: number,
  thresholdMin: number,
): StaleUnpaidItem[] {
  if (!(thresholdMin > 0)) return [];
  const thresholdMs = thresholdMin * 60_000;
  return rows
    .map((r) => {
      const opened = Number(r.opened_ms);
      return {
        order_id: r.id,
        table_id: r.table_id,
        label: labelOf(r),
        opened_at: opened,
        open_ms: nowMs - opened,
      };
    })
    // `>=` chứ không phải `>`: ngưỡng 180 phút thì đúng phút thứ 180 là đã "quá 3 tiếng" trong
    // mắt người đọc đồng hồ. NaN (dòng hỏng) tự rơi ra vì mọi phép so với NaN đều false.
    .filter((it) => it.open_ms >= thresholdMs)
    .sort((a, b) => b.open_ms - a.open_ms);
}

function labelOf(r: StaleUnpaidRow): string {
  const table = r.table_name || r.table_code;
  if (r.source === 'ONLINE' && r.customer_name) return `${table} · ${r.customer_name}`;
  return table;
}

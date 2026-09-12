// Câu nhật ký cho thao tác CHUYỂN BÀN (2026-09-10).
//
// Module THUẦN: không import gì từ @nestjs/* hay typeorm, để test được mà không dựng app/DB
// (cùng lệ với `stale-open-order.ts`, `checkout-total.ts`, `public/store-status.ts`).
//
// ── VÌ SAO CÂU LOG PHẢI KÈM GIỜ MỞ GỐC ────────────────────────────────────────────────
// `transferTable` XOÁ đơn nguồn sau khi dời món + nhật ký sang đơn đích. Giờ vào ăn của lượt
// khách đó chỉ còn sống nếu đơn đích mang nó theo — mà khi bàn đích ĐANG có khách (gộp bàn)
// thì đơn đích giữ giờ mở của chính nó, giờ mở bên nguồn mất hẳn, không truy lại được ở đâu.
// Nên câu log luôn ghi kèm giờ mở của đơn nguồn: đó là bản lưu cuối cùng của mốc đó.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const p2 = (n: number) => String(n).padStart(2, '0');

/** "20:28 09/09" — giờ Việt Nam, cùng khuôn với cột giờ ở nhật ký đơn trên `HistoryPage`.
 *
 * Cộng thẳng +7 rồi đọc bằng `getUTC*` (đúng quy ước của `store-status.ts` và
 * `dish-sales.service.ts`): Asia/Ho_Chi_Minh cố định +7, không DST, nên không cần `Intl` —
 * và cũng không phụ thuộc dữ liệu ICU của runtime. */
export function fmtVnDateTime(ms: number): string {
  const d = new Date(ms + VN_OFFSET_MS);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}`;
}

/** Câu log ghi trên đơn ĐÍCH sau khi nhận món chuyển tới.
 * `srcTableName` là tên bàn nguồn (fallback mã bàn nếu bàn đã bị xoá — xem `transferTable`). */
export function transferInMessage(opts: {
  movedCount: number;
  srcTableName: string;
  srcOpenedAt: number;
}): string {
  return (
    `Nhận ${opts.movedCount} món chuyển từ ${opts.srcTableName} ` +
    `(mở ${fmtVnDateTime(opts.srcOpenedAt)})`
  );
}

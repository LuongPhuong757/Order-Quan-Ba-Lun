// "GIỜ VÀO ĂN" — mốc khách thật sự ngồi vào bàn (2026-09-10).
//
// Module THUẦN: không import gì từ @nestjs/* hay typeorm, để test được mà không dựng app/DB
// (cùng lệ với `stale-open-order.ts`, `checkout-total.ts`, `public/store-status.ts`).
//
// ── BUG GỐC ───────────────────────────────────────────────────────────────────────────
// Chạm vào bàn là `getOrCreateOpenOrder` tạo đơn THẬT ngay (GET /orders/by-table/:id), nên
// `opened_at` thật ra là "giờ ai đó mở drawer". Nhân viên tap nhầm / mở ra xem menu rồi thoát
// (giỏ hàng nằm ở FE, thoát là mất — `BulkOrderModal`) thì đơn rỗng đó vẫn nằm lại, và khách
// vào sau đó được ghi giờ vào ăn của lần tap nhầm, kèm luôn tên nhân viên tap nhầm.
//
// `stale-open-order.ts` đã chặn ca này nhưng chỉ khi đơn rỗng để quá 4 GIỜ — mốc đó sinh ra để
// chặn bill trôi sang ngày khác. Tap nhầm lúc 18:00, khách vào 19:00 vẫn lọt: dưới ngưỡng.
// Nên mốc thật phải lấy ở chiều ngược lại — lúc MÓN ĐẦU TIÊN được gọi, không có cửa sổ sai nào.

import { fmtIdleDuration } from './stale-open-order.js';

/** Dưới khoảng này thì không ghi dòng nhật ký giải thích: mở drawer rồi gọi món luôn là nhịp
 * làm việc bình thường, mỗi bàn một dòng "giờ vào tính lại" chỉ làm nhật ký nhiễu. `opened_at`
 * vẫn được dời trong mọi trường hợp — dời 30 giây thì không ai cần lời giải thích. */
export const SEAT_SHIFT_LOG_MIN_MS = 5 * 60 * 1000;

export function shouldLogSeatShift(gapMs: number): boolean {
  return gapMs >= SEAT_SHIFT_LOG_MIN_MS;
}

/** Câu nhật ký cho lần dời mốc — nói rõ bàn đã mở trống bao lâu trước khi có khách thật. */
export function seatShiftMessage(gapMs: number): string {
  return (
    `Bàn được mở trước đó ${fmtIdleDuration(gapMs)} mà chưa gọi món nào — ` +
    `giờ vào ăn tính từ món đầu tiên`
  );
}

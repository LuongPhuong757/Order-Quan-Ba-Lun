/**
 * M7.R4 (chống spam gửi lượt) và M7.R5 (chống spam chuông gọi nhân viên).
 *
 * ── Vì sao trần của khách tại bàn CHẶT HƠN giỏ đặt online ──
 * Giỏ online cho `MAX_QTY = 99` vì đơn ship có thể là tiệc, đặt trước. Khách đang ngồi ăn thì
 * không gọi 99 phần một món — con số lớn ở đây không phục vụ ai, nó chỉ còn là đường để một
 * lượt rác chiếm chỗ trong hàng chờ duyệt của nhân viên.
 */

export const MAX_LINES_PER_REQUEST = 20;
export const MAX_QTY_GUEST = 20;

/** M7.R4 — một bàn chỉ được có 3 lượt chờ duyệt cùng lúc. Nhiều hơn nghĩa là nhân viên đang
 *  không kịp duyệt, và thêm lượt nữa chỉ làm thẻ ở màn bếp dài ra chứ không giúp ai. */
export const MAX_WAITING_PER_ORDER = 3;

/** M7.R5 — cooldown theo CẶP (order_id, kind): bấm "Gọi nhân viên" rồi bấm ngay "Xin tính
 *  tiền" vẫn được, vì đó là hai việc khác nhau. */
export const CALL_COOLDOWN_MS = 60_000;

export type CartLineLike = { menu_item_id: string; qty: number };

export type CartLinesResult =
  | { ok: true }
  | { ok: false; error: 'EMPTY' | 'TOO_MANY_LINES' | 'QTY_TOO_HIGH' };

export function validateCartLines(lines: readonly CartLineLike[]): CartLinesResult {
  if (lines.length === 0) return { ok: false, error: 'EMPTY' };
  if (lines.length > MAX_LINES_PER_REQUEST) return { ok: false, error: 'TOO_MANY_LINES' };

  for (const l of lines) {
    // Gộp "không nguyên", "âm" và "quá trần" vào một mã: với khách thì cả ba đều là "số lượng
    // không hợp lệ", và tách mã ra chỉ làm câu báo lỗi khó viết hơn.
    if (!Number.isSafeInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY_GUEST) {
      return { ok: false, error: 'QTY_TOO_HIGH' };
    }
  }
  return { ok: true };
}

/**
 * Còn phải chờ bao nhiêu mili giây nữa mới được bấm chuông tiếp.
 * Trả về số > 0 thì tầng trên phải trả 429 kèm `cooldown_until` — màn khách hiện đồng hồ đếm
 * ngược chứ KHÔNG hiện lỗi đỏ (M7 §1.4).
 */
export function callCooldownLeftMs(lastCallAtMs: number | null, nowMs: number): number {
  if (lastCallAtMs === null) return 0;
  const left = lastCallAtMs + CALL_COOLDOWN_MS - nowMs;
  return left > 0 ? left : 0;
}

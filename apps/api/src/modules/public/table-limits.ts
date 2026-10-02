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
 *  tiền" vẫn được, vì đó là hai việc khác nhau.
 *
 *  Áp cho lời nhắn GIỐNG NHAU — xem `callBlockedMs`. */
export const CALL_COOLDOWN_MS = 60_000;

/** Khoảng cách tối thiểu giữa hai lời nhắn KHÁC NHAU.
 *
 * ⚠ Vì sao phải có con số thứ hai này (2026-10-01): từ khi khách ghi được lý do, mỗi lượt gọi
 * là một YÊU CẦU RIÊNG. "Thêm đá" rồi 10 giây sau nhớ ra "thêm giấy ăn" là chuyện bình thường
 * ở bàn ăn, mà cooldown 60 giây chung lại chặn thẳng — nhìn ra đúng là "gọi nhân viên hỏng sau
 * lần đầu". Chặn lời nhắn khác bằng đúng cooldown của lời nhắn trùng là nhầm hai việc khác hẳn
 * nhau: một bên là bấm lại vì sốt ruột, một bên là nhớ ra thêm thứ cần. */
export const CALL_MIN_GAP_MS = 10_000;

/** Trần lời nhắn CHƯA ai bấm "Đã nghe" của một bàn. Đây mới là chốt chặn spam thật — nó chặn
 *  theo khối lượng việc đang tồn chứ không theo đồng hồ, nên khách thật (gọi vài thứ rồi nhân
 *  viên tới) không bao giờ chạm tới, còn kẻ phá thì dừng ở cái thứ 5. */
export const MAX_UNACKED_CALLS_PER_ORDER = 5;

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

/** Chuẩn hoá lời nhắn để so sánh: không ghi gì, ghi chuỗi trắng, và `null` đều là MỘT. */
function sameNote(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/**
 * Còn phải chờ bao nhiêu mili giây nữa mới được bấm chuông tiếp. 0 = gọi được ngay.
 *
 * Hai mức, vì hai hành vi khác hẳn nhau:
 *  - **Lời nhắn TRÙNG** (gồm cả hai lần đều không ghi gì) → 60 giây. Đây là khách bấm lại vì
 *    sốt ruột; nhân viên đã có đúng tin đó rồi, chuông thêm lần nữa không nói thêm được gì.
 *  - **Lời nhắn KHÁC** → 10 giây. Đây là khách nhớ ra thêm một thứ cần mang xuống. Chặn nó
 *    bằng 60 giây là làm hỏng chính lý do tính năng lời nhắn tồn tại.
 */
export function callBlockedMs(
  last: { created_at: number; note: string | null } | null,
  nextNote: string | null | undefined,
  nowMs: number,
): number {
  if (last === null) return 0;
  const window = sameNote(last.note, nextNote) ? CALL_COOLDOWN_MS : CALL_MIN_GAP_MS;
  const left = last.created_at + window - nowMs;
  return left > 0 ? left : 0;
}

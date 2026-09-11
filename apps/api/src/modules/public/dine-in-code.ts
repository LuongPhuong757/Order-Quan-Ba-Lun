// MÃ GỌI MÓN TẠI BÀN — sinh, kiểm, và suy trạng thái (M4.D-04, M4.D-12..15).
//
// Module THUẦN: không import gì từ @nestjs/* hay typeorm, để test được mà không dựng app/DB
// (cùng lệ với `store-status.ts`, `order-guard.ts`, `orders/seated-at.ts`).
//
// ── VÌ SAO CÓ SỐ KIỂM TRA ───────────────────────────────────────────────────────────────────
// QR là QR CHUNG (M4.D-01) — hệ thống không có cách nào biết giỏ thuộc bàn nào, mọi thứ dựa
// vào nhân viên gõ đúng mã vào đúng bàn. Với mã 4 số trần, gõ sai một chữ số có xác suất trúng
// một giỏ ĐANG SỐNG của bàn khác; hậu quả không phải "báo lỗi" mà là món ra sai bàn, cộng thêm
// bàn đó bị ghi oan giờ vào ăn (`orders/seated-at.ts` dời `opened_at` theo món đầu tiên).
//
// Chữ số cuối là số kiểm tra Luhn: mọi lỗi sai MỘT chữ số, và mọi lỗi đảo hai chữ số liền kề
// (trừ 09↔90), đều bị bắt ngay tại chỗ thành "mã không tồn tại". Đây là lý do mã dài 5 số chứ
// không phải 4 — đừng "tối giản" nó về 4 số.
import { randomInt } from 'node:crypto';

/** Số chữ số phần thân (chưa gồm số kiểm tra). 4 → 10.000 tổ hợp. */
export const DINE_IN_CODE_BODY_DIGITS = 4;

/** Tổng độ dài mã khách đọc cho nhân viên. */
export const DINE_IN_CODE_LEN = DINE_IN_CODE_BODY_DIGITS + 1;

/** Hạn của mã — 15 phút (M4.D-12). Mã chỉ sinh khi nhân viên đã ở bàn (M4.D-03/05), nên chỉ
 * cần đủ cho vài phút soát món. Hạn ngắn = ít mã cùng sống = ít nguy cơ gõ trúng mã người khác. */
export const DINE_IN_CART_TTL_MS = 15 * 60 * 1000;

/** Số lần thử tìm một mã chưa bị chiếm trước khi bỏ cuộc (M4.D-15). */
export const DINE_IN_CODE_MAX_ATTEMPTS = 40;

/**
 * Số kiểm tra Luhn của phần thân.
 *
 * Luhn chuẩn: đi từ phải sang trái của phần thân, nhân đôi các chữ số ở vị trí lẻ (1-based),
 * chữ số nào nhân đôi vượt 9 thì trừ 9; số kiểm tra là số làm tổng chia hết cho 10.
 */
export function luhnCheckDigit(body: string): number {
  let sum = 0;
  // `i` đếm từ phải sang trái, bắt đầu 0. Số kiểm tra sẽ nằm ở vị trí i = -1 (tức chưa có),
  // nên chữ số ngoài cùng bên phải của THÂN là vị trí cần nhân đôi.
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    if (i % 2 === 0) {
      const doubled = digit * 2;
      sum += doubled > 9 ? doubled - 9 : doubled;
    } else {
      sum += digit;
    }
  }
  return (10 - (sum % 10)) % 10;
}

/** Đúng `DINE_IN_CODE_LEN` chữ số và số kiểm tra khớp. Dùng để loại mã gõ sai TRƯỚC khi
 * đụng vào DB — gõ sai không nên tốn một query. */
export function isValidDineInCode(code: string): boolean {
  if (code.length !== DINE_IN_CODE_LEN) return false;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  const body = code.slice(0, DINE_IN_CODE_BODY_DIGITS);
  return luhnCheckDigit(body) === code.charCodeAt(DINE_IN_CODE_LEN - 1) - 48;
}

/** Một mã hợp lệ ngẫu nhiên. `randomInt` (CSPRNG) chứ không `Math.random()`: mã là thứ duy
 * nhất chặn người ngoài đổ giỏ vào bàn người khác, đoán được là hỏng cả thiết kế. */
export function generateDineInCode(): string {
  const body = String(randomInt(0, 10 ** DINE_IN_CODE_BODY_DIGITS)).padStart(
    DINE_IN_CODE_BODY_DIGITS,
    '0',
  );
  return body + String(luhnCheckDigit(body));
}

export type DineInCartState = 'ACTIVE' | 'USED' | 'CANCELLED' | 'EXPIRED';

/** Các mốc thời gian cần để suy trạng thái — nhận đúng 3 field để hàm này test được không
 * cần dựng cả entity. */
export type DineInCartTimestamps = {
  used_at: number | null;
  cancelled_at: number | null;
  expires_at: number;
};

/**
 * ĐƯỜNG DUY NHẤT suy trạng thái của một giỏ. Bảng `dine_in_carts` không có cột `status`
 * (M4.D-24) nên mọi chỗ cần biết trạng thái PHẢI gọi hàm này, không tự so mốc thời gian tại chỗ.
 *
 * Thứ tự ưu tiên có chủ đích: `USED` thắng tất cả, kể cả khi mã đã quá hạn sau đó. Món đã vào
 * bill rồi thì trạng thái đúng của mã là "đã dùng" — trả về `EXPIRED` sẽ làm câu báo cho nhân
 * viên sai hoàn toàn ("mã hết hạn" thay vì "mã đã dùng bởi Hà, bàn 5", M4.D-13).
 */
export function dineInCartState(row: DineInCartTimestamps, nowMs: number): DineInCartState {
  if (row.used_at !== null) return 'USED';
  if (row.cancelled_at !== null) return 'CANCELLED';
  if (nowMs >= row.expires_at) return 'EXPIRED';
  return 'ACTIVE';
}

/** Còn lại bao nhiêu ms — kẹp về 0 để FE không phải tự lo số âm. `0` với mọi mã không ACTIVE. */
export function dineInCartExpiresInMs(row: DineInCartTimestamps, nowMs: number): number {
  if (dineInCartState(row, nowMs) !== 'ACTIVE') return 0;
  return Math.max(0, row.expires_at - nowMs);
}

// Khoá bộ đếm rate limit cho KHÁCH gọi món tại bàn (M7.R6 — làm 2026-11-10, QA BUG-06).
//
// Vì sao không đếm theo IP: mọi điện thoại trong quán đi ra internet qua MỘT IP public của wifi
// quán. Đếm theo IP thì cả quán chia nhau đúng một hạn mức — bài tải QA 2026-11-10 với 30 bàn:
// 20/30 điện thoại bị 429 ngay ở bước mở bàn (giới hạn `open` 10/phút/IP), và một khách bấm
// gửi món dồn dập làm khách bàn khác cũng bị chặn. Comment M7.R6 ở `public-table.controller.ts`
// đã ghi "PHẢI đổi sang guest:<token>" nhưng guard chưa từng làm.
//
// Ba loại khoá:
//   - Khách ĐÃ có phiên (state / cart / call / mở lại bàn kèm token)  → `guest:<token>`
//   - Mở bàn lần đầu, chưa có token                                      → `guest-open:<số bàn>`
//     (guard ghép thêm IP phía trước — xem `read-only-throttler.guard.ts`)
//   - Không đọc được gì hợp lệ → `null`, guard rơi về đếm theo IP như cũ.
//
// Token chỉ được nhận khi ĐÚNG KHUÔN 64 ký tự hex thường (đúng thứ `table-guest.service.ts`
// sinh ra) — chuỗi bừa không tạo được ô đếm mới. Còn kẻ bịa token đúng khuôn mỗi lần một cái
// để có ô đếm mới vô hạn thì bị TRẦN CHUNG THEO IP (`GUEST_IP_CEILING_PER_MIN`) chặn lại.
import { digitsOf } from '../../modules/public/table-input.js';

const GUEST_TABLE_PREFIX = '/api/public/table/';
const GUEST_TOKEN_RE = /^[0-9a-f]{64}$/;
/** Cùng mốc với `MAX_INPUT_LEN` ở `table-input.ts`: dài hơn thì không phải người gõ số bàn. */
const MAX_TABLE_INPUT_LEN = 16;

/**
 * Trần chung mọi request khách-tại-bàn từ MỘT IP trong 1 phút. Quán đông 30 bàn, mỗi bàn
 * 1–2 điện thoại poll 5s (12 lần/phút) ≈ 360–720 request/phút, cộng mở bàn + gửi món. 1.200 để
 * dư ~1,7 lần mà vẫn chặn được bot bịa token (mỗi token 1 ô đếm riêng) xả hàng nghìn request.
 */
export const GUEST_IP_CEILING_PER_MIN = 1200;

interface GuestReqLike {
  originalUrl?: string;
  url?: string;
  headers?: Record<string, unknown>;
  body?: unknown;
}

const pathOf = (req: GuestReqLike): string => String(req.originalUrl ?? req.url ?? '').split('?')[0];

export function isGuestTableRoute(req: GuestReqLike): boolean {
  return pathOf(req).startsWith(GUEST_TABLE_PREFIX);
}

const validToken = (v: unknown): string | null => (typeof v === 'string' && GUEST_TOKEN_RE.test(v) ? v : null);

export function guestThrottleKey(req: GuestReqLike): string | null {
  if (!isGuestTableRoute(req)) return null;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const token = validToken(req.headers?.['x-guest-token']) ?? validToken(body.guest_token);
  if (token) return `guest:${token}`;

  if (pathOf(req) === `${GUEST_TABLE_PREFIX}open`) {
    const input = typeof body.table_input === 'string' ? body.table_input : '';
    if (input.length === 0 || input.length > MAX_TABLE_INPUT_LEN) return null;
    const digits = digitsOf(input).replace(/^0+(?=\d)/, '');
    return digits ? `guest-open:${digits}` : null;
  }
  return null;
}

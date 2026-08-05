// OTP + phiên SĐT (2026-08-04) — phần QUYẾT ĐỊNH thuần của `POST /api/public/otp/request`
// và `POST /api/public/otp/verify`, theo đúng khuôn `submit-order.ts`: deps là port, bản cài
// thật (`PublicOtpService`) nối DB, file này test được bằng fake không cần MySQL.
//
// Mô hình đã chốt với chủ dự án (2026-08-04):
//  - Verify thành công = MỘT phiên đăng nhập gắn SĐT, hạn 90 ngày TRƯỢT.
//  - Mỗi thiết bị 1 tài khoản: verify kèm `currentSessionToken` (phiên của số cũ) thì phiên
//    đó bị THU HỒI — "đăng nhập sang tài khoản khác".
//  - Mỗi mã OTP là tiền (SMS/ZNS) → rate limit đếm THẲNG TRONG DB (khuôn D-18, không
//    throttler in-memory): cooldown 60s/SĐT, 3 mã/giờ/SĐT, 10 mã/giờ/IP.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { normalizePhone } from './phone.js';

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_COOLDOWN_MS = 60_000;
export const OTP_MAX_PER_WINDOW_PHONE = 3;
export const OTP_MAX_PER_WINDOW_IP = 10;
export const OTP_WINDOW_MS = 3_600_000;
export const OTP_MAX_ATTEMPTS = 5;
/** 90 ngày — hạn phiên, TRƯỢT: mỗi lần dùng hợp lệ được gia hạn lại đủ 90 ngày. */
export const SESSION_TTL_MS = 90 * 86_400_000;

/** Mã 6 chữ số, giữ dạng string để không mất số 0 đầu. CSPRNG — KHÔNG `Math.random()`
 * (cùng lý do T-08-29). Cho phép ép mã cố định qua env khi chạy mock (xem `PublicOtpService`). */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** sha256(`${phone}:${code}`) — KHÔNG BAO GIỜ lưu mã thô xuống DB. Trộn phone vào hash để
 * hai SĐT trùng mã không cho ra hash giống nhau (chặn tra cứu ngược theo bảng hash 10^6 mã). */
export function hashOtpCode(phone: string, code: string): string {
  return createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

/** So sánh hash chống timing attack — hai chuỗi hex 64 ký tự luôn cùng độ dài. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export type OtpAuditEvent = {
  action_kind:
    | 'public.otp_requested'
    | 'public.otp_verify_ok'
    | 'public.otp_verify_failed'
    | 'public.session_switched';
  phone: string;
  detail?: Record<string, unknown>;
};

export type OtpRequestDeps = {
  /** created_at của mã GẦN NHẤT cho SĐT này (mọi trạng thái) — null nếu chưa từng gửi. */
  findLatestOtpCreatedAt(phone: string): Promise<number | null>;
  countRecentOtpsByPhone(phone: string, sinceMs: number): Promise<number>;
  countRecentOtpsByIpHash(ipHash: string, sinceMs: number): Promise<number>;
  insertOtp(row: {
    phone: string;
    code_hash: string;
    expires_at: number;
    attempts_left: number;
    ip_hash: string;
  }): Promise<void>;
  /** Kênh gửi thật (mock/ZNS/SMS) — xem `otp-sender.ts`. */
  sendCode(phone: string, code: string): Promise<void>;
  generateCode(): string;
  hashIpFn(ip: string): string;
  /** Ghi audit (Task.md: "mọi hành động ở phần online đều cần log") — fire-and-forget phía impl. */
  audit(ev: OtpAuditEvent): void;
};

// Copy lỗi: BE build message hoàn chỉnh tại chỗ throw (khuôn Pitfall #6 — không đụng FRIENDLY_VN).
const PHONE_INVALID = { code: 'VALIDATION_FAILED', message: 'Số điện thoại không hợp lệ' };

function throwTooManyRequests(message: string): never {
  throw new HttpException({ code: 'TOO_MANY_REQUESTS', message }, HttpStatus.TOO_MANY_REQUESTS);
}

/**
 * `POST /api/public/otp/request` — gửi mã mới cho SĐT.
 *
 * Thứ tự kiểm: chuẩn hoá SĐT → cooldown 60s → quota SĐT/giờ → quota IP/giờ → insert row
 * TRƯỚC, gửi mã SAU. Insert trước để một lần gửi lỗi kênh vẫn ăn quota (kẻ spam không được
 * thử miễn phí); khách thật gặp lỗi kênh thì chờ hết cooldown bấm gửi lại — chấp nhận được.
 */
export async function requestOtp(
  deps: OtpRequestDeps,
  rawPhone: string,
  ctx: { ip: string; nowMs: number },
): Promise<{ cooldown_s: number; expires_in_s: number }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new BadRequestException(PHONE_INVALID);

  const latestCreatedAt = await deps.findLatestOtpCreatedAt(phone);
  if (latestCreatedAt !== null && ctx.nowMs - latestCreatedAt < OTP_COOLDOWN_MS) {
    const waitS = Math.ceil((OTP_COOLDOWN_MS - (ctx.nowMs - latestCreatedAt)) / 1000);
    throwTooManyRequests(`Vui lòng chờ ${waitS} giây rồi bấm gửi lại mã.`);
  }

  const ipHash = deps.hashIpFn(ctx.ip);
  const [phoneCount, ipCount] = await Promise.all([
    deps.countRecentOtpsByPhone(phone, ctx.nowMs - OTP_WINDOW_MS),
    deps.countRecentOtpsByIpHash(ipHash, ctx.nowMs - OTP_WINDOW_MS),
  ]);
  if (phoneCount >= OTP_MAX_PER_WINDOW_PHONE || ipCount >= OTP_MAX_PER_WINDOW_IP) {
    throwTooManyRequests('Bạn đã xin mã quá nhiều lần. Vui lòng thử lại sau khoảng 1 giờ.');
  }

  const code = deps.generateCode();
  await deps.insertOtp({
    phone,
    code_hash: hashOtpCode(phone, code),
    expires_at: ctx.nowMs + OTP_TTL_MS,
    attempts_left: OTP_MAX_ATTEMPTS,
    ip_hash: ipHash,
  });
  deps.audit({ action_kind: 'public.otp_requested', phone });

  await deps.sendCode(phone, code);

  return {
    cooldown_s: Math.ceil(OTP_COOLDOWN_MS / 1000),
    expires_in_s: Math.ceil(OTP_TTL_MS / 1000),
  };
}

export type ActiveOtpRow = {
  id: string;
  code_hash: string;
  expires_at: number;
  attempts_left: number;
};

export type OtpVerifyDeps = {
  /** Mã MỚI NHẤT chưa consume của SĐT — null nếu không có. Impl thật lọc `consumed_at IS NULL`. */
  findActiveOtp(phone: string): Promise<ActiveOtpRow | null>;
  decrementAttempts(id: string): Promise<void>;
  consumeOtp(id: string, nowMs: number): Promise<void>;
  insertSession(row: { token: string; phone: string; expires_at: number; last_used_at: number }): Promise<void>;
  /** Thu hồi phiên cũ của thiết bị (đổi tài khoản). Trả phone của phiên bị thu hồi, null nếu
   * token không trỏ tới phiên sống nào (đã hết hạn/thu hồi/không tồn tại — bỏ qua im lặng). */
  revokeSessionByToken(token: string, nowMs: number): Promise<string | null>;
  generateSessionToken(): string;
  audit(ev: OtpAuditEvent): void;
};

/**
 * `POST /api/public/otp/verify` — đổi mã lấy phiên 90 ngày.
 *
 * Mọi nhánh sai đều 400 với `code` riêng để FE chọn copy; nhập sai TRỪ lượt trước rồi mới
 * báo lỗi (mã chết hẳn khi hết `OTP_MAX_ATTEMPTS` lượt, chặn brute-force 10^6 tổ hợp).
 * Verify xong mã bị consume — dùng lại là `OTP_NOT_FOUND`, không có mã "xài chung".
 */
export async function verifyOtp(
  deps: OtpVerifyDeps,
  input: { phone: string; code: string; currentSessionToken?: string },
  ctx: { nowMs: number },
): Promise<{ session_token: string; phone: string; expires_at_ms: number }> {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new BadRequestException(PHONE_INVALID);

  const failAudit = (reason: string): void =>
    deps.audit({ action_kind: 'public.otp_verify_failed', phone, detail: { reason } });

  const otp = await deps.findActiveOtp(phone);
  if (!otp) {
    failAudit('NOT_FOUND');
    throw new BadRequestException({
      code: 'OTP_NOT_FOUND',
      message: 'Chưa có mã nào cho số này, hoặc mã đã dùng rồi. Bấm gửi mã để nhận mã mới.',
    });
  }
  if (ctx.nowMs >= otp.expires_at) {
    failAudit('EXPIRED');
    throw new BadRequestException({
      code: 'OTP_EXPIRED',
      message: 'Mã đã hết hạn. Bấm gửi lại để nhận mã mới.',
    });
  }
  if (otp.attempts_left <= 0) {
    failAudit('NO_ATTEMPTS_LEFT');
    throw new BadRequestException({
      code: 'OTP_TOO_MANY_ATTEMPTS',
      message: 'Bạn đã nhập sai quá nhiều lần. Bấm gửi lại để nhận mã mới.',
    });
  }
  if (!safeEqualHex(hashOtpCode(phone, input.code), otp.code_hash)) {
    await deps.decrementAttempts(otp.id);
    failAudit('WRONG_CODE');
    const remaining = otp.attempts_left - 1;
    throw new BadRequestException({
      code: remaining <= 0 ? 'OTP_TOO_MANY_ATTEMPTS' : 'OTP_INVALID',
      message:
        remaining <= 0
          ? 'Bạn đã nhập sai quá nhiều lần. Bấm gửi lại để nhận mã mới.'
          : `Mã không đúng, bạn còn ${remaining} lần thử.`,
    });
  }

  await deps.consumeOtp(otp.id, ctx.nowMs);

  // Đổi tài khoản: thu hồi phiên cũ TRƯỚC khi tạo phiên mới — thứ tự này để lỗi giữa chừng
  // nghiêng về phía "mất phiên cũ" (khách OTP lại là xong) thay vì "2 phiên cùng sống".
  if (input.currentSessionToken) {
    const oldPhone = await deps.revokeSessionByToken(input.currentSessionToken, ctx.nowMs);
    if (oldPhone !== null && oldPhone !== phone) {
      deps.audit({
        action_kind: 'public.session_switched',
        phone,
        detail: { from_phone: oldPhone },
      });
    }
  }

  const token = deps.generateSessionToken();
  const expires_at = ctx.nowMs + SESSION_TTL_MS;
  await deps.insertSession({ token, phone, expires_at, last_used_at: ctx.nowMs });
  deps.audit({ action_kind: 'public.otp_verify_ok', phone });

  return { session_token: token, phone, expires_at_ms: expires_at };
}

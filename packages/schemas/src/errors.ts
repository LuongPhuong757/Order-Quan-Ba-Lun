// P01.D-09 — Error code enum + envelope schema
// Centralized error codes used by BE (NestJS ExceptionFilter) + FE (axios interceptor + i18n)
import { z } from 'zod';

export const ErrorCode = z.enum([
  // Auth
  'AUTH_INVALID_CRED',
  'AUTH_RATE_LIMITED',
  'AUTH_TOKEN_REVOKED',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_INACTIVE_USER',
  'OWN_PASSWORD_WRONG',
  // Admin
  'ADMIN_REQUIRED',
  'RECOVERY_CODE_INVALID',
  'SETUP_ALREADY_DONE',
  'SETUP_IP_BLOCKED',
  // Generic
  'VALIDATION_FAILED',
  'CSRF_ORIGIN_MISMATCH',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
  // Public ordering (M2 phase 08)
  // ⚠ 9 code này KHÔNG được thêm vào dict FRIENDLY_VN của global-exception.filter.ts
  // (Pitfall #6, 08-RESEARCH.md) — message cần nội suy off_reason/store_phone động,
  // phải build tại chỗ throw, không lookup tĩnh.
  'ONLINE_ORDERING_DISABLED',
  'STORE_CLOSED',
  'PHONE_BLACKLISTED',
  'TOO_MANY_REQUESTS',
  'ORDER_ALREADY_OPEN_FOR_PHONE',
  'ORDER_ALREADY_CONFIRMED',
  'ORDER_TOKEN_NOT_FOUND',
  'MENU_ITEM_UNAVAILABLE',
  'NO_TABLE_AVAILABLE',
  // M2 phase 09 — duyệt/từ chối đơn online (AdminOnlineOrdersService)
  'ORDER_EMPTY_AFTER_DROP',
  'ROLE_FORBIDDEN',
  // OTP đăng nhập bằng SĐT (2026-08-05) — message build tại chỗ throw (otp.ts), cùng luật
  // Pitfall #6 với nhóm phase 08: KHÔNG thêm vào FRIENDLY_VN. Thiếu code ở enum này là FE
  // parse ErrorEnvelope FAIL → khách thấy câu "lỗi kỹ thuật" thay vì message thật (bug
  // 2026-08-05 phát hiện khi thử OTP lần đầu).
  'OTP_DISABLED',
  'OTP_NOT_FOUND',
  'OTP_EXPIRED',
  'OTP_INVALID',
  'OTP_TOO_MANY_ATTEMPTS',
  'OTP_SESSION_REQUIRED',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    request_id: z.string().uuid(),
    ts_ms: z.number().int(),
    field_errors: z
      .array(
        z.object({
          field: z.string(),
          message: z.string(),
        }),
      )
      .optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const SuccessEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    data,
  });

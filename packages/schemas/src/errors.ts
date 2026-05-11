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

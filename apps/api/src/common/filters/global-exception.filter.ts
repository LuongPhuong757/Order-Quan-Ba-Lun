// P01.D-09 — Wrap any thrown exception into error envelope
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorCode } from '@order/schemas';

type ErrorBody = {
  code?: string;
  message?: string;
  field_errors?: Array<{ field: string; message: string }>;
};

const FRIENDLY_VN: Record<string, string> = {
  AUTH_INVALID_CRED: 'Ôi, sai mật khẩu rồi. Thử lại nhé!',
  AUTH_RATE_LIMITED: 'Bạn thử đăng nhập sai nhiều quá. Đợi 15 phút rồi thử lại nhé.',
  AUTH_TOKEN_REVOKED: 'Phiên đăng nhập đã hết hiệu lực, vui lòng đăng nhập lại.',
  AUTH_TOKEN_EXPIRED: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
  AUTH_INACTIVE_USER: 'Tài khoản đã bị vô hiệu hoá. Liên hệ chủ quán nhé.',
  OWN_PASSWORD_WRONG: 'Mật khẩu cũ không đúng. Thử lại nhé!',
  ADMIN_REQUIRED: 'Chỉ chủ quán mới làm được việc này.',
  RECOVERY_CODE_INVALID: 'Mã khôi phục không đúng hoặc đã dùng rồi.',
  SETUP_ALREADY_DONE: 'Hệ thống đã được khởi tạo. Hãy đăng nhập.',
  SETUP_IP_BLOCKED: 'Setup chỉ truy cập được từ IP đã được phép.',
  VALIDATION_FAILED: 'Dữ liệu thiếu hoặc sai định dạng, bạn kiểm tra lại nhé.',
  CSRF_ORIGIN_MISMATCH: 'Yêu cầu không hợp lệ. Vui lòng tải lại trang.',
  NOT_FOUND: 'Không tìm thấy.',
  CONFLICT: 'Dữ liệu xung đột.',
  INTERNAL_ERROR: 'Có lỗi xảy ra, thử lại sau ít phút nhé.',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let fieldErrors: Array<{ field: string; message: string }> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'string') {
        message = r;
        code = mapStatusToCode(status);
      } else if (typeof r === 'object' && r !== null) {
        const body = r as ErrorBody & Record<string, unknown>;
        code = body.code || mapStatusToCode(status);
        message = body.message || (FRIENDLY_VN[code] ?? 'Lỗi không xác định');
        fieldErrors = body.field_errors;
        // class-validator dumps message as string[] — convert to field_errors
        if (Array.isArray((body as Record<string, unknown>).message) && status === 422) {
          fieldErrors = ((body as Record<string, unknown>).message as string[]).map((m) => ({
            field: 'unknown',
            message: m,
          }));
          message = FRIENDLY_VN.VALIDATION_FAILED;
          code = 'VALIDATION_FAILED';
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.stack);
    }

    // Friendly VN override (P01.D-18)
    if (FRIENDLY_VN[code]) message = FRIENDLY_VN[code];

    res.status(status).json({
      error: {
        code: code as ErrorCode,
        message,
        request_id: req.request_id || 'unknown',
        ts_ms: Date.now(),
        field_errors: fieldErrors,
      },
    });
  }
}

function mapStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'AUTH_INVALID_CRED';
    case 403:
      return 'ADMIN_REQUIRED';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'AUTH_RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}

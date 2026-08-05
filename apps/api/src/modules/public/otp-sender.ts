import { Injectable, Logger } from '@nestjs/common';

// Kênh gửi mã OTP (2026-08-04) — interface cắm được, chốt với chủ dự án: "mock trước,
// chọn kênh sau". Khi đăng ký xong Zalo ZNS / SMS brandname thì viết class mới implement
// `OtpSender` và đổi `useClass` ở `public.module.ts` — KHÔNG sửa luồng request/verify.

export const OTP_SENDER = 'OTP_SENDER';

export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/**
 * Bản mock: ghi mã ra log server thay vì gửi tin thật.
 *
 * ⚠ Vì kênh thật chưa có, toàn bộ luồng OTP nằm sau công tắc `otp_login_enabled`
 * (mặc định TẮT). Bật công tắc khi đang dùng sender này = khách thật không nhận được mã
 * = không ai đặt được đơn — chỉ bật để thử nghiệm (đọc mã trong log, hoặc đặt env
 * `OTP_MOCK_CODE` để mã luôn cố định, xem `PublicOtpService`).
 */
@Injectable()
export class LogOtpSender implements OtpSender {
  private readonly logger = new Logger(LogOtpSender.name);

  async send(phone: string, code: string): Promise<void> {
    // Mã OTP là bí mật ngắn hạn (5 phút, 5 lượt thử) — chấp nhận nằm trong log server để
    // dev/chủ quán thử luồng; sender thật sau này KHÔNG được log mã.
    this.logger.log(`[OTP MOCK] Gửi mã ${code} tới ${phone} (hết hạn sau 5 phút)`);
  }
}

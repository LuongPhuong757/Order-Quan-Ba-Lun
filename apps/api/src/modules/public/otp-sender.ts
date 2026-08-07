import { Injectable, Logger } from '@nestjs/common';

// Kênh gửi mã OTP (2026-08-04) — interface cắm được, chốt với chủ dự án: "mock trước,
// chọn kênh sau".
//
// 2026-08-06: kênh thật đã có — `SmsOtpSender` (eSMS, đầu số cố định). Chọn kênh bằng env
// `OTP_CHANNEL` ở `public.module.ts`, KHÔNG sửa luồng request/verify.

export const OTP_SENDER = 'OTP_SENDER';

export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

/**
 * Bản mock: ghi mã ra log server thay vì gửi tin thật. Là kênh MẶC ĐỊNH (`OTP_CHANNEL` khác
 * `sms`) — fail-safe: thà không gửi còn hơn âm thầm đốt tiền tin nhắn khi cấu hình sai.
 *
 * ⚠ Bật `otp_login_enabled` mà vẫn để sender này = khách thật không nhận được mã = không ai
 * đăng nhập được — chỉ bật để thử nghiệm (đọc mã trong log, hoặc đặt env `OTP_MOCK_CODE` để
 * mã luôn cố định, xem `PublicOtpService`). Chạy thật thì đặt `OTP_CHANNEL=sms`.
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

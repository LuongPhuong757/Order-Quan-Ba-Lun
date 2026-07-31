// Driver mặc định khi quán chưa có brandname đã duyệt (M2.D-63) — chỉ ghi log, không gọi
// mạng. Dùng ở local/dev và làm fallback an toàn nếu SMS_DRIVER đọc giá trị lạ
// (notifications.module.ts).
import { Injectable, Logger, Optional } from '@nestjs/common';
import { isValidSmsRecipient, SMS_MAX_LENGTH, type SmsChannel } from './sms-channel.js';

@Injectable()
export class ConsoleSmsChannel implements SmsChannel {
  readonly name = 'console';
  private readonly nestLogger = new Logger(ConsoleSmsChannel.name);

  // `loggerFn` chỉ dùng để contract test bơm 1 hàm giả throw được (kiểm exception bên trong
  // không làm sập poller) — production luôn dùng Nest Logger thật (không truyền tham số này).
  constructor(@Optional() private readonly loggerFn?: (line: string) => void) {}

  async send(msg: { to: string; message: string }): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      if (!isValidSmsRecipient(msg.to)) {
        return { ok: false, error: 'Số điện thoại người nhận không hợp lệ' };
      }
      const trimmed = msg.message.length > SMS_MAX_LENGTH ? msg.message.slice(0, SMS_MAX_LENGTH) : msg.message;
      const line = `[SMS:console] → ${msg.to}: ${trimmed}`;
      if (this.loggerFn) {
        this.loggerFn(line);
      } else {
        this.nestLogger.log(line);
      }
      return { ok: true };
    } catch (err) {
      // Channel KHÔNG BAO GIỜ throw ra ngoài — poller phải còn sống để xử lý hàng kế tiếp.
      return { ok: false, error: `Gửi SMS console thất bại: ${(err as Error).message}` };
    }
  }
}

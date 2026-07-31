// M2.D-38: Email CHỈ dùng cho tổng hợp cuối ngày (job 23:30 là phase 10), KHÔNG dùng cho
// đơn mới. Ở phase 9, EmailChannel chỉ cần tồn tại đúng interface và ghi log — hàng L3
// trong outbox tồn tại để phase 10 có sẵn đường ống, không phải để bắn email đơn mới ngay.
import { Injectable, Logger } from '@nestjs/common';

export interface EmailChannel {
  readonly name: string;
  send(msg: { to: string; subject: string; body: string }): Promise<{ ok: true } | { ok: false; error: string }>;
}

@Injectable()
export class ConsoleEmailChannel implements EmailChannel {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleEmailChannel.name);

  async send(msg: { to: string; subject: string; body: string }): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      this.logger.log(`[EMAIL:console] → ${msg.to} | ${msg.subject}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Gửi email console thất bại: ${(err as Error).message}` };
    }
  }
}

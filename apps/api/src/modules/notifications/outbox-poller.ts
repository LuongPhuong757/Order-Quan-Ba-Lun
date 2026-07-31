// Poller in-process (D-19) — quét `notification_outbox` mỗi 15s bằng `@nestjs/schedule` +
// Nest DI, cùng khuôn mẫu `MaintenanceCronService` (plan 09-02). KHÔNG mở `DataSource` thứ
// hai — mọi truy vấn đi qua `NotificationOutboxService` (đã dùng `@InjectDataSource()`).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { NotificationOutbox } from './entities/notification-outbox.entity.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { ConsoleEmailChannel } from './channels/email-channel.js';
import { buildEscalationSms, SMS_CHANNEL, type SmsChannel } from './channels/sms-channel.js';

@Injectable()
export class OutboxPoller {
  private readonly logger = new Logger(OutboxPoller.name);
  private running = false;

  constructor(
    private readonly outbox: NotificationOutboxService,
    @Inject(SMS_CHANNEL) private readonly smsChannel: SmsChannel,
    private readonly emailChannel: ConsoleEmailChannel,
  ) {}

  // D-19: mỗi 15s.
  @Cron('*/15 * * * * *')
  async tick(): Promise<void> {
    // Chống chồng lấn: 1 tick gọi mạng (eSMS) có thể lâu hơn 15s; không có guard này thì 2
    // tick cùng dispatch. Kết hợp với `SKIP LOCKED` ở `claimDue` là đủ cho triển khai
    // in-process 1 container (D-19 chốt in-process). Nếu sau này scale nhiều instance thì
    // `SKIP LOCKED` là lớp bảo vệ chính, guard này chỉ là lớp thứ hai.
    if (this.running) {
      this.logger.debug('outbox-poller: tick trước chưa xong, bỏ qua tick này');
      return;
    }
    this.running = true;
    try {
      const nowMs = Date.now();
      const rows = await this.outbox.claimDue(nowMs, 20);
      if (rows.length === 0) return; // tick rỗng không log — 4 tick/phút x 24h là quá nhiều

      const pendingSmsCount = await this.outbox.pendingSmsCount(nowMs);
      for (const row of rows) {
        await this.dispatchOne(row, nowMs, pendingSmsCount);
      }
      this.logger.log(`outbox-poller: đã xử lý ${rows.length} hàng`);
    } catch (err) {
      // tick() KHÔNG BAO GIỜ throw ra ngoài (khuôn AuditEventHandler) — 1 lỗi không được
      // làm chết @Cron, các tick sau vẫn phải chạy.
      this.logger.error(`outbox-poller tick failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }

  private async dispatchOne(row: NotificationOutbox, nowMs: number, pendingSmsCount: number): Promise<void> {
    try {
      if (row.channel === 'SSE') {
        // Event SSE thật đã emit ngay lúc submit (plan 09-09) — hàng L1 chỉ tồn tại để
        // audit "đã có thông báo tức thời". KHÔNG gửi lại gì ở đây; người sau đọc dòng
        // này đừng nghĩ SSE đang bị bỏ sót.
        await this.outbox.markSent(row.id, nowMs);
        return;
      }

      if (row.channel === 'SMS') {
        const waitingSeconds = Math.max(0, Math.round((nowMs - row.created_at) / 1000));
        const message = buildEscalationSms({ waitingSeconds, pendingCount: pendingSmsCount });
        const result = await this.smsChannel.send({ to: row.recipient, message });
        if (result.ok) {
          await this.outbox.markSent(row.id, nowMs);
        } else {
          await this.outbox.markFailed(row.id, row.attempts, result.error);
        }
        return;
      }

      if (row.channel === 'EMAIL') {
        // Phase 9 chỉ log — M2.D-38 (email chỉ dùng cho tổng hợp cuối ngày, phase 10 mới
        // dùng hàng L3 này để gửi thật).
        const result = await this.emailChannel.send({
          to: row.recipient,
          subject: 'Thông báo đơn online mới',
          body: `Có đơn online mới cần duyệt (request_id=${row.request_id}).`,
        });
        if (result.ok) {
          await this.outbox.markSent(row.id, nowMs);
        } else {
          await this.outbox.markFailed(row.id, row.attempts, result.error);
        }
      }
    } catch (err) {
      // 1 hàng lỗi không được kéo cả tick xuống — bắt lỗi ở mức từng hàng.
      await this.outbox.markFailed(row.id, row.attempts, (err as Error).message);
    }
  }
}

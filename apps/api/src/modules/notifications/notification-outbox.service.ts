// Tầng đọc/ghi duy nhất của bảng `notification_outbox` (§4.6) — người ghi (enqueue lúc
// submit, cancel lúc duyệt/từ chối) và người đọc (claimDue cho poller, Task 3).
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { SettingsService } from '../settings/settings.service.js';
import type { StoreSettingsMap } from '../settings/settings.defaults.js';
import { NotificationOutbox } from './entities/notification-outbox.entity.js';
import { nextAttemptDecision, planOutboxRows } from './outbox-rules.js';

const LAST_ERROR_MAX_LENGTH = 500;

@Injectable()
export class NotificationOutboxService {
  private readonly logger = new Logger(NotificationOutboxService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settingsSvc: SettingsService,
  ) {}

  /**
   * Xếp hàng L1(SSE)/L2(SMS)/L3(EMAIL) ngay lúc submit đơn (đọc ngưỡng leo thang SMS từ
   * settings). Nhận `mgr` tuỳ chọn để plan 09-09 gọi BÊN TRONG transaction submit — outbox
   * pattern: hàng thông báo và hàng đơn cùng commit hoặc cùng rollback, không được có đơn
   * mà không có lịch SMS.
   *
   * ⚠ 2026-08-07 — `settings` nay TRUYỀN VÀO được. Khi gọi từ trong transaction thì người gọi
   * PHẢI truyền, vì `settingsSvc.readAll()` ở đây là xin connection thứ hai giữa lúc đang giữ
   * transaction — chính xác thứ đã treo cứng cả process khi 100 khách đặt cùng lúc. Nhận `mgr`
   * mà vẫn tự đọc settings là "đúng một nửa", và nửa sai mới là nửa giết hệ thống. Xem
   * "QUY TẮC 1 CONNECTION" ở `PublicOrdersService.submit()`.
   */
  async enqueueForNewRequest(
    requestId: string,
    nowMs: number,
    mgr?: EntityManager,
    presetSettings?: Pick<
      StoreSettingsMap,
      'escalate_sms_after_s' | 'notify_sms_recipients' | 'notify_email_recipients'
    >,
  ): Promise<void> {
    const settings = presetSettings ?? (await this.settingsSvc.readAll());
    const rows = planOutboxRows({
      requestId,
      nowMs,
      escalateSmsAfterS: settings.escalate_sms_after_s,
      smsRecipients: settings.notify_sms_recipients,
      emailRecipients: settings.notify_email_recipients,
    });
    if (rows.length === 0) return;
    const runner = mgr ?? this.ds.manager;
    await runner.getRepository(NotificationOutbox).insert(
      rows.map((r) => ({
        id: randomUUID(),
        request_id: r.request_id,
        channel: r.channel,
        recipient: r.recipient,
        level: r.level,
        status: r.status,
        attempts: r.attempts,
        last_error: r.last_error,
        scheduled_at: r.scheduled_at,
        sent_at: r.sent_at,
      })),
    );
  }

  /**
   * Huỷ mọi hàng còn PENDING của 1 request khi confirm/reject kịp trước ngưỡng (spec §7
   * dòng 489). Giữ dòng CANCELLED thay vì xoá để còn chứng minh được "đã duyệt kịp nên
   * không bắn SMS".
   */
  async cancelPendingForRequest(requestId: string, mgr?: EntityManager): Promise<number> {
    const runner = mgr ?? this.ds.manager;
    const result: { affectedRows?: number } = await runner.query(
      `UPDATE notification_outbox SET status = 'CANCELLED' WHERE request_id = ? AND status = 'PENDING'`,
      [requestId],
    );
    return result.affectedRows ?? 0;
  }

  /**
   * Lấy các hàng PENDING đến hạn trong 1 transaction NGẮN: `SELECT id ... FOR UPDATE SKIP
   * LOCKED` để 2 tick chồng nhau (hoặc nhiều instance) không lấy trùng hàng, rồi tăng
   * `attempts` cùng transaction. KHÔNG giữ transaction mở trong lúc gọi mạng — dispatch nằm
   * ngoài, ở poller (Task 3).
   */
  async claimDue(nowMs: number, limit: number): Promise<NotificationOutbox[]> {
    return this.ds.transaction(async (txMgr) => {
      const idRows: Array<{ id: string }> = await txMgr.query(
        `SELECT id FROM notification_outbox WHERE status = 'PENDING' AND scheduled_at <= ? ` +
          `ORDER BY scheduled_at ASC LIMIT ? FOR UPDATE SKIP LOCKED`,
        [new Date(nowMs), limit],
      );
      if (idRows.length === 0) return [];
      const ids = idRows.map((r) => r.id);
      await txMgr
        .createQueryBuilder()
        .update(NotificationOutbox)
        .set({ attempts: () => 'attempts + 1' })
        .where('id IN (:...ids)', { ids })
        .execute();
      // Đọc lại trong CÙNG transaction — thấy ngay giá trị attempts vừa tăng.
      return txMgr.getRepository(NotificationOutbox).find({ where: { id: In(ids) } });
    });
  }

  /** Đánh dấu 1 hàng gửi thành công. */
  async markSent(id: string, nowMs: number): Promise<void> {
    const { status } = nextAttemptDecision({ ok: true, attempts: 0 });
    await this.ds.getRepository(NotificationOutbox).update(id, { status, sent_at: nowMs });
  }

  /** Đánh dấu 1 hàng gửi thất bại — PENDING (còn thử lại) hoặc FAILED (đã hết lượt). */
  async markFailed(id: string, attempts: number, error: string): Promise<void> {
    const { status } = nextAttemptDecision({ ok: false, attempts });
    const last_error = error.length > LAST_ERROR_MAX_LENGTH ? error.slice(0, LAST_ERROR_MAX_LENGTH) : error;
    await this.ds.getRepository(NotificationOutbox).update(id, { status, last_error });
  }

  /** Số hàng L2/SMS đang PENDING đã tới hạn — dùng cho nội dung SMS (buildEscalationSms.pendingCount). */
  async pendingSmsCount(nowMs: number): Promise<number> {
    const rows: Array<{ cnt: string | number }> = await this.ds.query(
      `SELECT COUNT(*) AS cnt FROM notification_outbox WHERE channel = 'SMS' AND status = 'PENDING' AND scheduled_at <= ?`,
      [new Date(nowMs)],
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}

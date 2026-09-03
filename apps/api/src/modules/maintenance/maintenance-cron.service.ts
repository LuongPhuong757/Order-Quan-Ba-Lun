// C-CRON-01 — hồi sinh 2 cron đang chết (`src/cli/cron-audit-retention.ts`,
// `src/cli/cron-jti-cleanup.ts`) thành @Cron chạy thật trong process API. Trước phase 9,
// 2 file này là CLI script không entry nào trong docker-compose*.yml gọi tới — có code
// nhưng không bao giờ chạy.
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  analyticsRetentionCutoffMs,
  auditRetentionCutoffMs,
  cartSnapshotRetentionCutoffMs,
  pruneAuditLogs,
  pruneCartSnapshots,
  pruneOrderActivityLogs,
  pruneGeoShareDaily,
  prunePageViewDaily,
  pruneRevokedJti,
  pruneVisitSessions,
} from './retention-queries.js';

@Injectable()
export class MaintenanceCronService {
  private readonly logger = new Logger(MaintenanceCronService.name);

  // ⚠ Dùng @InjectDataSource() của Nest (connection pool có sẵn) — TUYỆT ĐỐI KHÔNG tự
  // gọi `.initialize()`/`.destroy()` trên 1 DataSource riêng ở đây. Đó là pattern của
  // CLI script (`src/cli/cron-*.ts`); dùng lại trong process HTTP server sẽ tạo dual
  // DataSource lifecycle (Anti-Pattern đã ghi ở ARCHITECTURE.md / RESEARCH.md phase 9).
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // Retention dọn dữ liệu giữ 90 ngày (mặc định, đọc từ env) → 1 lần/ngày lúc quán đóng
  // cửa (3h sáng) là đủ, không cần chạy dày hơn. Discretion đã chốt tại plan 09-02
  // (RESEARCH Assumption A3 không chốt tần suất).
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async auditRetention(): Promise<void> {
    try {
      const cutoffDays = Number(process.env.AUDIT_RETENTION_DAYS ?? 90);
      const cutoffMs = auditRetentionCutoffMs(Date.now(), cutoffDays);
      const audit = await pruneAuditLogs(this.ds.manager, cutoffMs);
      const activity = await pruneOrderActivityLogs(this.ds.manager, cutoffMs);
      this.logger.log(
        `cron-audit-retention: xoá ${audit.deleted_rows} audit_log + ` +
          `${activity.deleted_rows} order_activity_logs (cutoffDays=${cutoffDays}, cutoff_ts_ms=${cutoffMs})`,
      );
    } catch (err) {
      // Job lỗi KHÔNG được làm sập app — nuốt lỗi, chỉ log (khuôn AuditEventHandler).
      this.logger.error(
        `cron-audit-retention failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  // Dọn số liệu truy cập (2026-08-05) — cùng nhịp 3h sáng với audit: cả hai đều là DELETE
  // theo khoảng, chạy lúc quán đóng cửa để không tranh I/O với giờ bán hàng.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async analyticsRetention(): Promise<void> {
    try {
      const cutoffDays = Number(process.env.ANALYTICS_RETENTION_DAYS ?? 90);
      const cutoffMs = analyticsRetentionCutoffMs(Date.now(), cutoffDays);
      const sessions = await pruneVisitSessions(this.ds.manager, cutoffMs);
      const pageViews = await prunePageViewDaily(this.ds.manager, cutoffMs);
      const geoShare = await pruneGeoShareDaily(this.ds.manager, cutoffMs);
      // Ảnh chụp giỏ hàng dùng mốc RIÊNG, ngắn hơn nhiều — xem docblock
      // `cartSnapshotRetentionCutoffMs`. Nằm cùng job này (không thêm @Cron thứ tư) vì cùng
      // một nhịp 3h sáng và cùng một loại việc.
      const cartDays = Number(process.env.CART_SNAPSHOT_RETENTION_DAYS ?? 7);
      const carts = await pruneCartSnapshots(
        this.ds.manager,
        cartSnapshotRetentionCutoffMs(Date.now(), cartDays),
      );
      this.logger.log(
        `cron-analytics-retention: xoá ${sessions.deleted_rows} web_visit_sessions + ` +
          `${pageViews.deleted_rows} web_page_views_daily + ` +
          `${geoShare.deleted_rows} geo_share_daily (cutoffDays=${cutoffDays}, cutoff_ms=${cutoffMs})` +
          ` + ${carts.deleted_rows} web_cart_snapshots (cutoffDays=${cartDays})`,
      );
    } catch (err) {
      this.logger.error(
        `cron-analytics-retention failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  // JTI hết hạn tích luỹ theo phiên đăng nhập nên 1 lần/giờ là đủ, bảng nhỏ nên rẻ.
  @Cron(CronExpression.EVERY_HOUR)
  async jtiCleanup(): Promise<void> {
    try {
      const now = Date.now();
      const result = await pruneRevokedJti(this.ds.manager, now);
      this.logger.log(`cron-jti-cleanup: xoá ${result.deleted_rows} revoked_jwt_jti (now=${now})`);
    } catch (err) {
      this.logger.error(`cron-jti-cleanup failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }
}

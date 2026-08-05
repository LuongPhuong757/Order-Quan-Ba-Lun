// Logic gốc ở `src/cli/cron-audit-retention.ts` và `src/cli/cron-jti-cleanup.ts` — plan
// 09-02 chỉ NỐI DÂY lại, không đổi điều kiện xoá. Sửa số ngày giữ log là quyết định vận
// hành, phải sửa cả 2 nơi hoặc bỏ hẳn file CLI.
//
// Module thuần: `nowMs`/`cutoffMs` LUÔN là tham số, không tự đọc Date.now() bên trong, để
// test được không cần fake timer (khuôn store-status.ts).
//
// ⚠ 2 cột khác kiểu — đừng "thống nhất" lại, sẽ xoá sai:
// `audit_log.ts_ms` là số epoch ms; `order_activity_logs.created_at` là cột `datetime`
// (so sánh bằng `Date`, không phải số).
import type { EntityManager } from 'typeorm';
import { AuditLog } from '../audit/entities/audit-log.entity.js';
import { OrderActivityLog } from '../orders/entities/order-activity-log.entity.js';
import { RevokedJti } from '../auth/entities/revoked-jti.entity.js';
import { WebVisitSession } from '../analytics/entities/web-visit-session.entity.js';
import { WebPageViewDaily } from '../analytics/entities/web-page-view-daily.entity.js';
import { dayKeyIct } from '../analytics/visit-hit.js';

export function auditRetentionCutoffMs(nowMs: number, cutoffDays: number): number {
  return nowMs - cutoffDays * 86_400_000;
}

export async function pruneAuditLogs(
  mgr: EntityManager,
  cutoffMs: number,
): Promise<{ deleted_rows: number }> {
  const result = await mgr
    .getRepository(AuditLog)
    .createQueryBuilder()
    .delete()
    .from(AuditLog)
    .where('ts_ms < :c', { c: cutoffMs })
    .execute();
  return { deleted_rows: result.affected ?? 0 };
}

export async function pruneOrderActivityLogs(
  mgr: EntityManager,
  cutoffMs: number,
): Promise<{ deleted_rows: number }> {
  const result = await mgr
    .getRepository(OrderActivityLog)
    .createQueryBuilder()
    .delete()
    .from(OrderActivityLog)
    .where('created_at < :c', { c: new Date(cutoffMs) })
    .execute();
  return { deleted_rows: result.affected ?? 0 };
}

export async function pruneRevokedJti(
  mgr: EntityManager,
  nowMs: number,
): Promise<{ deleted_rows: number }> {
  const result = await mgr
    .getRepository(RevokedJti)
    .createQueryBuilder()
    .delete()
    .from(RevokedJti)
    .where('expires_at_ms < :n', { n: nowMs })
    .execute();
  return { deleted_rows: result.affected ?? 0 };
}

// Thống kê truy cập (2026-08-05). Cùng mốc 90 ngày với audit nhưng biến môi trường RIÊNG
// (`ANALYTICS_RETENTION_DAYS`): số liệu marketing và vết truy trách nhiệm là hai nhu cầu khác
// nhau — chủ quán có thể muốn giữ traffic 1 năm mà vẫn dọn audit sau 90 ngày.
//
// ⚠ Xoá theo `last_seen_ms` (mốc ping CUỐI của phiên), không theo `first_seen_ms`: một phiên mở
// tab từ trước nửa đêm nhưng còn hoạt động sau đó vẫn phải sống đủ vòng đời của nó.

export function analyticsRetentionCutoffMs(nowMs: number, cutoffDays: number): number {
  return nowMs - cutoffDays * 86_400_000;
}

export async function pruneVisitSessions(
  mgr: EntityManager,
  cutoffMs: number,
): Promise<{ deleted_rows: number }> {
  const result = await mgr
    .getRepository(WebVisitSession)
    .createQueryBuilder()
    .delete()
    .from(WebVisitSession)
    .where('last_seen_ms < :c', { c: cutoffMs })
    .execute();
  return { deleted_rows: result.affected ?? 0 };
}

/** `day_key` là chuỗi 'YYYY-MM-DD' nên so sánh CHUỖI là đúng (ISO tự sắp thứ tự theo thời gian). */
export async function prunePageViewDaily(
  mgr: EntityManager,
  cutoffMs: number,
): Promise<{ deleted_rows: number }> {
  const result = await mgr
    .getRepository(WebPageViewDaily)
    .createQueryBuilder()
    .delete()
    .from(WebPageViewDaily)
    .where('day_key < :c', { c: dayKeyIct(cutoffMs) })
    .execute();
  return { deleted_rows: result.affected ?? 0 };
}

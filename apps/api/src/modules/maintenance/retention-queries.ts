// Logic gốc ở `src/cli/cron-audit-retention.ts` và `src/cli/cron-jti-cleanup.ts` — plan
// 09-02 chỉ NỐI DÂY lại, không đổi điều kiện xoá. Sửa số ngày giữ log là quyết định vận
// hành, phải sửa cả 2 nơi hoặc bỏ hẳn file CLI.
//
// Module thuần: `nowMs`/`cutoffMs` LUÔN là tham số, không tự đọc Date.now() bên trong, để
// test được không cần fake timer (khuôn store-status.ts).
import type { EntityManager } from 'typeorm';

// RED (task 2, TDD): stub tạm — chưa đúng logic, test phải đỏ trước khi cắm GREEN.
export function auditRetentionCutoffMs(_nowMs: number, _cutoffDays: number): number {
  return 0;
}

export async function pruneAuditLogs(
  _mgr: EntityManager,
  _cutoffMs: number,
): Promise<{ deleted_rows: number }> {
  return { deleted_rows: -1 };
}

export async function pruneOrderActivityLogs(
  _mgr: EntityManager,
  _cutoffMs: number,
): Promise<{ deleted_rows: number }> {
  return { deleted_rows: -1 };
}

export async function pruneRevokedJti(
  _mgr: EntityManager,
  _nowMs: number,
): Promise<{ deleted_rows: number }> {
  return { deleted_rows: -1 };
}

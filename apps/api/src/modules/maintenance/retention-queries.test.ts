import { describe, expect, it } from 'vitest';
import type { EntityManager } from 'typeorm';
import {
  analyticsRetentionCutoffMs,
  auditRetentionCutoffMs,
  pruneAuditLogs,
  pruneOrderActivityLogs,
  prunePageViewDaily,
  pruneRevokedJti,
  pruneVisitSessions,
} from './retention-queries.js';

// Fake EntityManager: `getRepository()` trả 1 query builder giả ghi lại điều kiện `where`
// và trả `affected` tự chọn — không cần MySQL, test hàm thuần đúng khuôn store-status.test.ts.
function makeFakeManager(
  captured: { column?: string; value?: unknown },
  affected: number | undefined,
): EntityManager {
  const qb = {
    delete() {
      return qb;
    },
    from() {
      return qb;
    },
    where(whereClause: string, params: Record<string, unknown>) {
      const [key] = Object.keys(params);
      captured.column = whereClause;
      captured.value = params[key];
      return qb;
    },
    async execute() {
      return { affected };
    },
  };
  return {
    getRepository() {
      return { createQueryBuilder: () => qb };
    },
  } as unknown as EntityManager;
}

describe('auditRetentionCutoffMs', () => {
  it('mặc định 90 ngày: nowMs - 90 * 86_400_000', () => {
    const nowMs = Date.now();
    expect(auditRetentionCutoffMs(nowMs, 90)).toBe(nowMs - 90 * 86_400_000);
  });

  it('đổi được số ngày, không hardcode 90', () => {
    const nowMs = Date.now();
    expect(auditRetentionCutoffMs(nowMs, 1)).toBe(nowMs - 86_400_000);
  });

  it('không tự đọc Date.now() bên trong — gọi 2 lần cùng nowMs cho cùng kết quả', () => {
    const nowMs = 1_700_000_000_000;
    expect(auditRetentionCutoffMs(nowMs, 90)).toBe(auditRetentionCutoffMs(nowMs, 90));
  });
});

describe('pruneAuditLogs', () => {
  it('dùng điều kiện trên cột ts_ms với giá trị SỐ = cutoff ms', async () => {
    const captured: { column?: string; value?: unknown } = {};
    const mgr = makeFakeManager(captured, 7);
    const result = await pruneAuditLogs(mgr, 12345);
    expect(captured.column).toContain('ts_ms');
    expect(captured.value).toBe(12345);
    expect(typeof captured.value).toBe('number');
    expect(result.deleted_rows).toBe(7);
  });

  it('affected undefined → 0, không NaN', async () => {
    const mgr = makeFakeManager({}, undefined);
    const result = await pruneAuditLogs(mgr, 12345);
    expect(result.deleted_rows).toBe(0);
    expect(Number.isNaN(result.deleted_rows)).toBe(false);
  });
});

describe('pruneOrderActivityLogs', () => {
  it('dùng điều kiện trên cột created_at với giá trị Date = new Date(cutoff)', async () => {
    const captured: { column?: string; value?: unknown } = {};
    const mgr = makeFakeManager(captured, 3);
    const result = await pruneOrderActivityLogs(mgr, 99999);
    expect(captured.column).toContain('created_at');
    expect(captured.value).toEqual(new Date(99999));
    expect(result.deleted_rows).toBe(3);
  });

  it('affected undefined → 0, không NaN', async () => {
    const mgr = makeFakeManager({}, undefined);
    const result = await pruneOrderActivityLogs(mgr, 99999);
    expect(result.deleted_rows).toBe(0);
  });
});

describe('pruneRevokedJti', () => {
  it('dùng điều kiện trên expires_at_ms với giá trị SỐ = nowMs', async () => {
    const captured: { column?: string; value?: unknown } = {};
    const mgr = makeFakeManager(captured, 5);
    const result = await pruneRevokedJti(mgr, 55555);
    expect(captured.column).toContain('expires_at_ms');
    expect(captured.value).toBe(55555);
    expect(typeof captured.value).toBe('number');
    expect(result.deleted_rows).toBe(5);
  });

  it('affected undefined → 0, không NaN', async () => {
    const mgr = makeFakeManager({}, undefined);
    const result = await pruneRevokedJti(mgr, 55555);
    expect(result.deleted_rows).toBe(0);
  });
});

describe('analyticsRetentionCutoffMs', () => {
  it('mặc định 90 ngày, và đổi được số ngày', () => {
    const nowMs = 1_700_000_000_000;
    expect(analyticsRetentionCutoffMs(nowMs, 90)).toBe(nowMs - 90 * 86_400_000);
    expect(analyticsRetentionCutoffMs(nowMs, 365)).toBe(nowMs - 365 * 86_400_000);
  });

  it('mốc RIÊNG với audit: cùng nowMs, khác cutoffDays thì khác kết quả', () => {
    // Hai job dùng 2 biến môi trường khác nhau — test này khoá lại việc ai đó "gọn hoá" bằng
    // cách cho analyticsRetention gọi auditRetentionCutoffMs với hằng số 90 cứng.
    const nowMs = 1_700_000_000_000;
    expect(analyticsRetentionCutoffMs(nowMs, 365)).not.toBe(auditRetentionCutoffMs(nowMs, 90));
  });
});

describe('pruneVisitSessions', () => {
  it('xoá theo last_seen_ms, KHÔNG theo first_seen_ms', async () => {
    // Phiên mở tab từ lâu nhưng còn hoạt động gần đây phải sống đủ vòng đời của nó —
    // xem cảnh báo ở retention-queries.ts.
    const captured: { column?: string; value?: unknown } = {};
    const mgr = makeFakeManager(captured, 42);
    const result = await pruneVisitSessions(mgr, 12345);
    expect(captured.column).toContain('last_seen_ms');
    expect(captured.column).not.toContain('first_seen_ms');
    expect(captured.value).toBe(12345);
    expect(typeof captured.value).toBe('number');
    expect(result.deleted_rows).toBe(42);
  });

  it('affected undefined → 0, không NaN', async () => {
    const mgr = makeFakeManager({}, undefined);
    const result = await pruneVisitSessions(mgr, 12345);
    expect(result.deleted_rows).toBe(0);
    expect(Number.isNaN(result.deleted_rows)).toBe(false);
  });
});

describe('prunePageViewDaily', () => {
  it('so sánh day_key bằng CHUỖI "YYYY-MM-DD" giờ VN, không phải epoch ms', async () => {
    const captured: { column?: string; value?: unknown } = {};
    const mgr = makeFakeManager(captured, 8);
    // 10:00 ICT 2026-07-29 (= 03:00 UTC) → ngày VN là 2026-07-29.
    const result = await prunePageViewDaily(mgr, Date.parse('2026-07-29T03:00:00Z'));
    expect(captured.column).toContain('day_key');
    expect(captured.value).toBe('2026-07-29');
    expect(typeof captured.value).toBe('string');
    expect(result.deleted_rows).toBe(8);
  });

  it('cutoff 00:30 ICT lấy ngày VN, không lấy ngày UTC của hôm trước', async () => {
    // 00:30 ICT ngày 30 = 17:30 UTC ngày 29 — nếu quy ngày theo UTC thì job xoá THIẾU một ngày.
    const captured: { column?: string; value?: unknown } = {};
    const mgr = makeFakeManager(captured, 0);
    await prunePageViewDaily(mgr, Date.parse('2026-07-29T17:30:00Z'));
    expect(captured.value).toBe('2026-07-30');
  });

  it('affected undefined → 0, không NaN', async () => {
    const mgr = makeFakeManager({}, undefined);
    const result = await prunePageViewDaily(mgr, Date.parse('2026-07-29T03:00:00Z'));
    expect(result.deleted_rows).toBe(0);
  });
});

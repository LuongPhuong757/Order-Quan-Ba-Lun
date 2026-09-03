// Phép gộp của `geoShareStats` (2026-08-30). Không cần MySQL: chỉ giả `ds.query` trả về đúng thứ
// câu SQL `GROUP BY outcome` trả, rồi soi phần tính toán phía trên nó.
//
// Ba thứ dễ sai mà không ai thấy cho tới khi đọc sai số liệu:
//   1. `failed` = tổng TRỪ ok, chứ không phải cộng tay 4 nhãn hỏng — thêm một mã lỗi mới mà quên
//      cộng vào là con số hỏng lặng lẽ thiếu đi.
//   2. `failed_pct = null` khi chưa có lượt nào, KHÁC 0%.
//   3. Bảng chỉ có dòng 'ok' → 0% hỏng, không phải null.
import { describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { geoShareStats, rangeForDays } from './analytics-queries.js';

const NOW = Date.parse('2026-08-30T05:00:00Z'); // 12:00 ICT 30/8

function fakeDs(rows: Array<{ outcome: string; hits: number }>): DataSource {
  return { async query() { return rows; } } as unknown as DataSource;
}

describe('geoShareStats', () => {
  it('gộp ok / hỏng và tính % hỏng', async () => {
    const stats = await geoShareStats(
      fakeDs([
        { outcome: 'ok', hits: 70 },
        { outcome: 'denied', hits: 20 },
        { outcome: 'timeout', hits: 10 },
      ]),
      rangeForDays(NOW, 7),
      NOW,
    );
    expect(stats.ok).toBe(70);
    expect(stats.failed).toBe(30);
    expect(stats.total).toBe(100);
    expect(stats.failed_pct).toBe(30);
  });

  it('mã lỗi LẠ vẫn được tính là hỏng — `failed` là tổng trừ ok, không phải cộng tay từng nhãn', async () => {
    const stats = await geoShareStats(
      fakeDs([
        { outcome: 'ok', hits: 8 },
        { outcome: 'mã-chưa-từng-có', hits: 2 },
      ]),
      rangeForDays(NOW, 7),
      NOW,
    );
    expect(stats.failed).toBe(2);
    expect(stats.failed_pct).toBe(20);
  });

  it('chưa có lượt nào → failed_pct null, KHÔNG phải 0 (hai chuyện khác nhau)', async () => {
    const stats = await geoShareStats(fakeDs([]), rangeForDays(NOW, 7), NOW);
    expect(stats).toEqual({ ok: 0, failed: 0, total: 0, failed_pct: null, by_outcome: [] });
  });

  it('có bấm và KHÔNG lượt nào hỏng → 0%, không phải null', async () => {
    const stats = await geoShareStats(fakeDs([{ outcome: 'ok', hits: 5 }]), rangeForDays(NOW, 7), NOW);
    expect(stats.failed).toBe(0);
    expect(stats.failed_pct).toBe(0);
  });

  it('% làm tròn 1 chữ số — 1/3 hỏng ra 33.3 chứ không phải 33.33333', async () => {
    const stats = await geoShareStats(
      fakeDs([
        { outcome: 'ok', hits: 2 },
        { outcome: 'denied', hits: 1 },
      ]),
      rangeForDays(NOW, 7),
      NOW,
    );
    expect(stats.failed_pct).toBe(33.3);
  });
});

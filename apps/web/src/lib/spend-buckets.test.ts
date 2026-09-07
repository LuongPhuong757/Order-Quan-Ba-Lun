import { describe, expect, it } from 'vitest';
import { bucketDailySpend, pickGranularity, weekStartIso } from './spend-buckets.ts';

const d = (delivery_date: string, amount: number) => ({ delivery_date, amount });

describe('pickGranularity', () => {
  it('30 ngày và cả tháng 31 ngày đều vẽ theo NGÀY', () => {
    expect(pickGranularity('2026-08-09', '2026-09-07')).toBe('day');
    expect(pickGranularity('2026-07-01', '2026-07-31')).toBe('day');
  });

  it('90 ngày gộp theo tuần', () => {
    expect(pickGranularity('2026-06-10', '2026-09-07')).toBe('week');
  });

  it('hơn 6 tháng gộp theo tháng', () => {
    expect(pickGranularity('2025-09-07', '2026-09-07')).toBe('month');
  });

  it('một ngày duy nhất vẫn là ngày', () => {
    expect(pickGranularity('2026-09-07', '2026-09-07')).toBe('day');
  });
});

describe('weekStartIso', () => {
  it('tuần bắt đầu THỨ HAI, không phải Chủ nhật', () => {
    // 2026-09-07 là thứ Hai.
    expect(weekStartIso('2026-09-07')).toBe('2026-09-07');
    // Chủ nhật 2026-09-13 vẫn thuộc tuần bắt đầu 07/09, không nhảy sang tuần sau.
    expect(weekStartIso('2026-09-13')).toBe('2026-09-07');
    expect(weekStartIso('2026-09-14')).toBe('2026-09-14');
  });
});

describe('bucketDailySpend', () => {
  it('ngày không nhập hàng thành cột 0, không bị bỏ qua', () => {
    const { granularity, buckets } = bucketDailySpend(
      [d('2026-09-01', 100), d('2026-09-04', 300)],
      { from: '2026-09-01', to: '2026-09-05' },
    );
    expect(granularity).toBe('day');
    expect(buckets.map((b) => b.value)).toEqual([100, 0, 0, 300, 0]);
    expect(buckets.map((b) => b.label)).toEqual(['01/09', '02/09', '03/09', '04/09', '05/09']);
  });

  it('cộng nhiều dòng cùng ngày (server trả từng cặp ngày×NCC)', () => {
    const { buckets } = bucketDailySpend([d('2026-09-01', 100), d('2026-09-01', 50)], {
      from: '2026-09-01',
      to: '2026-09-01',
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].value).toBe(150);
  });

  it('khoảng dài gộp theo tuần, mốc tuần là thứ Hai', () => {
    const { granularity, buckets } = bucketDailySpend(
      [d('2026-06-10', 100), d('2026-06-14', 200), d('2026-06-15', 400)],
      { from: '2026-06-10', to: '2026-09-07' },
    );
    expect(granularity).toBe('week');
    // 10/06 là thứ Tư → ô đầu bắt đầu thứ Hai 08/06 và gom cả 14/06 (Chủ nhật).
    expect(buckets[0].key).toBe('2026-06-08');
    expect(buckets[0].value).toBe(300);
    expect(buckets[1].key).toBe('2026-06-15');
    expect(buckets[1].value).toBe(400);
  });

  it('hơn một năm gộp theo tháng, không đứt tháng nào ở giữa', () => {
    const { granularity, buckets } = bucketDailySpend(
      [d('2025-09-20', 100), d('2026-01-31', 700), d('2026-09-01', 50)],
      { from: '2025-09-01', to: '2026-09-07' },
    );
    expect(granularity).toBe('month');
    expect(buckets).toHaveLength(13);
    expect(buckets[0].key).toBe('2025-09-01');
    expect(buckets[0].value).toBe(100);
    // Tháng 1/2026 — chỗ vắt qua ranh giới NĂM, đúng chỗ phép cộng tháng dễ sai nhất.
    expect(buckets.find((b) => b.key === '2026-01-01')?.value).toBe(700);
    expect(buckets[12].key).toBe('2026-09-01');
    expect(buckets.filter((b) => b.value === 0)).toHaveLength(10);
  });

  it('không truyền khoảng thì lấy mốc từ dữ liệu ("Tất cả")', () => {
    const { buckets } = bucketDailySpend([d('2026-09-03', 10), d('2026-09-05', 20)]);
    expect(buckets.map((b) => b.key)).toEqual(['2026-09-03', '2026-09-04', '2026-09-05']);
  });

  it('không có dữ liệu và không có khoảng thì trả rỗng, không vỡ', () => {
    expect(bucketDailySpend([]).buckets).toEqual([]);
  });

  it('khoảng rỗng nhưng không có phiếu nào vẫn vẽ đủ cột 0', () => {
    const { buckets } = bucketDailySpend([], { from: '2026-09-01', to: '2026-09-03' });
    expect(buckets.map((b) => b.value)).toEqual([0, 0, 0]);
  });

  it('khoảng ngược đầu (người dùng gõ tay) thì trả rỗng chứ không lặp vô tận', () => {
    expect(bucketDailySpend([d('2026-09-01', 1)], { from: '2026-09-09', to: '2026-09-01' }).buckets).toEqual([]);
  });
});

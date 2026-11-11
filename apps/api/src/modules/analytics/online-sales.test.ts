// Phần tính thuần của khối "Đơn online & doanh thu" (2026-11-11). Ba thứ dễ sai mà không ai thấy:
//   1. Ngày/giờ phải là giờ VN — đơn thu lúc 23h30 tối VN (16h30 UTC) thuộc hôm đó, đơn thu lúc
//      1h sáng VN (18h UTC hôm trước) thuộc hôm sau.
//   2. Dãy ngày phải đủ, kể cả ngày 0 đơn — biểu đồ không được nhảy cóc.
//   3. Tỉ lệ từ chối `null` khi chưa có đơn nào, KHÁC 0%.
import { describe, expect, it } from 'vitest';
import { placedCounts, prevRange, summarizeOnlineSales, vnDayKey, vnHour } from './online-sales.js';

describe('vnDayKey / vnHour', () => {
  it('cộng 7h trước khi lấy ngày và giờ', () => {
    const ms = Date.parse('2026-11-10T18:00:00Z'); // 01:00 ngày 11/11 giờ VN
    expect(vnDayKey(ms)).toBe('2026-11-11');
    expect(vnHour(ms)).toBe(1);
    expect(vnHour(Date.parse('2026-11-10T16:30:00Z'))).toBe(23);
  });
});

describe('summarizeOnlineSales', () => {
  const days = ['2026-11-09', '2026-11-10', '2026-11-11'];

  it('ghép đủ dãy ngày, ngày không có đơn vẫn có cột 0', () => {
    const out = summarizeOnlineSales(
      [{ money_ms: Date.parse('2026-11-10T16:30:00Z'), submitted_ms: Date.parse('2026-11-10T16:00:00Z'), total: 150_000 }],
      days,
    );
    expect(out.by_day).toEqual([
      { day: '2026-11-09', success: 0, revenue: 0 },
      { day: '2026-11-10', success: 1, revenue: 150_000 },
      { day: '2026-11-11', success: 0, revenue: 0 },
    ]);
    expect(out.by_hour).toHaveLength(24);
    expect(out.by_hour[23]).toEqual({ hour: 23, success: 1 });
  });

  it('ngày theo mốc THU TIỀN, giờ theo lúc KHÁCH ĐẶT', () => {
    const out = summarizeOnlineSales(
      [
        {
          money_ms: Date.parse('2026-11-10T18:00:00Z'), // thu 01:00 ngày 11 VN
          submitted_ms: Date.parse('2026-11-10T13:00:00Z'), // đặt 20:00 ngày 10 VN
          total: 100_000,
        },
      ],
      days,
    );
    expect(out.by_day.find((d) => d.day === '2026-11-11')?.success).toBe(1);
    expect(out.by_hour[20].success).toBe(1);
  });

  it('tính tổng, số đơn và trung bình làm tròn', () => {
    const t = Date.parse('2026-11-11T05:00:00Z');
    const out = summarizeOnlineSales(
      [
        { money_ms: t, submitted_ms: t, total: 100_000 },
        { money_ms: t, submitted_ms: t, total: 50_001 },
      ],
      days,
    );
    expect(out.revenue).toBe(150_001);
    expect(out.success_count).toBe(2);
    expect(out.avg_order_value).toBe(75_001);
  });

  it('không có đơn → TB 0, không chia cho 0', () => {
    const out = summarizeOnlineSales([], days);
    expect(out.avg_order_value).toBe(0);
    expect(out.revenue).toBe(0);
  });
});

describe('placedCounts', () => {
  it('tổng đặt gồm MỌI trạng thái, từ chối và khách huỷ đếm riêng', () => {
    const out = placedCounts([
      { status: 'CONFIRMED', count: 7 },
      { status: 'REJECTED', count: 2 },
      { status: 'CANCELLED_BY_CUSTOMER', count: 1 },
    ]);
    expect(out).toEqual({
      placed_count: 10,
      rejected_count: 2,
      customer_cancelled_count: 1,
      rejected_pct: 20,
    });
  });

  it('chưa có đơn nào → tỉ lệ null chứ không phải 0%', () => {
    expect(placedCounts([]).rejected_pct).toBeNull();
  });
});

describe('prevRange', () => {
  it('kỳ trước dài đúng bằng kỳ này và kết thúc ngay ở mốc đầu kỳ này', () => {
    const range = { from_ms: 1_000_000, to_ms: 1_600_000 };
    expect(prevRange(range)).toEqual({ from_ms: 400_000, to_ms: 1_000_000 });
  });
});

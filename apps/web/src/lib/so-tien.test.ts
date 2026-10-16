import { describe, expect, it } from 'vitest';
import { accountDot, dayHeading, groupByDay, monthRange, tail4 } from './so-tien.ts';

describe('dayHeading', () => {
  it('hôm nay / hôm qua / ngày khác kèm thứ', () => {
    expect(dayHeading('2026-10-16', '2026-10-16')).toBe('Hôm nay · Thứ Sáu 16/10');
    expect(dayHeading('2026-10-15', '2026-10-16')).toBe('Hôm qua · Thứ Năm 15/10');
    expect(dayHeading('2026-10-14', '2026-10-16')).toBe('Thứ Tư 14/10');
  });

  it('qua tháng vẫn nhận ra hôm qua', () => {
    expect(dayHeading('2026-09-30', '2026-10-01')).toBe('Hôm qua · Thứ Tư 30/09');
  });
});

describe('groupByDay', () => {
  it('gom liền nhau, giữ thứ tự đầu vào', () => {
    const rows = [
      { d: '2026-10-16', id: 1 },
      { d: '2026-10-16', id: 2 },
      { d: '2026-10-15', id: 3 },
    ];
    const g = groupByDay(rows, (r) => r.d);
    expect(g.map((x) => [x.day, x.rows.map((r) => r.id)])).toEqual([
      ['2026-10-16', [1, 2]],
      ['2026-10-15', [3]],
    ]);
  });
});

describe('tiện ích nhỏ', () => {
  it('tail4 lấy 4 số cuối', () => expect(tail4('1017588888')).toBe('…8888'));

  it('màu chấm ổn định theo khoá tài khoản', () => {
    expect(accountDot('0123456789')).toBe(accountDot('0123456789'));
  });

  it('tháng này chạy từ mùng 1 theo giờ VN', () => {
    // 2026-10-31 20:00 UTC = 2026-11-01 03:00 giờ VN → đã sang tháng 11.
    expect(monthRange(Date.UTC(2026, 9, 31, 20))).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });
});

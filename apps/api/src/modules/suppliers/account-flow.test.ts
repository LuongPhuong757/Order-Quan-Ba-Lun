import { describe, it, expect } from 'vitest';
import { gopDongTien, vnDay, vnDayEnd, vnDayStart } from './account-flow.js';

/** 'YYYY-MM-DD HH:mm' giờ VN → ms. */
const luc = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00+07:00`);

describe('vnDay / vnDayStart / vnDayEnd', () => {
  it('1h sáng ngày 16 giờ VN vẫn là ngày 16 (theo lịch, không theo ca)', () => {
    expect(vnDay(luc('2026-10-16 01:00'))).toBe('2026-10-16');
    expect(vnDay(luc('2026-10-15 23:59'))).toBe('2026-10-15');
  });

  it('đầu/cuối ngày ôm trọn 24 giờ VN', () => {
    expect(vnDayStart('2026-10-16')).toBe(luc('2026-10-16 00:00'));
    expect(vnDay(vnDayEnd('2026-10-16'))).toBe('2026-10-16');
    expect(vnDayEnd('2026-10-16') + 1).toBe(vnDayStart('2026-10-17'));
  });
});

describe('gopDongTien', () => {
  it('cộng tiền vào theo ngày tiền về, tiền ra theo ngày trả, sắp tăng dần', () => {
    const kq = gopDongTien(
      [
        { money_at: luc('2026-10-16 01:00'), transfer_amount: 200_000, order_total: 200_000 },
        { money_at: luc('2026-10-16 20:00'), transfer_amount: 100_000, order_total: 300_000 },
        { money_at: luc('2026-10-14 19:00'), transfer_amount: 50_000, order_total: 50_000 },
      ],
      [
        { paid_on: '2026-10-16', amount: 1_000_000 },
        { paid_on: '2026-10-15', amount: 400_000 },
      ],
    );
    expect(kq).toEqual([
      { day: '2026-10-14', in: 50_000, out: 0 },
      { day: '2026-10-15', in: 0, out: 400_000 },
      { day: '2026-10-16', in: 300_000, out: 1_000_000 },
    ]);
  });

  it('phần CK vượt tổng đơn (bớt món sau khi thu) bị kẹp về tổng — khớp màn Lịch sử', () => {
    expect(gopDongTien([{ money_at: luc('2026-10-16 10:00'), transfer_amount: 500_000, order_total: 320_000 }], [])).toEqual([
      { day: '2026-10-16', in: 320_000, out: 0 },
    ]);
  });

  it('bỏ qua dòng 0đ, không đẻ ra ngày trống', () => {
    expect(gopDongTien([{ money_at: luc('2026-10-16 10:00'), transfer_amount: 0, order_total: 100_000 }], [])).toEqual([]);
  });
});

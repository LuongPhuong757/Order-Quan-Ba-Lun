import { describe, expect, it } from 'vitest';
import { exceedsHkdCap, hkdShiftStartMs } from './hkd-shift-cap.js';

const vn = (iso: string) => Date.parse(`${iso}+07:00`);

describe('hkdShiftStartMs — ca 12h trưa → 12h trưa (giờ VN)', () => {
  it('chiều cùng ngày thuộc ca mở 12h trưa hôm nay', () => {
    expect(hkdShiftStartMs(vn('2026-11-20T19:30:00'))).toBe(vn('2026-11-20T12:00:00'));
  });
  it('1h sáng vẫn thuộc ca mở 12h trưa HÔM QUA', () => {
    expect(hkdShiftStartMs(vn('2026-11-21T01:00:00'))).toBe(vn('2026-11-20T12:00:00'));
  });
  it('đúng 12h:00 đã là ca MỚI, 11h59 còn ca cũ', () => {
    expect(hkdShiftStartMs(vn('2026-11-21T12:00:00'))).toBe(vn('2026-11-21T12:00:00'));
    expect(hkdShiftStartMs(vn('2026-11-21T11:59:59'))).toBe(vn('2026-11-20T12:00:00'));
  });
});

describe('exceedsHkdCap — trần là TỐI ĐA', () => {
  it('đủ đúng 6.000.000 vẫn được', () => {
    expect(exceedsHkdCap(5_500_000, 500_000, 6_000_000)).toBe(false);
  });
  it('vượt 1đ là chặn', () => {
    expect(exceedsHkdCap(5_500_000, 500_001, 6_000_000)).toBe(true);
  });
  it('một đơn lẻ trên trần cũng bị chặn', () => {
    expect(exceedsHkdCap(0, 6_500_000, 6_000_000)).toBe(true);
  });
});

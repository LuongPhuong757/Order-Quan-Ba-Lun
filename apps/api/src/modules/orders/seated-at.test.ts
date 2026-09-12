import { describe, expect, it } from 'vitest';
import { SEAT_SHIFT_LOG_MIN_MS, seatShiftMessage, shouldLogSeatShift } from './seated-at.js';

const M = 60 * 1000;

describe('shouldLogSeatShift', () => {
  it('mở drawer rồi gọi món luôn → KHÔNG ghi dòng giải thích (nhịp làm việc bình thường)', () => {
    expect(shouldLogSeatShift(20 * 1000)).toBe(false);
    expect(shouldLogSeatShift(4 * M)).toBe(false);
  });

  it('bàn mở trống lâu rồi mới có khách → ghi dòng giải thích', () => {
    expect(shouldLogSeatShift(SEAT_SHIFT_LOG_MIN_MS)).toBe(true);
    expect(shouldLogSeatShift(47 * M)).toBe(true);
  });
});

describe('seatShiftMessage', () => {
  it('nói rõ bàn đã mở trống bao lâu', () => {
    expect(seatShiftMessage(47 * M)).toBe(
      'Bàn được mở trước đó 47 phút mà chưa gọi món nào — giờ vào ăn tính từ món đầu tiên',
    );
    expect(seatShiftMessage(90 * M)).toContain('1 giờ 30 phút');
  });
});

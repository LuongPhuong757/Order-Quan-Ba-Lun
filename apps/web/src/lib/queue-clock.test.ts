import { describe, expect, it } from 'vitest';
import { formatWait, isOverdue, waitingSeconds } from './queue-clock.ts';

const NOW = 1_800_000_000_000;

describe('waitingSeconds', () => {
  it('làm tròn xuống theo giây', () => {
    expect(waitingSeconds(NOW, NOW - 9_900)).toBe(9);
    expect(waitingSeconds(NOW, NOW - 10_000)).toBe(10);
  });

  it('mốc gửi ở tương lai (lệch giờ client/server) → 0, không âm', () => {
    expect(waitingSeconds(NOW, NOW + 60_000)).toBe(0);
  });
});

describe('formatWait', () => {
  it('95 giây → 1:35', () => {
    expect(formatWait(95)).toBe('1:35');
  });

  it('9 giây → 0:09 (giây luôn 2 chữ số)', () => {
    expect(formatWait(9)).toBe('0:09');
  });

  it('3661 giây → 61:01 (phút KHÔNG chia dư 60)', () => {
    expect(formatWait(3661)).toBe('61:01');
  });
});

describe('isOverdue — ngưỡng là THAM SỐ, không phải hằng số của module', () => {
  it('dưới ngưỡng → false', () => {
    expect(isOverdue(89, 90)).toBe(false);
  });

  it('đúng tại ngưỡng → true (SMS đã bắn ở giây đó)', () => {
    expect(isOverdue(90, 90)).toBe(true);
  });

  it('quá ngưỡng → true', () => {
    expect(isOverdue(120, 90)).toBe(true);
  });

  it('chủ quán đổi ngưỡng xuống 30 → 100 giây đã là quá hạn', () => {
    expect(isOverdue(100, 30)).toBe(true);
  });
});

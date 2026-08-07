import { describe, expect, it } from 'vitest';
import type { OpenHourRule } from '@order/schemas';
import { ICT_OFFSET_MS, nextOpeningText, todayOpenRange } from './open-hours.ts';

// "Quán mở lại lúc …" (2026-08-06). Mọi mốc thời gian dựng theo GIỜ VIỆT NAM tường minh — test
// không được phụ thuộc múi giờ của máy chạy CI.

/** Mốc epoch ms tại `hh:mm` giờ ICT của một ngày cụ thể. */
function ictMoment(y: number, m: number, d: number, hh: number, mm: number): number {
  return Date.UTC(y, m - 1, d, hh, mm) - ICT_OFFSET_MS;
}

// 2026-08-06 là THỨ NĂM (dow 4). Cả tuần 07:00–22:00, riêng Chủ Nhật (0) nghỉ.
const WEEK: OpenHourRule[] = [
  { dow: 1, from: '07:00', to: '22:00' },
  { dow: 2, from: '07:00', to: '22:00' },
  { dow: 3, from: '07:00', to: '22:00' },
  { dow: 4, from: '07:00', to: '22:00' },
  { dow: 5, from: '07:00', to: '22:00' },
  { dow: 6, from: '08:00', to: '23:00' },
];

describe('nextOpeningText — chưa cấu hình thì im lặng', () => {
  it('open_hours rỗng (mặc định của quán mới cài) → null', () => {
    expect(nextOpeningText([], ictMoment(2026, 8, 6, 5, 0))).toBeNull();
  });
});

describe('nextOpeningText — mốc gần nhất trong 7 ngày tới', () => {
  it('sáng sớm, chưa tới giờ mở → "hôm nay"', () => {
    expect(nextOpeningText(WEEK, ictMoment(2026, 8, 6, 5, 30))).toBe('Quán mở lại lúc 07:00 hôm nay.');
  });

  it('đêm muộn (đã qua giờ mở hôm nay) → "sáng mai"', () => {
    expect(nextOpeningText(WEEK, ictMoment(2026, 8, 6, 23, 10))).toBe('Quán mở lại lúc 07:00 sáng mai.');
  });

  it('tối thứ Bảy → nhảy qua Chủ Nhật nghỉ, nói đúng Thứ Hai', () => {
    // 2026-08-08 là thứ Bảy; 23:30 đã qua giờ mở, và Chủ Nhật không có rule.
    expect(nextOpeningText(WEEK, ictMoment(2026, 8, 8, 23, 30))).toBe('Quán mở lại Thứ Hai lúc 07:00.');
  });

  it('dùng giờ mở RIÊNG của ngày đó, không phải giờ mặc định', () => {
    // Tối thứ Sáu → mốc kế tiếp là thứ Bảy 08:00 (ngoại lệ), không phải 07:00.
    expect(nextOpeningText(WEEK, ictMoment(2026, 8, 7, 23, 0))).toBe('Quán mở lại lúc 08:00 sáng mai.');
  });
});

describe('nextOpeningText — rule hỏng thì bỏ qua, tuyệt đối không đoán', () => {
  it('giờ rác / from >= to bị loại; cả tuần rác → null', () => {
    const broken: OpenHourRule[] = [
      { dow: 4, from: 'sáng', to: '22:00' },
      { dow: 5, from: '25:00', to: '99:99' },
      { dow: 6, from: '22:00', to: '07:00' }, // qua đêm — BE cũng không hỗ trợ, xem inRange()
    ];
    expect(nextOpeningText(broken, ictMoment(2026, 8, 6, 5, 0))).toBeNull();
  });
});

describe('todayOpenRange', () => {
  it('trả khung giờ của đúng hôm nay theo giờ Việt Nam', () => {
    expect(todayOpenRange(WEEK, ictMoment(2026, 8, 8, 10, 0))).toBe('08:00 – 23:00');
  });

  it('hôm nay nghỉ → null', () => {
    // 2026-08-09 là Chủ Nhật.
    expect(todayOpenRange(WEEK, ictMoment(2026, 8, 9, 10, 0))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { OpenHourRule } from '@order/schemas';
import { ICT_OFFSET_MS, nextOpeningMs, nextOpeningText, todayOpenRange } from './open-hours.ts';

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

describe('nextOpeningMs — mốc đếm ngược phải khớp từng phút với câu chữ (2026-08-16)', () => {
  it('5:00 sáng thứ Năm → mốc là 07:00 ICT cùng ngày, đúng bằng epoch tính tay', () => {
    const now = ictMoment(2026, 8, 6, 5, 0);
    expect(nextOpeningMs(WEEK, now)).toBe(ictMoment(2026, 8, 6, 7, 0));
  });

  it('23:30 thứ Năm (đã qua giờ mở hôm nay) → mốc là 07:00 sáng mai', () => {
    const now = ictMoment(2026, 8, 6, 23, 30);
    expect(nextOpeningMs(WEEK, now)).toBe(ictMoment(2026, 8, 7, 7, 0));
  });

  it('tối thứ Bảy, Chủ Nhật nghỉ → nhảy qua tới 07:00 Thứ Hai', () => {
    const now = ictMoment(2026, 8, 8, 23, 30);
    expect(nextOpeningMs(WEEK, now)).toBe(ictMoment(2026, 8, 10, 7, 0));
  });

  it('dùng giờ mở RIÊNG của thứ Bảy (08:00), không phải giờ mặc định', () => {
    const now = ictMoment(2026, 8, 7, 23, 0);
    expect(nextOpeningMs(WEEK, now)).toBe(ictMoment(2026, 8, 8, 8, 0));
  });

  it('open_hours rỗng → null (không giới hạn giờ thì không có gì để đếm)', () => {
    expect(nextOpeningMs([], ictMoment(2026, 8, 6, 5, 0))).toBeNull();
  });
});

describe('giờ đóng "24:00" — mở tới hết ngày (2026-08-16, đi cùng ô chọn giờ 24h ở /admin)', () => {
  const LATE: OpenHourRule[] = [{ dow: 4, from: '07:00', to: '24:00' }];

  it('rule không bị coi là hỏng: 5:00 sáng thứ Năm vẫn tính được mốc mở 07:00', () => {
    expect(nextOpeningMs(LATE, ictMoment(2026, 8, 6, 5, 0))).toBe(ictMoment(2026, 8, 6, 7, 0));
  });

  it('todayOpenRange hiện đủ khung giờ thay vì null', () => {
    expect(todayOpenRange(LATE, ictMoment(2026, 8, 6, 10, 0))).toBe('07:00 – 24:00');
  });

  // 2026-08-30 — "24:01 trở đi là rác" KHÔNG còn đúng: giờ đóng nay chạy tiếp qua 24:00 để nói
  // được ca đêm, nên 24:01 là một giờ đóng hợp lệ (0h01 hôm sau). Ranh giới rác dời tới 30:00,
  // khớp `HHMM_TO` ở settings.controller.
  it('quá 30:00 mới là rác — rule bị bỏ qua', () => {
    const broken: OpenHourRule[] = [{ dow: 4, from: '07:00', to: '30:30' }];
    expect(nextOpeningMs(broken, ictMoment(2026, 8, 6, 5, 0))).toBeNull();
  });
});

describe('ca đêm — giờ đóng chạy tiếp qua 24:00 (2026-08-30)', () => {
  // 2026-08-06 là thứ Năm (dow 4). Quán bán 16:00 tới 2h sáng hôm sau.
  const NIGHT: OpenHourRule[] = [{ dow: 4, from: '16:00', to: '26:00' }];

  it('rule không bị coi là hỏng: 05:00 thứ Năm vẫn tính được mốc mở 16:00', () => {
    expect(nextOpeningMs(NIGHT, ictMoment(2026, 8, 6, 5, 0))).toBe(ictMoment(2026, 8, 6, 16, 0));
  });

  it('todayOpenRange nói rõ "hôm sau" — "16:00 – 02:00" trần trụi đọc như ca ban ngày', () => {
    expect(todayOpenRange(NIGHT, ictMoment(2026, 8, 6, 20, 0))).toBe('16:00 – 02:00 (hôm sau)');
  });
});

describe('nhiều khoảng trong một ngày (2026-08-30)', () => {
  // 2026-08-06 là thứ Năm (dow 4): bán sáng 06:00–10:00, nghỉ trưa, mở lại 17:00 tới 2h sáng.
  const SPLIT: OpenHourRule[] = [
    { dow: 4, from: '06:00', to: '10:00' },
    { dow: 4, from: '17:00', to: '26:00' },
  ];

  it('11h trưa đếm ngược tới ca CHIỀU, không phải ca sáng đã qua', () => {
    expect(nextOpeningMs(SPLIT, ictMoment(2026, 8, 6, 11, 0))).toBe(ictMoment(2026, 8, 6, 17, 0));
  });

  it('5h sáng vẫn đếm ngược tới ca sáng — khoảng sớm nhất còn ở phía trước', () => {
    expect(nextOpeningMs(SPLIT, ictMoment(2026, 8, 6, 5, 0))).toBe(ictMoment(2026, 8, 6, 6, 0));
  });

  it('todayOpenRange liệt kê ĐỦ hai khoảng — chỉ hiện khoảng đầu là bảo khách quán đóng từ 10h', () => {
    expect(todayOpenRange(SPLIT, ictMoment(2026, 8, 6, 8, 0))).toBe(
      '06:00 – 10:00, 17:00 – 02:00 (hôm sau)',
    );
  });

  it('ngày không có khoảng nào = nghỉ → todayOpenRange null', () => {
    expect(todayOpenRange(SPLIT, ictMoment(2026, 8, 5, 8, 0))).toBeNull();
  });
});

// Ca đêm vắt qua nửa đêm (2026-08-30) — quán bán 16:00 tới 2h sáng.
//
// File RIÊNG, không nhét vào `store-status.test.ts`: file đó bị khoá bởi ràng buộc plan 09-12
// ("16 test phải xanh y nguyên, không sửa file test đó"). Tách ra thì cả hai cùng chạy mà không ai
// phải đụng vào ai.
//
// Quy ước: giờ ĐÓNG chạy tiếp qua 24:00. "26:00" = 2h sáng hôm sau. Xem docblock
// `isWithinOpenHours` trong store-status.ts.
import { describe, expect, it } from 'vitest';
import {
  collapseToDefaultExceptions,
  evaluateOrderingStatus,
  expandToWeek,
  type OpenHourRule,
  type StoreOrderingSettings,
} from './store-status.js';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Mốc epoch của một giờ ICT cụ thể. 2026-08-30 là Chủ Nhật (dow 0). */
function ict(day: number, hh: number, mm = 0): number {
  return Date.UTC(2026, 7, day, hh, mm) - VN_OFFSET_MS;
}

/** Mọi ngày trong tuần cùng một khung giờ. */
function everyDay(from: string, to: string): OpenHourRule[] {
  return ([0, 1, 2, 3, 4, 5, 6] as const).map((dow) => ({ dow, from, to }));
}

function settings(open_hours: OpenHourRule[]): StoreOrderingSettings {
  return {
    online_ordering_enabled: true,
    online_ordering_off_mode: 'MANUAL',
    online_ordering_off_reason: '',
    online_ordering_off_until_ms: null,
    open_hours,
  };
}

const openAt = (hours: OpenHourRule[], ms: number) => evaluateOrderingStatus(settings(hours), ms).is_open_now;

describe('ca đêm 16:00 – 26:00 (2h sáng hôm sau)', () => {
  const hours = everyDay('16:00', '26:00');

  it('mở trong ca buổi tối', () => {
    expect(openAt(hours, ict(30, 16, 0))).toBe(true);
    expect(openAt(hours, ict(30, 23, 59))).toBe(true);
  });

  it('KHÔNG tự khoá lúc qua nửa đêm — đây là cả lý do thay đổi này tồn tại', () => {
    expect(openAt(hours, ict(31, 0, 0))).toBe(true);
    expect(openAt(hours, ict(31, 1, 59))).toBe(true);
  });

  it('đóng đúng mốc 02:00 và suốt buổi ngày hôm sau', () => {
    expect(openAt(hours, ict(31, 2, 0))).toBe(false);
    expect(openAt(hours, ict(31, 9, 0))).toBe(false);
    expect(openAt(hours, ict(31, 15, 59))).toBe(false);
  });
});

describe('phần tràn qua nửa đêm thuộc về rule của NGÀY HÔM TRƯỚC', () => {
  it('thứ Hai nghỉ (không có rule) thì rạng sáng thứ Ba đóng, dù thứ Ba có ca đêm', () => {
    // 2026-08-31 là thứ Hai (dow 1) → bỏ rule dow 1. 01/09 là thứ Ba (dow 2).
    const hours = everyDay('16:00', '26:00').filter((r) => r.dow !== 1);
    expect(openAt(hours, ict(31, 20, 0))).toBe(false); // tối thứ Hai: nghỉ
    expect(openAt(hours, ict(32, 1, 0))).toBe(false); // rạng sáng thứ Ba = ca của thứ Hai → nghỉ
    expect(openAt(hours, ict(32, 20, 0))).toBe(true); // tối thứ Ba: mở lại bình thường
  });
});

describe('quán đóng trong ngày — hành vi cũ không đổi một li', () => {
  const hours = everyDay('07:00', '22:00');

  it('rạng sáng vẫn đóng, không bị vế "ca hôm qua tràn sang" bật nhầm', () => {
    expect(openAt(hours, ict(30, 1, 0))).toBe(false);
    expect(openAt(hours, ict(30, 6, 59))).toBe(false);
    expect(openAt(hours, ict(30, 12, 0))).toBe(true);
    expect(openAt(hours, ict(30, 22, 0))).toBe(false);
  });

  it('"24:00" = mở tới hết ngày, đóng đúng lúc nửa đêm', () => {
    const tillMidnight = everyDay('16:00', '24:00');
    expect(openAt(tillMidnight, ict(30, 23, 59))).toBe(true);
    expect(openAt(tillMidnight, ict(31, 0, 0))).toBe(false);
  });
});

describe('công tắc tắt bằng tay vẫn thắng ca đêm (M2.D-30)', () => {
  it('OFF thủ công lúc 01:00 thì blocking_reason là MANUAL_OFF, không phải OUTSIDE_HOURS', () => {
    const s = { ...settings(everyDay('16:00', '26:00')), online_ordering_enabled: false };
    const status = evaluateOrderingStatus(s, ict(31, 1, 0));
    expect(status.enabled).toBe(false);
    expect(status.blocking_reason).toBe('MANUAL_OFF');
    expect(status.is_open_now).toBe(true); // giờ giấc thì vẫn đang trong ca
  });
});

// ── Nhiều khoảng mỗi ngày (2026-08-30) ──
describe('nhiều khoảng trong một ngày — bán sáng, nghỉ trưa, mở lại tối tới rạng sáng', () => {
  const hours: OpenHourRule[] = ([0, 1, 2, 3, 4, 5, 6] as const).flatMap((dow) => [
    { dow, from: '06:00', to: '10:00' },
    { dow, from: '17:00', to: '26:00' },
  ]);

  it('mở ở CẢ HAI khoảng — khoảng thứ hai không bị nuốt', () => {
    expect(openAt(hours, ict(30, 7, 0))).toBe(true);
    expect(openAt(hours, ict(30, 18, 0))).toBe(true);
  });

  it('đóng đúng quãng nghỉ trưa giữa hai khoảng', () => {
    expect(openAt(hours, ict(30, 10, 0))).toBe(false);
    expect(openAt(hours, ict(30, 13, 0))).toBe(false);
    expect(openAt(hours, ict(30, 16, 59))).toBe(false);
  });

  it('ca đêm của khoảng thứ hai vẫn tràn sang rạng sáng hôm sau', () => {
    expect(openAt(hours, ict(31, 1, 0))).toBe(true);
    expect(openAt(hours, ict(31, 2, 0))).toBe(false); // đã đóng, chưa tới ca sáng
    expect(openAt(hours, ict(31, 6, 0))).toBe(true); // ca sáng hôm sau
  });
});

describe('expandToWeek / collapseToDefaultExceptions với nhiều khoảng', () => {
  it('ngoại lệ có 0 khoảng = nghỉ cả ngày, và đi vòng expand→collapse không mất', () => {
    const input = {
      default: [
        { from: '06:00', to: '10:00' },
        { from: '17:00', to: '26:00' },
      ],
      exceptions: [{ dow: 1 as const, spans: [] }],
    };
    const rules = expandToWeek(input);
    expect(rules.filter((r) => r.dow === 1)).toHaveLength(0);
    expect(rules.filter((r) => r.dow === 2)).toHaveLength(2);
    expect(collapseToDefaultExceptions(rules)).toEqual(input);
    expect(openAt(rules, ict(31, 18, 0))).toBe(false); // 31/8 là thứ Hai → nghỉ
  });
});

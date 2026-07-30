import { describe, expect, it } from 'vitest';
import {
  collapseToDefaultExceptions,
  endOfTodayIctMs,
  evaluateOrderingStatus,
  expandToWeek,
  type StoreOrderingSettings,
} from './store-status.js';

// Mốc thời gian tiện dùng: 10:00 ICT ngày thứ Tư 2026-07-29 = 03:00 UTC cùng ngày.
// 2026-07-29 là thứ Tư (dow=3) — kiểm bằng `new Date('2026-07-29T00:00:00Z').getUTCDay()`.
const WED_10AM_ICT_MS = Date.parse('2026-07-29T03:00:00Z');

const OPEN_HOURS_ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
  dow: dow as StoreOrderingSettings['open_hours'][number]['dow'],
  from: '10:00',
  to: '22:00',
}));

function baseSettings(overrides: Partial<StoreOrderingSettings> = {}): StoreOrderingSettings {
  return {
    online_ordering_enabled: true,
    online_ordering_off_mode: 'MANUAL',
    online_ordering_off_reason: '',
    online_ordering_off_until_ms: null,
    open_hours: OPEN_HOURS_ALL_WEEK,
    ...overrides,
  };
}

describe('evaluateOrderingStatus — ON + trong giờ mở cửa', () => {
  it('trả enabled=true, is_open_now=true, blocking_reason=null', () => {
    const result = evaluateOrderingStatus(baseSettings(), WED_10AM_ICT_MS);
    expect(result).toEqual({ enabled: true, is_open_now: true, blocking_reason: null });
  });
});

describe('evaluateOrderingStatus — OFF thủ công MANUAL (M2.D-27)', () => {
  it('enabled=false, blocking_reason=MANUAL_OFF kể cả khi đang trong giờ mở cửa', () => {
    const settings = baseSettings({
      online_ordering_enabled: false,
      online_ordering_off_mode: 'MANUAL',
    });
    const result = evaluateOrderingStatus(settings, WED_10AM_ICT_MS);
    expect(result.enabled).toBe(false);
    expect(result.blocking_reason).toBe('MANUAL_OFF');
  });
});

describe('evaluateOrderingStatus — OFF UNTIL_TOMORROW (M2.D-28), tính lúc đọc quanh nửa đêm', () => {
  it('nowMs TRƯỚC mốc off_until_ms 23:59:59 hôm nay → vẫn MANUAL_OFF', () => {
    // off_until_ms = 23:59:59.000 ICT ngày 2026-07-29 = 16:59:59 UTC.
    const offUntilMs = Date.parse('2026-07-29T16:59:59.000Z');
    const nowMs = Date.parse('2026-07-29T16:00:00.000Z'); // 23:00 ICT, trước mốc
    const settings = baseSettings({
      online_ordering_enabled: false,
      online_ordering_off_mode: 'UNTIL_TOMORROW',
      online_ordering_off_until_ms: offUntilMs,
    });
    const result = evaluateOrderingStatus(settings, nowMs);
    expect(result.enabled).toBe(false);
    expect(result.blocking_reason).toBe('MANUAL_OFF');
  });

  it('nowMs SAU mốc (00:30 hôm sau) + trong giờ mở cửa → tự ON lại lúc 00:00, không cần cron', () => {
    const offUntilMs = Date.parse('2026-07-29T16:59:59.000Z'); // 23:59:59 ICT 29/7
    const nowMs = Date.parse('2026-07-29T17:30:00.000Z'); // 00:30 ICT ngày 30/7, sau mốc
    const settings = baseSettings({
      online_ordering_enabled: false,
      online_ordering_off_mode: 'UNTIL_TOMORROW',
      online_ordering_off_until_ms: offUntilMs,
      open_hours: [], // không giới hạn giờ để cô lập việc test auto-revert
    });
    const result = evaluateOrderingStatus(settings, nowMs);
    expect(result.enabled).toBe(true);
  });
});

describe('evaluateOrderingStatus — ON nhưng ngoài giờ mở cửa (M2.D-30)', () => {
  it('enabled=false, blocking_reason=OUTSIDE_HOURS, is_open_now=false', () => {
    const nowMs = Date.parse('2026-07-29T01:00:00Z'); // 08:00 ICT, trước giờ mở 10:00
    const result = evaluateOrderingStatus(baseSettings(), nowMs);
    expect(result).toEqual({ enabled: false, is_open_now: false, blocking_reason: 'OUTSIDE_HOURS' });
  });
});

describe('evaluateOrderingStatus — open_hours rỗng (chưa cấu hình, quán mới cài)', () => {
  it('is_open_now=true, không chặn — quán mới cài không bị khoá oan', () => {
    const settings = baseSettings({ open_hours: [] });
    const result = evaluateOrderingStatus(settings, WED_10AM_ICT_MS);
    expect(result.is_open_now).toBe(true);
    expect(result.enabled).toBe(true);
  });
});

describe('evaluateOrderingStatus — open_hours thiếu rule cho dow hiện tại (nghỉ ngày đó)', () => {
  it('OUTSIDE_HOURS khi không có rule khớp thứ hiện tại', () => {
    const settings = baseSettings({
      open_hours: OPEN_HOURS_ALL_WEEK.filter((r) => r.dow !== 3), // bỏ thứ Tư
    });
    const result = evaluateOrderingStatus(settings, WED_10AM_ICT_MS);
    expect(result.blocking_reason).toBe('OUTSIDE_HOURS');
  });
});

describe('evaluateOrderingStatus — biên giờ mở cửa [from, to)', () => {
  it('đúng mốc from là mở', () => {
    const nowMs = Date.parse('2026-07-29T03:00:00Z'); // đúng 10:00 ICT
    expect(evaluateOrderingStatus(baseSettings(), nowMs).is_open_now).toBe(true);
  });

  it('đúng mốc to là đã đóng', () => {
    const nowMs = Date.parse('2026-07-29T15:00:00Z'); // đúng 22:00 ICT
    expect(evaluateOrderingStatus(baseSettings(), nowMs).is_open_now).toBe(false);
  });
});

describe('evaluateOrderingStatus — múi giờ ICT lệch ngày với UTC', () => {
  it('nowMs = 17:30 UTC ngày X = 00:30 ICT ngày X+1 → dow là của ngày X+1', () => {
    // 2026-07-29 17:30 UTC = 2026-07-30 00:30 ICT (thứ Năm, dow=4).
    // Chỉ mở thứ Năm 00:00-01:00 để chứng minh dow đã lệch sang ngày sau.
    const settings = baseSettings({
      open_hours: [{ dow: 4, from: '00:00', to: '01:00' }],
    });
    const nowMs = Date.parse('2026-07-29T17:30:00Z');
    expect(evaluateOrderingStatus(settings, nowMs).is_open_now).toBe(true);
  });
});

describe('expandToWeek — mặc định + ngoại lệ theo thứ (D-15)', () => {
  it('trả đúng 7 phần tử, ngoại lệ ghi đè đúng dow', () => {
    const result = expandToWeek({
      default: { from: '10:00', to: '22:00' },
      exceptions: [{ dow: 0, from: '11:00', to: '20:00' }],
    });
    expect(result).toHaveLength(7);
    expect(result.find((r) => r.dow === 0)).toEqual({ dow: 0, from: '11:00', to: '20:00' });
    expect(result.find((r) => r.dow === 1)).toEqual({ dow: 1, from: '10:00', to: '22:00' });
  });
});

describe('collapseToDefaultExceptions — nghịch đảo của expandToWeek', () => {
  it('expand rồi collapse ra lại input ban đầu', () => {
    const input = {
      default: { from: '10:00', to: '22:00' },
      exceptions: [{ dow: 0 as const, from: '11:00', to: '20:00' }],
    };
    const rules = expandToWeek(input);
    expect(collapseToDefaultExceptions(rules)).toEqual(input);
  });
});

describe('endOfTodayIctMs — mốc 23:59:59.999 ICT của NGÀY ICT chứa nowMs (M2.D-28)', () => {
  it('nowMs = 10:00 ICT (03:00 UTC) → trả 23:59:59.999 ICT CÙNG ngày', () => {
    const nowMs = Date.parse('2026-07-29T03:00:00.000Z'); // 10:00 ICT 29/7
    const expected = Date.parse('2026-07-29T16:59:59.999Z'); // 23:59:59.999 ICT 29/7
    expect(endOfTodayIctMs(nowMs)).toBe(expected);
  });

  it('nowMs = 17:30 UTC (00:30 ICT hôm sau theo UTC) → mốc là cuối ngày ICT hôm sau theo UTC, KHÔNG phải cuối ngày UTC hiện tại', () => {
    // 2026-07-29T17:30:00Z = 2026-07-30T00:30:00 ICT → ngày ICT là 30/7.
    const nowMs = Date.parse('2026-07-29T17:30:00.000Z');
    const expected = Date.parse('2026-07-30T16:59:59.999Z'); // 23:59:59.999 ICT 30/7
    expect(endOfTodayIctMs(nowMs)).toBe(expected);
  });

  it('dùng làm off_until_ms: nowMs = t → evaluateOrderingStatus vẫn MANUAL_OFF', () => {
    const t = Date.parse('2026-07-29T03:00:00.000Z');
    const offUntilMs = endOfTodayIctMs(t);
    const settings = baseSettings({
      online_ordering_enabled: false,
      online_ordering_off_mode: 'UNTIL_TOMORROW',
      online_ordering_off_until_ms: offUntilMs,
    });
    const result = evaluateOrderingStatus(settings, t);
    expect(result.enabled).toBe(false);
    expect(result.blocking_reason).toBe('MANUAL_OFF');
  });

  it('cùng dữ liệu, nowMs = off_until_ms + 1 → enabled=true (đã qua nửa đêm ICT)', () => {
    const t = Date.parse('2026-07-29T03:00:00.000Z');
    const offUntilMs = endOfTodayIctMs(t);
    const settings = baseSettings({
      online_ordering_enabled: false,
      online_ordering_off_mode: 'UNTIL_TOMORROW',
      online_ordering_off_until_ms: offUntilMs,
      open_hours: [], // cô lập việc test auto-revert, không lẫn giờ mở cửa
    });
    const result = evaluateOrderingStatus(settings, offUntilMs + 1);
    expect(result.enabled).toBe(true);
  });
});

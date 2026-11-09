import { describe, expect, it } from 'vitest';
import { presetRange } from './date-range.ts';
import {
  countDays, DAY_SCREEN, detectPreset, ONLINE_SCREEN, PRESET_ORDER, presetToHours, presetToRange,
  SHIFT_SCREEN, viDate,
} from './time-presets.ts';

// 10:00 sáng giờ VN ngày 09/11/2026 (UTC+7 → 03:00 UTC).
const NOW = Date.UTC(2026, 10, 9, 3, 0);

describe('presetToRange', () => {
  it('Hôm qua là trọn ngày lịch hôm trước', () => {
    expect(presetToRange('yesterday', NOW)).toEqual({ from: '2026-11-08', to: '2026-11-08' });
  });

  it('Tháng này = mùng 1 tới hôm nay; Tháng trước = trọn tháng', () => {
    expect(presetToRange('month', NOW)).toEqual({ from: '2026-11-01', to: '2026-11-09' });
    expect(presetToRange('lastmonth', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('Tháng trước vào tháng 1 lùi về tháng 12 năm trước', () => {
    const jan = Date.UTC(2027, 0, 15, 3);
    expect(presetToRange('lastmonth', jan)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('Tháng trước của tháng 3 năm nhuận kết thúc ngày 29/02', () => {
    expect(presetToRange('lastmonth', Date.UTC(2028, 2, 5, 3))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('các nút đã có giữ NGUYÊN cách tính của date-range.ts (số liệu màn cũ không đổi)', () => {
    for (const p of ['shift', 'prev-shift', 'today', '7d', '30d', 'all'] as const) {
      expect(presetToRange(p, NOW)).toEqual(presetRange(p, NOW));
    }
  });

  it('ngày lấy theo giờ VN: 23:30 VN vẫn là hôm nay', () => {
    const late = Date.UTC(2026, 10, 9, 16, 30); // 23:30 VN 09/11
    expect(presetToRange('today', late)).toEqual({ from: '2026-11-09', to: '2026-11-09' });
  });
});

describe('detectPreset', () => {
  it('suy ngược đúng nút từ khoảng ngày', () => {
    expect(detectPreset({ from: '2026-11-08', to: '2026-11-08' }, NOW)).toBe('yesterday');
    expect(detectPreset({ from: '', to: '', shift: 'current' }, NOW)).toBe('shift');
    expect(detectPreset({ from: '', to: '' }, NOW)).toBe('all');
  });

  it('khoảng tự chọn → custom', () => {
    expect(detectPreset({ from: '2026-11-02', to: '2026-11-05' }, NOW)).toBe('custom');
  });

  it('màn có ca không có Hôm qua → khoảng hôm qua là custom, không sáng nhầm nút bị ẩn', () => {
    expect(detectPreset({ from: '2026-11-08', to: '2026-11-08' }, NOW, SHIFT_SCREEN)).toBe('custom');
  });

  it('ngày 1 của tháng: "Hôm nay" và "Tháng này" trùng khoảng → sáng nút đứng trước (Hôm nay)', () => {
    const day1 = Date.UTC(2026, 10, 1, 3);
    expect(detectPreset({ from: '2026-11-01', to: '2026-11-01' }, day1, DAY_SCREEN)).toBe('today');
  });
});

describe('bộ nút theo màn', () => {
  it('mọi bộ đều giữ đúng thứ tự chung', () => {
    for (const set of [DAY_SCREEN, SHIFT_SCREEN, ONLINE_SCREEN]) {
      const idx = set.map((p) => PRESET_ORDER.indexOf(p));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  it('màn có ca không có Hôm nay/Hôm qua; màn không ca không có Ca này/Ca trước', () => {
    expect(SHIFT_SCREEN).not.toContain('today');
    expect(SHIFT_SCREEN).not.toContain('yesterday');
    expect(DAY_SCREEN).not.toContain('shift');
  });

  it('Đơn online chỉ có nút quy được ra số giờ (không có khoảng hai đầu)', () => {
    expect(ONLINE_SCREEN).not.toContain('yesterday');
    expect(ONLINE_SCREEN).not.toContain('lastmonth');
  });
});

describe('presetToHours (Đơn online)', () => {
  it('Hôm nay lúc 10:00 = 10 giờ', () => {
    expect(presetToHours('today', NOW)).toBe(10);
  });
  it('7 ngày = 6 ngày trước + 10 giờ hôm nay', () => {
    expect(presetToHours('7d', NOW)).toBe(6 * 24 + 10);
  });
  it('làm tròn LÊN, tối thiểu 1 giờ (00:10 sáng vẫn lấy được đơn từ 0h)', () => {
    expect(presetToHours('today', Date.UTC(2026, 10, 8, 17, 10))).toBe(1);
  });
  it('Tất cả = không giới hạn', () => {
    expect(presetToHours('all', NOW)).toBeNull();
  });
});

describe('tiện ích', () => {
  it('đếm ngày gồm cả hai đầu', () => {
    expect(countDays('2026-11-01', '2026-11-09')).toBe(9);
    expect(countDays('2026-11-09', '2026-11-09')).toBe(1);
  });
  it('ngày ghi kiểu Việt Nam', () => {
    expect(viDate('2026-11-09')).toBe('09/11/2026');
    expect(viDate('')).toBe('');
  });
});

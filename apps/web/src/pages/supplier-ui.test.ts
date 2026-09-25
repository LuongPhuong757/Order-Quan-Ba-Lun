import { describe, expect, it } from 'vitest';
import { presetRange } from '../lib/date-range.ts';
import { khoangCuaPreset, presetDangBat } from './supplier-ui.tsx';

// 2026-09-26 lúc 20:00 giờ VN.
const TOI_VN = Date.parse('2026-09-26T13:00:00Z');

describe('presetDangBat — chip nào sáng ứng với khoảng đang xem', () => {
  it('khoảng ca sáng chip ca, KHÔNG sáng "Tất cả" dù hai ô ngày đều trống', () => {
    expect(presetDangBat(presetRange('shift', TOI_VN), TOI_VN)).toBe('shift');
    expect(presetDangBat(presetRange('prev-shift', TOI_VN), TOI_VN)).toBe('prev-shift');
    expect(presetDangBat({ from: '', to: '' }, TOI_VN)).toBe('all');
  });

  it('chip ca của thanh lọc NCC ra đúng khoảng của màn Lịch sử', () => {
    expect(khoangCuaPreset('shift', TOI_VN)).toEqual(presetRange('shift', TOI_VN));
    expect(khoangCuaPreset('prev-shift', TOI_VN)).toEqual(presetRange('prev-shift', TOI_VN));
  });

  it('mỗi chip ngày suy ngược về đúng chính nó; khoảng lạ là "custom"', () => {
    for (const p of ['today', '7d', '30d', 'month', 'lastmonth'] as const) {
      expect(presetDangBat(khoangCuaPreset(p, TOI_VN), TOI_VN)).toBe(p);
    }
    expect(presetDangBat({ from: '2026-09-01', to: '2026-09-03' }, TOI_VN)).toBe('custom');
  });
});

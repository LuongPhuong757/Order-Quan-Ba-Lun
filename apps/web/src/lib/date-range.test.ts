import { describe, expect, it } from 'vitest';
import { addDaysIso, matchPreset, presetRange, rangeLabel, vnDayIso } from './date-range.ts';

// 2026-09-07 lúc 06:00 GIỜ VN = 2026-09-06T23:00Z. Mốc này cố ý nằm trong khung 0h–7h sáng:
// đó đúng là khoảng mà cách tính bằng UTC trả về NGÀY HÔM QUA.
const SANG_SOM_VN = Date.parse('2026-09-06T23:00:00Z');
// 2026-09-07 lúc 20:00 giờ VN — buổi tối, UTC và VN cùng ngày, để đối chứng.
const TOI_VN = Date.parse('2026-09-07T13:00:00Z');

describe('vnDayIso', () => {
  it('6 giờ sáng giờ VN vẫn là ngày hôm đó, không lùi về hôm qua', () => {
    expect(vnDayIso(SANG_SOM_VN)).toBe('2026-09-07');
    // Chính là chỗ cách cũ (`new Date().toISOString()`) sai:
    expect(new Date(SANG_SOM_VN).toISOString().slice(0, 10)).toBe('2026-09-06');
  });

  it('buổi tối thì hai cách cho cùng kết quả', () => {
    expect(vnDayIso(TOI_VN)).toBe('2026-09-07');
  });

  it('23:30 giờ VN chưa sang ngày mới', () => {
    expect(vnDayIso(Date.parse('2026-09-07T16:30:00Z'))).toBe('2026-09-07');
  });

  it('00:30 giờ VN đã là ngày mới', () => {
    expect(vnDayIso(Date.parse('2026-09-07T17:30:00Z'))).toBe('2026-09-08');
  });
});

describe('addDaysIso', () => {
  it('lùi ngày qua ranh giới tháng', () => {
    expect(addDaysIso('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('lùi qua ranh giới năm', () => {
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('năm nhuận — 29/2 tồn tại', () => {
    expect(addDaysIso('2024-03-01', -1)).toBe('2024-02-29');
  });
});

describe('presetRange', () => {
  it('"Hôm nay" lấy đúng ngày VN kể cả lúc 6 giờ sáng', () => {
    expect(presetRange('today', SANG_SOM_VN)).toEqual({
      from: '2026-09-07',
      to: '2026-09-07',
    });
  });

  it('"7 ngày" GỒM hôm nay nên lùi 6, tổng cộng đúng 7 ngày', () => {
    expect(presetRange('7d', TOI_VN)).toEqual({ from: '2026-09-01', to: '2026-09-07' });
  });

  it('"30 ngày" lùi 29', () => {
    expect(presetRange('30d', TOI_VN)).toEqual({ from: '2026-08-09', to: '2026-09-07' });
  });

  it('"Tất cả" bỏ trống hai đầu — không chặn gì', () => {
    expect(presetRange('all', TOI_VN)).toEqual({ from: '', to: '' });
  });
});

describe('matchPreset', () => {
  it('nhận ra đúng preset từ khoảng ngày', () => {
    expect(matchPreset({ from: '', to: '' }, TOI_VN)).toBe('all');
    expect(matchPreset({ from: '2026-09-07', to: '2026-09-07' }, TOI_VN)).toBe('today');
    expect(matchPreset({ from: '2026-09-01', to: '2026-09-07' }, TOI_VN)).toBe('7d');
  });

  it('khoảng tự chọn thì không preset nào sáng', () => {
    expect(matchPreset({ from: '2026-09-02', to: '2026-09-05' }, TOI_VN)).toBeNull();
  });

  it('sửa tay lệch 1 ngày là preset tắt ngay, không sáng nhầm', () => {
    expect(matchPreset({ from: '2026-09-01', to: '2026-09-06' }, TOI_VN)).toBeNull();
  });

  it('chỉ điền một đầu cũng là tự chọn', () => {
    expect(matchPreset({ from: '2026-09-01', to: '' }, TOI_VN)).toBeNull();
  });
});

describe('rangeLabel', () => {
  it('viết ngày kiểu Việt để không đọc nhầm với định dạng Mỹ', () => {
    // Ô `<input type="date">` trên máy tiếng Anh hiện "09/01/2026" cho ngày này.
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-07' })).toBe('01/09/2026 – 07/09/2026');
  });

  it('cùng một ngày thì nói "Ngày ..." chứ không lặp hai lần', () => {
    expect(rangeLabel({ from: '2026-09-07', to: '2026-09-07' })).toBe('Ngày 07/09/2026');
  });

  it('bỏ trống cả hai đầu', () => {
    expect(rangeLabel({ from: '', to: '' })).toBe('Tất cả thời gian');
  });

  it('chỉ có một đầu', () => {
    expect(rangeLabel({ from: '2026-09-01', to: '' })).toBe('Từ 01/09/2026');
    expect(rangeLabel({ from: '', to: '2026-09-07' })).toBe('Đến 07/09/2026');
  });
});

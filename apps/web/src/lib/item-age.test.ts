import { describe, expect, it } from 'vitest';
import { formatAge } from './item-age.ts';

describe('formatAge', () => {
  it('dưới một tiếng thì chỉ có phút', () => {
    expect(formatAge(0)).toBe('0p');
    expect(formatAge(1)).toBe('1p');
    expect(formatAge(45)).toBe('45p');
    expect(formatAge(59)).toBe('59p');
  });

  // Chính là thứ chủ quán yêu cầu: 61 phút phải đọc ra "hơn một tiếng" ngay, không phải nhẩm.
  it('61 phút → 1h1p, không phải 61p', () => {
    expect(formatAge(61)).toBe('1h1p');
  });

  it('tròn giờ thì bỏ phần phút', () => {
    expect(formatAge(60)).toBe('1h');
    expect(formatAge(120)).toBe('2h');
    expect(formatAge(180)).toBe('3h');
  });

  it('lẻ phút sau giờ tròn', () => {
    expect(formatAge(65)).toBe('1h5p');
    expect(formatAge(119)).toBe('1h59p');
    expect(formatAge(125)).toBe('2h5p');
  });

  // Ranh giới 59/60 là chỗ dễ lệch một phút nhất.
  it('đúng mốc 60 mới đổi sang giờ', () => {
    expect(formatAge(59)).toBe('59p');
    expect(formatAge(60)).toBe('1h');
  });

  // Lệch giờ client/server cho ra số âm — `ageMinutes` đã chặn, nhưng hàm này nhận số từ 3 chỗ
  // gọi khác nhau (một chỗ tự tính lấy) nên phải tự đứng vững.
  it('số âm hoặc lẻ thập phân không làm vỡ chữ', () => {
    expect(formatAge(-5)).toBe('0p');
    expect(formatAge(61.9)).toBe('1h1p');
    expect(formatAge(59.9)).toBe('59p');
  });

  it('ca dài bất thường vẫn đọc được, không quy sang ngày', () => {
    expect(formatAge(600)).toBe('10h');
    expect(formatAge(1445)).toBe('24h5p');
  });
});

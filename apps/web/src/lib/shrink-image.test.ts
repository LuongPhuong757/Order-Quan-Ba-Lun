import { describe, expect, it } from 'vitest';
import { SHRINK_MAX_EDGE, fitWithin, shouldShrink } from './shrink-image.ts';

describe('fitWithin — giữ tỉ lệ, không phóng to', () => {
  it('ảnh dọc 48MP của iPhone thu về đúng cạnh dài 1600', () => {
    const r = fitWithin(5712, 4284);
    expect(Math.max(r.w, r.h)).toBe(SHRINK_MAX_EDGE);
    // tỉ lệ giữ nguyên (4:3)
    expect(r.w / r.h).toBeCloseTo(5712 / 4284, 2);
  });

  it('ảnh vốn nhỏ thì GIỮ NGUYÊN, không phóng to cho đủ 1600', () => {
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });

  it('ảnh chụp dọc cũng đo theo cạnh dài', () => {
    const r = fitWithin(3024, 4032);
    expect(r.h).toBe(SHRINK_MAX_EDGE);
    expect(r.w).toBe(1200);
  });
});

describe('shouldShrink', () => {
  it('ảnh nhẹ thì gửi thẳng, không nén cho xấu đi', () => {
    expect(shouldShrink({ size: 300 * 1024, type: 'image/jpeg' })).toBe(false);
  });

  it('ảnh iPhone 48MP thì nén', () => {
    expect(shouldShrink({ size: 11 * 1024 * 1024, type: 'image/jpeg' })).toBe(true);
    expect(shouldShrink({ size: 5 * 1024 * 1024, type: 'image/heic' })).toBe(true);
  });

  it('file không phải ảnh thì không đụng vào — để server từ chối bằng câu của nó', () => {
    expect(shouldShrink({ size: 20 * 1024 * 1024, type: 'application/pdf' })).toBe(false);
  });
});

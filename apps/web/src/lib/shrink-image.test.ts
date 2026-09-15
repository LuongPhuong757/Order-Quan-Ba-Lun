import { describe, expect, it } from 'vitest';
import { SHRINK_MAX_EDGE, UPLOAD_MAX_BYTES, fitWithin, rejectIfTooLarge, shouldShrink } from './shrink-image.ts';

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

describe('rejectIfTooLarge — chặn TRƯỚC khi gửi', () => {
  it('ảnh vừa cỡ thì cho đi', () => {
    expect(rejectIfTooLarge({ size: 2 * 1024 * 1024 })).toBeNull();
    expect(rejectIfTooLarge({ size: UPLOAD_MAX_BYTES })).toBeNull();
  });

  it('ảnh quá nặng thì trả câu có SỐ MB THẬT — người dùng cần biết mình đang cầm cái gì', () => {
    const msg = rejectIfTooLarge({ size: 13.4 * 1024 * 1024 });
    expect(msg).toContain('13.4MB');
    expect(msg).toContain('12MB');
  });

  /* Vì sao test này quan trọng: nếu để server từ chối, nó trả 413 rồi đóng kết nối trong khi
     trình duyệt còn đang đẩy nốt hàng chục MB — axios mất phản hồi và người dùng đọc "Lỗi mạng".
     Chặn ở đây là cách duy nhất câu giải thích tới được nơi. */
  it('trần khớp với trần của server (12MB)', () => {
    expect(UPLOAD_MAX_BYTES).toBe(12 * 1024 * 1024);
  });
});

import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone.js';

// normalizePhone là khoá so khớp duy nhất cho blacklist (M2.D-59) + "1 đơn mở/SĐT" + rate limit.
// 0912345678, 0912 345 678, +84912345678 phải map về cùng 1 khoá.

describe('normalizePhone — các biến thể hợp lệ đều chuẩn hoá về cùng 1 khoá', () => {
  it('SĐT chuẩn không đổi', () => {
    expect(normalizePhone('0912345678')).toBe('0912345678');
  });

  it('bỏ khoảng trắng', () => {
    expect(normalizePhone('0912 345 678')).toBe('0912345678');
  });

  it('bỏ gạch nối', () => {
    expect(normalizePhone('091-234-5678')).toBe('0912345678');
  });

  it('đổi tiền tố +84 thành 0', () => {
    expect(normalizePhone('+84912345678')).toBe('0912345678');
  });

  it('đổi tiền tố 84 (không dấu +) thành 0', () => {
    expect(normalizePhone('84912345678')).toBe('0912345678');
  });

  it('bỏ ngoặc đơn quanh mã vùng', () => {
    expect(normalizePhone('(091) 234 5678')).toBe('0912345678');
  });

  it('bỏ khoảng trắng thừa đầu/cuối chuỗi', () => {
    expect(normalizePhone('  0912345678  ')).toBe('0912345678');
  });
});

describe('normalizePhone — chuỗi không hợp lệ trả null', () => {
  it('chuỗi rỗng', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('chuỗi chữ không phải số', () => {
    expect(normalizePhone('abc')).toBeNull();
  });

  it('quá ngắn để là SĐT thật', () => {
    expect(normalizePhone('091')).toBeNull();
  });
});

describe('normalizePhone — kết quả luôn khớp varchar(16)', () => {
  it('độ dài kết quả không vượt quá 16 ký tự', () => {
    const result = normalizePhone('0912345678');
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(16);
  });
});

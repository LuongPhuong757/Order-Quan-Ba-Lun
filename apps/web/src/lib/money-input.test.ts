import { describe, expect, it } from 'vitest';
import { digitsOnly, formatMoneyInput } from './money-input.js';

describe('formatMoneyInput', () => {
  it('gõ 10000 → hiện 10.000 (yêu cầu gốc)', () => {
    expect(formatMoneyInput('10000')).toBe('10.000');
  });

  it('gõ tiếp vào chuỗi ĐÃ có dấu chấm vẫn ra đúng — đây là ca xảy ra mỗi lần gõ phím', () => {
    // Mỗi lần gõ, input gửi lại nguyên chuỗi đang hiện + ký tự mới. Nếu hàm không tự bóc dấu
    // chấm cũ thì chữ số thứ 4 trở đi sẽ hỏng.
    expect(formatMoneyInput('10.000' + '0')).toBe('100.000');
  });

  it('ô rỗng vẫn rỗng — không tự điền số 0 đè lên placeholder', () => {
    expect(formatMoneyInput('')).toBe('');
    expect(formatMoneyInput('abc')).toBe('');
  });

  it('bỏ số 0 thừa ở đầu: gõ nhầm 0100 ra 100', () => {
    expect(formatMoneyInput('0100')).toBe('100');
  });

  it('bỏ ký tự khách lỡ dán vào (đ, khoảng trắng, dấu phẩy)', () => {
    expect(formatMoneyInput('25.000 đ')).toBe('25.000');
    expect(formatMoneyInput('25,000')).toBe('25.000');
  });

  it('số lớn vẫn nhóm đủ 2 dấu chấm', () => {
    expect(formatMoneyInput('1000000')).toBe('1.000.000');
  });
});

describe('digitsOnly — bóc về số trước khi gửi server', () => {
  it('chuỗi hiển thị 10.000 → gửi đi 10000', () => {
    expect(Number(digitsOnly('10.000'))).toBe(10_000);
  });

  it('ô rỗng → chuỗi rỗng, Number() ra 0 chứ KHÔNG ra NaN', () => {
    expect(digitsOnly('')).toBe('');
    expect(Number(digitsOnly(''))).toBe(0);
  });

  it('đi vòng: format rồi bóc lại phải ra đúng số ban đầu', () => {
    for (const n of [0, 5, 1000, 10_000, 999_999]) {
      expect(Number(digitsOnly(formatMoneyInput(String(n))))).toBe(n);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { soTienTimDuoc } from './bank-ledger-search.js';

describe('soTienTimDuoc', () => {
  it('gõ trần "650" → cả 650đ lẫn 650.000đ (ở quán 650 là 650 nghìn)', () => {
    expect(soTienTimDuoc('650')).toEqual([650, 650_000]);
  });

  it('gõ đủ số với dấu chấm/phẩy/đ → đúng số đó', () => {
    expect(soTienTimDuoc('650.000')).toEqual([650_000]);
    expect(soTienTimDuoc('650000đ')).toEqual([650_000]);
    expect(soTienTimDuoc('1.180.000')).toEqual([1_180_000]);
    expect(soTienTimDuoc('1,180,000đ')).toEqual([1_180_000]);
  });

  it('"650k" → 650.000đ', () => {
    expect(soTienTimDuoc('650k')).toEqual([650_000]);
    expect(soTienTimDuoc(' 650 K ')).toEqual([650_000]);
  });

  it('chuỗi có chữ thì không phải số tiền', () => {
    expect(soTienTimDuoc('BAN05')).toEqual([]);
    expect(soTienTimDuoc('nguyen van a')).toEqual([]);
    expect(soTienTimDuoc('')).toEqual([]);
    expect(soTienTimDuoc('0')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { fmtQty, numpadPress, round3, stepFor } from './recipe-qty.ts';

describe('fmtQty', () => {
  it('đọc gram lên thành kg khi đủ 1000', () => {
    expect(fmtQty(1500, 'g')).toBe('1,5 kg');
    expect(fmtQty(1000, 'g')).toBe('1 kg');
    expect(fmtQty(999, 'g')).toBe('999 g');
  });

  it('đọc ml lên thành lít khi đủ 1000', () => {
    expect(fmtQty(2500, 'ml')).toBe('2,5 l');
    expect(fmtQty(250, 'ml')).toBe('250 ml');
  });

  it('đơn vị đếm giữ nguyên, không quy đổi', () => {
    // "3 lá chanh" không bao giờ được thành "0,003 gì đó" — đơn vị đếm là gốc của chính nó.
    expect(fmtQty(3, 'lá')).toBe('3 lá');
    expect(fmtQty(1200, 'quả')).toBe('1.200 quả');
    expect(fmtQty(2, 'mẹt')).toBe('2 mẹt');
  });

  it('cắt phần thập phân lẻ về 2 chữ số khi hiển thị', () => {
    expect(fmtQty(0.5, 'quả')).toBe('0,5 quả');
    expect(fmtQty(1234.567, 'g')).toBe('1,23 kg');
  });
});

describe('stepFor', () => {
  it('gram và ml nhảy 10', () => {
    expect(stepFor('g')).toBe(10);
    expect(stepFor('ml')).toBe(10);
  });

  it('kg và lít nhảy 0,1', () => {
    expect(stepFor('kg')).toBe(0.1);
    expect(stepFor('l')).toBe(0.1);
  });

  it('đơn vị đếm — kể cả từ lạ — nhảy 1', () => {
    expect(stepFor('quả')).toBe(1);
    expect(stepFor('mẹt')).toBe(1);
    expect(stepFor('')).toBe(1);
  });

  it('không phân biệt hoa thường', () => {
    expect(stepFor('G')).toBe(10);
    expect(stepFor('KG')).toBe(0.1);
  });
});

describe('round3', () => {
  it('dọn rác dấu phẩy động của JS', () => {
    expect(round3(0.1 + 0.2)).toBe(0.3);
    // 0,7 + 0,1 trong JS là 0.7999999999999999 → bấm + hai lần từ 0,6 phải ra đúng 0,8
    expect(round3(0.7 + 0.1)).toBe(0.8);
  });

  it('giữ đúng 3 chữ số thập phân như cột decimal(12,3)', () => {
    expect(round3(2.5)).toBe(2.5);
    expect(round3(1.2345)).toBe(1.235);
  });
});

describe('numpadPress', () => {
  it('gõ nối thêm chữ số', () => {
    expect(numpadPress('', '1')).toBe('1');
    expect(numpadPress('15', '0')).toBe('150');
  });

  it('xoá lùi một ký tự, chuỗi rỗng thì đứng yên', () => {
    expect(numpadPress('150', '⌫')).toBe('15');
    expect(numpadPress('', '⌫')).toBe('');
  });

  it('chỉ nhận MỘT dấu phẩy', () => {
    expect(numpadPress('1', ',')).toBe('1,');
    expect(numpadPress('1,5', ',')).toBe('1,5');
  });

  it('gõ dấu phẩy đầu tiên tự thành "0,"', () => {
    // Không có bước này thì ",5" qua Number(',5'.replace) ra NaN và nút Xong câm lặng.
    expect(numpadPress('', ',')).toBe('0,');
    expect(Number(numpadPress('', ',').replace(',', '.') + '5')).toBe(0.5);
  });

  it('số 0 đứng đầu bị thay, không sinh "007"', () => {
    expect(numpadPress('0', '7')).toBe('7');
  });

  it('số 0 vẫn đứng được trước dấu phẩy', () => {
    expect(numpadPress('0', ',')).toBe('0,');
  });

  it('chặn ở 9 ký tự — dài hơn là bấm nhầm', () => {
    expect(numpadPress('123456789', '1')).toBe('123456789');
    expect(numpadPress('12345678', '9')).toBe('123456789');
  });
});

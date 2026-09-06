import { describe, expect, it } from 'vitest';
import { lowerUnit, titleCaseVi } from './text-case.ts';

describe('titleCaseVi — hoa chữ đầu mỗi từ', () => {
  it('hoa chữ đầu từng từ', () => {
    expect(titleCaseVi('thịt bò')).toBe('Thịt Bò');
  });

  it('hạ phần đuôi xuống chữ thường — CapsLock phải ra cùng kết quả với gõ thường', () => {
    expect(titleCaseVi('THỊT BÒ')).toBe('Thịt Bò');
    expect(titleCaseVi('ThỊt BÒ')).toBe('Thịt Bò');
  });

  it('giữ nguyên khoảng trắng cuối — nếu không thì không gõ sang được từ thứ hai', () => {
    expect(titleCaseVi('thịt ')).toBe('Thịt ');
    expect(titleCaseVi('rau  muống')).toBe('Rau  Muống');
  });

  it('không đụng tới chữ số và dấu', () => {
    expect(titleCaseVi('nước mắm 40 độ đạm')).toBe('Nước Mắm 40 Độ Đạm');
    expect(titleCaseVi('cá (biển)')).toBe('Cá (biển)');
  });

  it('chuỗi rỗng và toàn khoảng trắng không ném lỗi', () => {
    expect(titleCaseVi('')).toBe('');
    expect(titleCaseVi('   ')).toBe('   ');
  });

  it('chữ có dấu vẫn hoa đúng', () => {
    expect(titleCaseVi('ớt chỉ thiên')).toBe('Ớt Chỉ Thiên');
    expect(titleCaseVi('đậu phụ')).toBe('Đậu Phụ');
  });
});

describe('lowerUnit — đơn vị tính về chữ thường', () => {
  it('hạ mọi kiểu viết về chữ thường', () => {
    expect(lowerUnit('KG')).toBe('kg');
    expect(lowerUnit('Lít')).toBe('lít');
    expect(lowerUnit('Bó')).toBe('bó');
  });

  it('chuỗi rỗng không ném lỗi', () => {
    expect(lowerUnit('')).toBe('');
  });
});

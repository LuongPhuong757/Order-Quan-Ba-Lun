import { describe, it, expect } from 'vitest';
import { parseQty } from './dinh-luong.ts';

describe('parseQty — ô định lượng nhận cả phân số', () => {
  it('số thường', () => {
    expect(parseQty('150')).toBe(150);
    expect(parseQty('  80  ')).toBe(80);
  });

  it('dấu phẩy kiểu Việt Nam', () => {
    expect(parseQty('0,5')).toBe(0.5);
    expect(parseQty('1,25')).toBe(1.25);
  });

  it('phân số — thùng 24 lon, món dùng 1 lon', () => {
    // 1/24 = 0,041666… → 0,042 theo đúng độ chính xác của cột decimal(14,3).
    expect(parseQty('1/24')).toBe(0.042);
  });

  it('phân số khác', () => {
    expect(parseQty('1/2')).toBe(0.5);
    expect(parseQty('1/3')).toBe(0.333);
    expect(parseQty('3/4')).toBe(0.75);
    expect(parseQty('2/24')).toBe(0.083);
  });

  it('phân số có khoảng trắng và dấu phẩy', () => {
    expect(parseQty(' 1 / 24 ')).toBe(0.042);
    expect(parseQty('1,5/3')).toBe(0.5);
  });

  it('chia cho 0 bị từ chối — không để ra Infinity', () => {
    expect(parseQty('1/0')).toBeNull();
  });

  it('rác thì trả null, không đoán bừa', () => {
    expect(parseQty('')).toBeNull();
    expect(parseQty('abc')).toBeNull();
    expect(parseQty('1/2/3')).toBeNull();
    expect(parseQty('-5')).toBeNull();
    expect(parseQty('0')).toBeNull();
  });

  it('làm tròn xuống dưới mức đo được thì từ chối — 1/10000 không phải định lượng thật', () => {
    // Làm tròn 3 chữ số ra 0 nghĩa là con số này không lưu được, đừng lặng lẽ ghi 0.
    expect(parseQty('1/10000')).toBeNull();
  });
});

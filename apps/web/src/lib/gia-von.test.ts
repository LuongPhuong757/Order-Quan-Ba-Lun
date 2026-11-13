import { describe, expect, it } from 'vitest';
import { locGiaVon, mucLai, tachTenNcc, tomTatGiaVon, xepGiaVon, type DongGiaVon } from './gia-von.ts';

const mon = (menu_item_name: string, margin_pct: number | null, complete = true): DongGiaVon => ({ menu_item_name, margin_pct, complete });

const rows = [
  mon('Nem Chua Rán', 55),
  mon('Bạch Tuộc Hấp', 33.3),
  mon('Ốc Lạ', 10, false), // thiếu giá: % trông mỏng nhưng không đáng tin
  mon('Trứng Non', 46.2),
  mon('Lưỡi Vịt', 94.7),
];

describe('mucLai', () => {
  it('chia theo ngưỡng 25 / 50, mốc thuộc mức trên', () => {
    expect([10, 24.9, 25, 49.9, 50, 90].map(mucLai)).toEqual(['mong', 'mong', 'vua', 'vua', 'on', 'on']);
    expect(mucLai(null)).toBeNull();
  });
});

describe('locGiaVon', () => {
  it('"Dưới 50%" bỏ món thiếu giá, "Thiếu giá" chỉ lấy món thiếu', () => {
    expect(locGiaVon(rows, 'duoi50').map((r) => r.menu_item_name)).toEqual(['Bạch Tuộc Hấp', 'Trứng Non']);
    expect(locGiaVon(rows, 'thieu').map((r) => r.menu_item_name)).toEqual(['Ốc Lạ']);
    expect(locGiaVon(rows, 'all')).toHaveLength(5);
  });
});

describe('xepGiaVon', () => {
  it('lãi mỏng nhất lên đầu, món thiếu giá luôn cuối', () => {
    expect(xepGiaVon(rows, 'mong').map((r) => r.menu_item_name)).toEqual(['Bạch Tuộc Hấp', 'Trứng Non', 'Nem Chua Rán', 'Lưỡi Vịt', 'Ốc Lạ']);
  });
  it('lãi nhiều nhất lên đầu, món thiếu giá vẫn cuối', () => {
    expect(xepGiaVon(rows, 'nhieu').map((r) => r.menu_item_name)).toEqual(['Lưỡi Vịt', 'Nem Chua Rán', 'Trứng Non', 'Bạch Tuộc Hấp', 'Ốc Lạ']);
  });
  it('không đổi mảng gốc', () => {
    const goc = rows.map((r) => r.menu_item_name);
    xepGiaVon(rows, 'ten');
    expect(rows.map((r) => r.menu_item_name)).toEqual(goc);
  });
});

describe('tomTatGiaVon', () => {
  it('chỉ tính món đủ giá', () => {
    const t = tomTatGiaVon(rows);
    expect(t.mongNhat?.menu_item_name).toBe('Bạch Tuộc Hấp');
    expect(t.duoi50).toBe(2);
    expect(t.trungBinh).toBeCloseTo((55 + 33.3 + 46.2 + 94.7) / 4);
  });
  it('rỗng không nổ', () => {
    expect(tomTatGiaVon([])).toEqual({ mongNhat: null, duoi50: 0, trungBinh: null });
  });
});

describe('tachTenNcc', () => {
  it('tách ở dấu " · " đầu tiên', () => {
    expect(tachTenNcc('Bạch Tuộc · Nguyệt Ốc Tôm')).toEqual({ ten: 'Bạch Tuộc', ncc: 'Nguyệt Ốc Tôm' });
    expect(tachTenNcc('Gas')).toEqual({ ten: 'Gas', ncc: null });
  });
});

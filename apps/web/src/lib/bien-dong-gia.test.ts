import { describe, expect, it } from 'vitest';
import { coDoiGia, locDoiGia, mucDo, theoHuong, xepDoiGia } from './bien-dong-gia.ts';

const id = (s: string) => s.toLowerCase();
const r = (ingredient_name: string, change_pct: number | null, last_date = '2026-09-20') =>
  ({ ingredient_name, change_pct, last_date });

describe('coDoiGia', () => {
  it('bỏ null, 0 và mức làm tròn ra 0,0%', () => {
    expect(coDoiGia(null)).toBe(false);
    expect(coDoiGia(0)).toBe(false);
    expect(coDoiGia(0.04)).toBe(false);
    expect(coDoiGia(-0.04)).toBe(false);
  });
  it('giữ mức hiện ra từ 0,1% trở lên, cả tăng lẫn giảm', () => {
    expect(coDoiGia(0.05)).toBe(true);
    expect(coDoiGia(-0.9)).toBe(true);
    expect(coDoiGia(566.7)).toBe(true);
  });
});

describe('mucDo', () => {
  it('chỉ gắn nhãn cho tăng giá từ 10%', () => {
    expect(mucDo(25)).toBe('manh');
    expect(mucDo(20)).toBe('manh');
    expect(mucDo(11.1)).toBe('chu-y');
    expect(mucDo(5.9)).toBe(null);
    expect(mucDo(-33.3)).toBe(null);
  });
});

describe('locDoiGia + theoHuong', () => {
  const rows = [r('Sả', 566.7), r('Gà', 0), r('Hàu', -33.3), r('Tôm', null), r('Cá rô', 2)];
  it('ẩn mặt hàng giữ nguyên giá và lọc theo tên', () => {
    expect(locDoiGia(rows, '', id).map((x) => x.ingredient_name)).toEqual(['Sả', 'Hàu', 'Cá rô']);
    expect(locDoiGia(rows, ' cá ', id).map((x) => x.ingredient_name)).toEqual(['Cá rô']);
  });
  it('tách tăng / giảm', () => {
    const doi = locDoiGia(rows, '', id);
    expect(theoHuong(doi, 'tang').map((x) => x.ingredient_name)).toEqual(['Sả', 'Cá rô']);
    expect(theoHuong(doi, 'giam').map((x) => x.ingredient_name)).toEqual(['Hàu']);
    expect(theoHuong(doi, 'tatca')).toHaveLength(3);
  });
});

describe('xepDoiGia', () => {
  const rows = [r('Ngô', 5.9, '2026-09-19'), r('Ớt Sừng', -91.7, '2026-09-19'), r('Sả', 566.7, '2026-09-20')];
  it('mặc định xếp theo độ lớn, giảm mạnh cũng lên đầu', () => {
    expect(xepDoiGia(rows, 'manh').map((x) => x.ingredient_name)).toEqual(['Sả', 'Ớt Sừng', 'Ngô']);
  });
  it('xếp theo ngày mới nhất', () => {
    expect(xepDoiGia(rows, 'moi')[0].ingredient_name).toBe('Sả');
  });
  it('không đổi mảng gốc', () => {
    const goc = [...rows];
    xepDoiGia(rows, 'ten');
    expect(rows).toEqual(goc);
  });
});

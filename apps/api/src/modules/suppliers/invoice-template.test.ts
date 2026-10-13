import { describe, expect, it } from 'vitest';
import { sortTemplateRows, windowStart, type TemplateRow } from './invoice-template.js';

const row = (p: Partial<TemplateRow>): TemplateRow => ({
  ingredient_id: p.ingredient_name ?? 'x',
  ingredient_name: 'x',
  purchase_unit: 'kg',
  times: 0,
  last_delivery_date: '2026-10-01',
  hidden: false,
  is_new: false,
  ...p,
});

describe('windowStart', () => {
  it('kỳ 90 ngày tính cả hôm nay', () => {
    expect(windowStart('2026-10-13')).toBe('2026-07-16');
  });

  it('qua ranh giới năm không lệch', () => {
    expect(windowStart('2026-01-05', 10)).toBe('2025-12-27');
  });
});

describe('sortTemplateRows', () => {
  it('món nhập nhiều lần lên đầu', () => {
    const ds = sortTemplateRows([
      row({ ingredient_name: 'Hành', times: 2 }),
      row({ ingredient_name: 'Thịt', times: 9 }),
      row({ ingredient_name: 'Tỏi', times: 5 }),
    ]);
    expect(ds.map((r) => r.ingredient_name)).toEqual(['Thịt', 'Tỏi', 'Hành']);
  });

  it('bằng số lần thì món giao gần đây hơn lên trước, rồi mới tới tên', () => {
    const ds = sortTemplateRows([
      row({ ingredient_name: 'B', times: 3, last_delivery_date: '2026-10-01' }),
      row({ ingredient_name: 'C', times: 3, last_delivery_date: '2026-10-10' }),
      row({ ingredient_name: 'A', times: 3, last_delivery_date: '2026-10-01' }),
    ]);
    expect(ds.map((r) => r.ingredient_name)).toEqual(['C', 'A', 'B']);
  });

  it('không sửa mảng gốc', () => {
    const goc = [row({ ingredient_name: 'A', times: 1 }), row({ ingredient_name: 'B', times: 2 })];
    sortTemplateRows(goc);
    expect(goc[0].ingredient_name).toBe('A');
  });
});

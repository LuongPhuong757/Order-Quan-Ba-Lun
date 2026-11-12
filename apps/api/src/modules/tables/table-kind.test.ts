import { describe, expect, it } from 'vitest';
import { planBulkTables, tableNumberOf, type ExistingTable } from './table-kind.js';

const ban = (n: string, is_active = true, kind = 'dine-in'): ExistingTable => ({
  id: `id-${kind}-${n}`,
  code: `ban-${n}`,
  kind,
  is_active,
});

describe('tableNumberOf', () => {
  it('đọc số theo giá trị, bỏ số 0 đầu và tiền tố', () => {
    expect(tableNumberOf('ban-01')).toBe(1);
    expect(tableNumberOf('ban-001')).toBe(1);
    expect(tableNumberOf('B5')).toBe(5);
    expect(tableNumberOf('mang-ve-12')).toBe(12);
  });
  it('mã không có chữ số → null', () => {
    expect(tableNumberOf('VIP')).toBeNull();
  });
});

describe('planBulkTables', () => {
  it('đã có 1–10, tạo 1–20 → chỉ tạo 11–20', () => {
    const existing = Array.from({ length: 10 }, (_, i) => ban(String(i + 1).padStart(2, '0')));
    const plan = planBulkTables('dine-in', 1, 20, existing);
    expect(plan.create.map((c) => c.code)).toEqual(
      Array.from({ length: 10 }, (_, i) => `ban-${i + 11}`),
    );
    expect(plan.skippedNums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('lỗi cũ: đã có ban-01…10, tạo 1–120 KHÔNG được sinh ban-001 trùng số', () => {
    const existing = Array.from({ length: 10 }, (_, i) => ban(String(i + 1).padStart(2, '0')));
    const plan = planBulkTables('dine-in', 1, 120, existing);
    expect(plan.create).toHaveLength(110);
    expect(plan.create[0]).toEqual({ num: 11, code: 'ban-11', name: 'Bàn 11' });
    expect(plan.create.at(-1)).toEqual({ num: 120, code: 'ban-120', name: 'Bàn 120' });
    expect(plan.create.some((c) => c.code === 'ban-001')).toBe(false);
  });

  it('mã gõ tay khác dạng (B5) vẫn tính là đã có số 5', () => {
    const plan = planBulkTables('dine-in', 4, 6, [{ id: 'x', code: 'B5', kind: 'dine-in', is_active: true }]);
    expect(plan.create.map((c) => c.num)).toEqual([4, 6]);
    expect(plan.skippedNums).toEqual([5]);
  });

  it('bàn đã xoá cùng số → hiện lại, không tạo bàn thứ hai', () => {
    const deleted = ban('03', false);
    const plan = planBulkTables('dine-in', 2, 4, [deleted]);
    expect(plan.reopen).toEqual([deleted]);
    expect(plan.create.map((c) => c.num)).toEqual([2, 4]);
  });

  it('khác loại thì không tính trùng (Ship 01 không chặn Bàn 01)', () => {
    const plan = planBulkTables('dine-in', 1, 1, [
      { id: 's', code: 'ship-01', kind: 'delivery', is_active: true },
    ]);
    expect(plan.create.map((c) => c.code)).toEqual(['ban-01']);
  });
});

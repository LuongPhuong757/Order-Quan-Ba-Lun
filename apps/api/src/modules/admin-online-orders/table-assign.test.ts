import { describe, expect, it } from 'vitest';
import { kindForFulfillment, nextTableCode, pickFreeTable } from './table-assign.js';

// M2.D-04 — "bàn trống nhỏ nhất trước". M2.D-05 — hết bàn thì tự sinh code kế tiếp.
// Đây là hàm THUẦN, không quyết định bàn nào đang bận (việc của FOR UPDATE trong
// transaction ở plan 09-06) — chỉ có quy tắc sắp xếp + đặt tên.

describe('pickFreeTable — chọn bàn trống nhỏ nhất trước (M2.D-04)', () => {
  it('sắp theo code ASC, KHÔNG tin thứ tự đầu vào', () => {
    const result = pickFreeTable([
      { id: '2', code: 'ship-02', name: 'Ship 02' },
      { id: '1', code: 'ship-01', name: 'Ship 01' },
    ]);
    expect(result?.code).toBe('ship-01');
  });

  it('danh sách rỗng → trả null (gợi ý phải tự tạo bàn)', () => {
    expect(pickFreeTable([])).toBeNull();
  });
});

describe('nextTableCode — sinh code bàn kế tiếp (M2.D-05)', () => {
  it("danh sách rỗng → 'ship-01'", () => {
    expect(nextTableCode('delivery', [])).toBe('ship-01');
  });

  it("có ship-01, ship-02 → 'ship-03'", () => {
    expect(nextTableCode('delivery', ['ship-01', 'ship-02'])).toBe('ship-03');
  });

  it("so sánh theo SỐ không theo chuỗi: ship-01, ship-09, ship-10 → 'ship-11'", () => {
    expect(nextTableCode('delivery', ['ship-01', 'ship-09', 'ship-10'])).toBe('ship-11');
  });

  it("takeaway, mang-ve-07 → 'mang-ve-08' (đúng tiền tố chữ thường)", () => {
    expect(nextTableCode('takeaway', ['mang-ve-07'])).toBe('mang-ve-08');
  });

  it('bỏ qua code không khớp tiền tố (ban-01, ship-03 với kind delivery → ship-04)', () => {
    expect(nextTableCode('delivery', ['ban-01', 'ship-03'])).toBe('ship-04');
  });

  it("bỏ qua code khớp tiền tố nhưng phần đuôi không phải số → 'ship-01'", () => {
    expect(nextTableCode('delivery', ['ship-abc'])).toBe('ship-01');
  });

  it("99 bàn (ship-99) → 'ship-100' (không pad quá 2 chữ số khi đã ≥ 100)", () => {
    expect(nextTableCode('delivery', ['ship-99'])).toBe('ship-100');
  });

  it('code sinh ra luôn ≤ 16 ký tự (giới hạn cột) — cả 2 kind', () => {
    expect(nextTableCode('delivery', ['ship-99']).length).toBeLessThanOrEqual(16);
    expect(nextTableCode('takeaway', ['mang-ve-99']).length).toBeLessThanOrEqual(16);
  });
});

describe('kindForFulfillment — re-export từ table-kind.ts (M2.D-14)', () => {
  it("PICKUP → 'takeaway'", () => {
    expect(kindForFulfillment('PICKUP')).toBe('takeaway');
  });

  it("DELIVERY → 'delivery'", () => {
    expect(kindForFulfillment('DELIVERY')).toBe('delivery');
  });
});

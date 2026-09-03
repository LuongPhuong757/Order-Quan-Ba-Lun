import { describe, expect, it } from 'vitest';
import type { PublicMenuGroup } from '@order/schemas';
import {
  isCartExpired,
  syncCartWithMenu,
  setQty,
  setLineNote,
  toSubmitItems,
  countCartForPing,
  MAX_ITEM_NOTE_LEN,
  type CartLine,
} from './cart-store.ts';

// D-05..D-08 — giỏ hàng localStorage: hết hạn 24h + đồng bộ menu mới.
// Test chỉ phủ hàm thuần (không đụng localStorage/DOM) — useCart() là hook,
// verify tay qua dev server theo 08-06-PLAN.md mục verification.

function makeGroup(items: Array<Partial<CartLine> & { menu_item_id: string; price: number; is_out_of_stock?: boolean }>): PublicMenuGroup[] {
  return [
    {
      id: 'group-1',
      code: 'GRP',
      name: 'Nhóm 1',
      icon: null,
      items: items.map((it) => ({
        id: it.menu_item_id,
        code: it.menu_item_id,
        name: it.name ?? 'Món',
        price: it.price,
        unit: 'phần',
        images: it.image ? [it.image] : [],
        is_out_of_stock: it.is_out_of_stock ?? false,
      })),
    },
  ];
}

function makeLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    menu_item_id: 'item-1',
    code: 'item-1',
    name: 'Món 1',
    unit_price: 50_000,
    qty: 2,
    note: null,
    image: null,
    ...overrides,
  };
}

describe('isCartExpired — hết hạn sau 24 giờ (D-06)', () => {
  it('CHƯA hết hạn khi cách nhau 23h59m', () => {
    const savedAtMs = 0;
    const nowMs = 23 * 3600_000 + 59 * 60_000;
    expect(isCartExpired(savedAtMs, nowMs)).toBe(false);
  });

  it('ĐÃ hết hạn khi cách nhau 24h01m', () => {
    const savedAtMs = 0;
    const nowMs = 24 * 3600_000 + 1 * 60_000;
    expect(isCartExpired(savedAtMs, nowMs)).toBe(true);
  });
});

describe('syncCartWithMenu — giá đổi (D-07)', () => {
  it('cập nhật giá mới và bật cờ priceChanged khi giá menu khác giá trong giỏ', () => {
    const lines = [makeLine({ unit_price: 50_000 })];
    const groups = makeGroup([{ menu_item_id: 'item-1', price: 60_000 }]);
    const result = syncCartWithMenu(lines, groups);
    expect(result.priceChanged).toBe(true);
    expect(result.lines[0].unit_price).toBe(60_000);
  });

  it('priceChanged=false và không sửa dòng nào khi giá không đổi', () => {
    const lines = [makeLine({ unit_price: 50_000 })];
    const groups = makeGroup([{ menu_item_id: 'item-1', price: 50_000 }]);
    const result = syncCartWithMenu(lines, groups);
    expect(result.priceChanged).toBe(false);
    expect(result.lines[0].unit_price).toBe(50_000);
  });
});

describe('syncCartWithMenu — món hết hàng (D-07)', () => {
  it('GIỮ dòng, gắn unavailable=true, không tính vào subtotal', () => {
    const lines = [makeLine({ menu_item_id: 'item-1', unit_price: 50_000, qty: 2 })];
    const groups = makeGroup([{ menu_item_id: 'item-1', price: 50_000, is_out_of_stock: true }]);
    const result = syncCartWithMenu(lines, groups);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].unavailable).toBe(true);
    expect(result.subtotal).toBe(0);
  });

  it('blocksCheckout=true khi có ít nhất 1 dòng unavailable', () => {
    const lines = [makeLine({ menu_item_id: 'item-1', unit_price: 50_000 })];
    const groups = makeGroup([{ menu_item_id: 'item-1', price: 50_000, is_out_of_stock: true }]);
    const result = syncCartWithMenu(lines, groups);
    expect(result.blocksCheckout).toBe(true);
  });
});

describe('syncCartWithMenu — món đã bị xoá khỏi menu (D-07)', () => {
  it('gắn unavailable=true + blocksCheckout=true, KHÔNG im lặng xoá dòng', () => {
    const lines = [makeLine({ menu_item_id: 'item-missing', unit_price: 50_000 })];
    const groups = makeGroup([{ menu_item_id: 'item-1', price: 50_000 }]);
    const result = syncCartWithMenu(lines, groups);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].unavailable).toBe(true);
    expect(result.blocksCheckout).toBe(true);
  });
});

describe('syncCartWithMenu — subtotal', () => {
  it('tổng đúng cho các dòng còn hàng', () => {
    const lines = [
      makeLine({ menu_item_id: 'item-1', unit_price: 50_000, qty: 2 }),
      makeLine({ menu_item_id: 'item-2', unit_price: 30_000, qty: 3 }),
    ];
    const groups = makeGroup([
      { menu_item_id: 'item-1', price: 50_000 },
      { menu_item_id: 'item-2', price: 30_000 },
    ]);
    const result = syncCartWithMenu(lines, groups);
    expect(result.subtotal).toBe(50_000 * 2 + 30_000 * 3);
  });

  it('giỏ rỗng → subtotal = 0', () => {
    const result = syncCartWithMenu([], makeGroup([]));
    expect(result.subtotal).toBe(0);
  });
});

describe('setQty — cập nhật số lượng dòng giỏ', () => {
  it('qty giảm về 0 → dòng bị loại khỏi kết quả', () => {
    const lines = [makeLine({ menu_item_id: 'item-1', qty: 2 })];
    const result = setQty(lines, 'item-1', 0);
    expect(result).toHaveLength(0);
  });

  it('qty vượt 99 → kẹp về 99', () => {
    const lines = [makeLine({ menu_item_id: 'item-1', qty: 2 })];
    const result = setQty(lines, 'item-1', 150);
    expect(result[0].qty).toBe(99);
  });
});

describe('setLineNote — ghi chú riêng từng món (gửi xuống bếp)', () => {
  it('chỉ đổi ghi chú của đúng dòng được chỉ định', () => {
    const lines = [makeLine({ menu_item_id: 'item-1' }), makeLine({ menu_item_id: 'item-2' })];
    const result = setLineNote(lines, 'item-2', 'ít cay');
    expect(result[0].note).toBeNull();
    expect(result[1].note).toBe('ít cay');
  });

  it('GIỮ nguyên khoảng trắng giữa chừng — trim từng phím gõ thì khách không gõ nổi 2 từ', () => {
    const lines = [makeLine({ menu_item_id: 'item-1' })];
    expect(setLineNote(lines, 'item-1', 'ít cay ')[0].note).toBe('ít cay ');
  });

  it('chuỗi rỗng / toàn khoảng trắng → null (bếp không nhận dòng 📝 trống)', () => {
    const lines = [makeLine({ menu_item_id: 'item-1', note: 'ít cay' })];
    expect(setLineNote(lines, 'item-1', '')[0].note).toBeNull();
    expect(setLineNote(lines, 'item-1', '   ')[0].note).toBeNull();
  });

  it('kẹp đúng giới hạn 255 của schema (khách không bị 400 sau khi gõ xong)', () => {
    const lines = [makeLine({ menu_item_id: 'item-1' })];
    const result = setLineNote(lines, 'item-1', 'a'.repeat(300));
    expect(result[0].note).toHaveLength(MAX_ITEM_NOTE_LEN);
  });
});

describe('toSubmitItems — payload gửi BE', () => {
  it('gửi kèm ghi chú từng món, đã cắt khoảng trắng thừa', () => {
    const lines = [makeLine({ menu_item_id: 'item-1', qty: 2, note: '  ít cay  ' })];
    expect(toSubmitItems(lines)).toEqual([{ menu_item_id: 'item-1', qty: 2, note: 'ít cay' }]);
  });

  it('món không ghi chú → không có field note; món hết hàng bị loại khỏi payload', () => {
    const lines = [
      makeLine({ menu_item_id: 'item-1', qty: 1 }),
      makeLine({ menu_item_id: 'item-2', qty: 1, note: 'ít cay', unavailable: true }),
    ];
    expect(toSubmitItems(lines)).toEqual([{ menu_item_id: 'item-1', qty: 1, note: undefined }]);
  });
});

describe('countCartForPing — tổng số món cho thống kê admin', () => {
  it('cộng số lượng mọi dòng', () => {
    const lines = [
      makeLine({ menu_item_id: 'item-1', qty: 2 }),
      makeLine({ menu_item_id: 'item-2', qty: 3 }),
    ];
    expect(countCartForPing(lines)).toBe(5);
  });

  it('BỎ món hết hàng — phải khớp con số khách thấy trên badge giỏ', () => {
    const lines = [
      makeLine({ menu_item_id: 'item-1', qty: 2 }),
      makeLine({ menu_item_id: 'item-2', qty: 9, unavailable: true }),
    ];
    expect(countCartForPing(lines)).toBe(2);
  });

  it('giỏ rỗng → 0 (tín hiệu "giỏ vừa rỗng" gửi lên BE, không phải bỏ qua)', () => {
    expect(countCartForPing([])).toBe(0);
  });
});

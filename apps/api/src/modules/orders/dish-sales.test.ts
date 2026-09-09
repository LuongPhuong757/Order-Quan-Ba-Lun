// Test THUẦN, không cần MySQL.
import { describe, expect, it } from 'vitest';
import { buildDishSales, type GroupRow, type MenuRow, type SoldRow } from './dish-sales.js';

const GROUPS: GroupRow[] = [
  { code: 'food', name: 'Món chính', icon: '🍜' },
  { code: 'drink', name: 'Đồ uống', icon: null },
];

const MENU: MenuRow[] = [
  { id: 'm1', name: 'Phở bò', group: 'food', price: 50_000, is_active: true },
  { id: 'm2', name: 'Trà đá', group: 'drink', price: 3_000, is_active: true },
  { id: 'm3', name: 'Chè đỗ đen', group: 'drink', price: 15_000, is_active: true },
];

describe('buildDishSales', () => {
  it('gộp số bán với menu và tính tỷ trọng doanh thu', () => {
    const sold: SoldRow[] = [
      { menu_item_id: 'm1', name: 'Phở bò', qty: 10, revenue: 500_000, orders: 7 },
      { menu_item_id: 'm2', name: 'Trà đá', qty: 30, revenue: 90_000, orders: 20 },
    ];
    const r = buildDishSales(sold, MENU, GROUPS);

    expect(r.total_qty).toBe(40);
    expect(r.total_revenue).toBe(590_000);
    expect(r.items[0].name).toBe('Phở bò');
    expect(r.items[0].group_name).toBe('🍜 Món chính');
    expect(r.items[0].current_price).toBe(50_000);
    expect(r.items[0].orders).toBe(7);
    expect(r.items[0].revenue_pct).toBeCloseTo(84.75, 2);
    // Nhóm không có icon thì chỉ hiện tên, không dính khoảng trắng thừa ở đầu.
    expect(r.items[1].group_name).toBe('Đồ uống');
  });

  it('món trong menu chưa bán phần nào KHÔNG có dòng', () => {
    // Chủ quán bỏ hẳn món 0 phần (2026-09-09): menu ~600 món thì mấy trăm dòng số 0 nhấn chìm
    // mấy chục dòng đang ra tiền.
    const sold: SoldRow[] = [{ menu_item_id: 'm1', name: 'Phở bò', qty: 1, revenue: 50_000, orders: 1 }];
    const r = buildDishSales(sold, MENU, GROUPS);

    expect(r.items).toHaveLength(1);
    expect(r.items[0].menu_item_id).toBe('m1');
  });

  it('món đổi tên giữa kỳ ra MỘT dòng, mang tên hiện tại', () => {
    // Đơn cũ snapshot tên "Phở bò tái"; menu giờ đổi thành "Phở bò".
    const sold: SoldRow[] = [{ menu_item_id: 'm1', name: 'Phở bò tái', qty: 5, revenue: 250_000, orders: 5 }];
    const r = buildDishSales(sold, MENU, GROUPS);

    expect(r.items.filter((x) => x.menu_item_id === 'm1')).toHaveLength(1);
    expect(r.items[0].name).toBe('Phở bò');
  });

  it('món đã xoá khỏi menu vẫn giữ doanh thu, đánh dấu không còn bán', () => {
    const sold: SoldRow[] = [
      { menu_item_id: 'mx', name: 'Lẩu gà (đã bỏ)', qty: 2, revenue: 400_000, orders: 2 },
      { menu_item_id: 'm1', name: 'Phở bò', qty: 1, revenue: 50_000, orders: 1 },
    ];
    const r = buildDishSales(sold, MENU, GROUPS);
    const gone = r.items.find((x) => x.menu_item_id === 'mx')!;

    expect(gone.in_menu).toBe(false);
    expect(gone.name).toBe('Lẩu gà (đã bỏ)'); // tên snapshot, không tra được menu
    expect(gone.group_name).toBeNull();
    expect(gone.current_price).toBeNull();
    expect(gone.revenue).toBe(400_000);
  });

  it('món gõ tay (không có id) gộp theo tên và không tra menu', () => {
    const sold: SoldRow[] = [{ menu_item_id: null, name: 'Món gõ tay', qty: 3, revenue: 60_000, orders: 3 }];
    const r = buildDishSales(sold, [], GROUPS);

    expect(r.items[0].menu_item_id).toBeNull();
    expect(r.items[0].in_menu).toBe(false);
    expect(r.items[0].revenue_pct).toBe(100);
  });

  it('kỳ không bán được gì thì bảng rỗng, không phải một bảng toàn số 0', () => {
    const r = buildDishSales([], MENU, GROUPS);
    expect(r.total_revenue).toBe(0);
    expect(r.items).toEqual([]);
  });
});

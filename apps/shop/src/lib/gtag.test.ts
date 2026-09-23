import { describe, expect, it } from 'vitest';
import { gaItems } from './gtag.ts';

type Line = {
  menu_item_id: string;
  name: string;
  unit_price: number;
  qty: number;
  unavailable?: boolean;
};

const line = (over: Partial<Line> = {}): Line => ({
  menu_item_id: 'id-1',
  name: 'Bún chả',
  unit_price: 45000,
  qty: 2,
  ...over,
});

/** Giống `useCart().subtotal` — bản thật cũng lọc `unavailable` trước khi cộng. */
const subtotalOf = (lines: Line[]): number =>
  lines.filter((l) => !l.unavailable).reduce((s, l) => s + l.unit_price * l.qty, 0);

describe('gaItems — dòng giỏ sang items của GA4', () => {
  it('đổi đúng 4 khoá chuẩn, tiền là số nguyên không định dạng', () => {
    expect(gaItems([line()])).toEqual([
      { item_id: 'id-1', item_name: 'Bún chả', price: 45000, quantity: 2 },
    ]);
  });

  it('LOẠI món hết hàng — nếu không, items sẽ không khớp value', () => {
    const lines = [
      line({ menu_item_id: 'a', unit_price: 45000, qty: 2 }),
      line({ menu_item_id: 'b', unit_price: 30000, qty: 1, unavailable: true }),
    ];
    const items = gaItems(lines);

    expect(items.map((i) => i.item_id)).toEqual(['a']);

    // Đây mới là tính chất thật sự cần giữ: tổng tiền của `items` phải bằng đúng `value`
    // mà `gaPurchase` gửi kèm (`cart.subtotal`). Lệch là doanh thu trong GA4 sai.
    const itemsTotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
    expect(itemsTotal).toBe(subtotalOf(lines));
  });

  it('giỏ rỗng ra mảng rỗng, không phải undefined', () => {
    expect(gaItems([])).toEqual([]);
  });

  it('giữ nguyên thứ tự và không gộp các dòng khác món', () => {
    const items = gaItems([
      line({ menu_item_id: 'a', name: 'Phở' }),
      line({ menu_item_id: 'b', name: 'Bún' }),
      line({ menu_item_id: 'c', name: 'Chè' }),
    ]);
    expect(items.map((i) => i.item_name)).toEqual(['Phở', 'Bún', 'Chè']);
  });

  it('KHÔNG kèm bất cứ khoá nào ngoài 4 khoá chuẩn (chặn lọt dữ liệu khách)', () => {
    // Dòng giỏ thật còn mang `note` — ghi chú do khách tự gõ, có thể chứa số điện thoại.
    const withNote = { ...line(), note: 'gọi 0900000000 trước khi giao', image: '/a.jpg' };
    const [item] = gaItems([withNote]);
    expect(Object.keys(item).sort()).toEqual(['item_id', 'item_name', 'price', 'quantity']);
    expect(JSON.stringify(item)).not.toContain('0900000000');
  });
});

// Test công thức tổng thu (M2.D-62). Sinh ra sau khi phát hiện `checkout()` cộng thiếu `ship_fee`
// suốt nhiều tuần mà không test nào bắt được (2026-08-06).
import { describe, expect, it } from 'vitest';
import { computeCheckoutTotals, type CheckoutPricedItem } from './checkout-total.js';

const served = (price: number, qty: number): CheckoutPricedItem => ({
  menu_item_price: price,
  qty,
  state: 'SERVED',
});

describe('computeCheckoutTotals', () => {
  it('CỘNG phí ship vào tổng thu — đây là hồi quy của lỗi thu thiếu', () => {
    const r = computeCheckoutTotals([served(50_000, 2)], 25_000);
    expect(r.items_total).toBe(100_000);
    expect(r.ship_fee).toBe(25_000);
    expect(r.total).toBe(125_000);
  });

  it('giữ tiền món TÁCH khỏi phí ship — báo cáo doanh thu món không được phồng lên', () => {
    const r = computeCheckoutTotals([served(30_000, 1)], 15_000);
    // Nếu ai đó "gộp cho gọn" bằng cách nhét ship vào items_total thì case này đỏ.
    expect(r.items_total).toBe(30_000);
    expect(r.total - r.items_total).toBe(15_000);
  });

  it('ĐÃ GỌI LÀ TÍNH TIỀN: món chưa giao vẫn vào tiền, chỉ món HUỶ là không', () => {
    // Đổi luật 2026-09-08 (chủ quán). Trước đây case này ra 50.000 vì chỉ đếm SERVED — nghĩa là
    // 2 phần đang nấu bị huỷ trắng lúc thanh toán, quán làm xong mà không thu được đồng nào.
    const r = computeCheckoutTotals(
      [
        served(50_000, 1),
        { menu_item_price: 90_000, qty: 3, state: 'CANCELLED' },
        { menu_item_price: 40_000, qty: 2, state: 'COOKING' },
      ],
      0,
    );
    expect(r.items_total).toBe(50_000 + 80_000);
    expect(r.total).toBe(130_000);
  });

  it.each([['PENDING'], ['KITCHEN'], ['COOKING'], ['READY'], ['SERVED']])(
    'món ở trạng thái %s đều tính tiền',
    (state) => {
      const r = computeCheckoutTotals([{ menu_item_price: 25_000, qty: 2, state }], 0);
      expect(r.items_total).toBe(50_000);
    },
  );

  it('món ĐÃ HUỶ vẫn tuyệt đối không vào tiền — đây là ranh giới duy nhất còn lại', () => {
    const r = computeCheckoutTotals(
      [{ menu_item_price: 999_000, qty: 5, state: 'CANCELLED' }],
      0,
    );
    expect(r.items_total).toBe(0);
  });

  it.each([
    ['null (đơn cũ trước khi có cột)', null],
    ['undefined (payload không kèm field)', undefined],
    ['0 (đơn tại quán)', 0],
  ])('phí ship %s → tổng thu = đúng tiền món, KHÔNG NaN', (_label, fee) => {
    const r = computeCheckoutTotals([served(20_000, 3)], fee);
    expect(r.ship_fee).toBe(0);
    expect(r.total).toBe(60_000);
    expect(Number.isNaN(r.total)).toBe(false);
  });

  it('đơn huỷ sạch món mà có phí ship → tổng thu vẫn đúng bằng phí ship', () => {
    // Xảy ra khi mọi món bị huỷ nhưng shipper đã đi. Không được ra 0.
    const r = computeCheckoutTotals([{ menu_item_price: 50_000, qty: 1, state: 'CANCELLED' }], 20_000);
    expect(r.total).toBe(20_000);
  });
});

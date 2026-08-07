// Công thức TỔNG THU của một order (M2.D-62).
//
// Tách khỏi `OrdersService.checkout()` — vốn nằm trong một transaction dài, không test được nếu
// không dựng MySQL — để công thức tiền có bằng chứng riêng. Lý do rất cụ thể: từ lúc `ship_fee`
// ra đời tới 2026-08-06, `checkout()` cộng thiếu nó và KHÔNG có test nào bắt được; quán thu thiếu
// đúng bằng phí ship trên mỗi đơn giao tận nơi, im lặng, suốt nhiều tuần.
//
// 2 ranh giới của M2.D-62, đừng gộp lại:
//   - `items_total` là DOANH THU MÓN — thứ đi vào báo cáo doanh thu và so được với đơn tại quán.
//   - `ship_fee` là TIỀN THU HỘ cho việc giao hàng — vào tổng thu, KHÔNG vào doanh thu món.
// Vì vậy hàm này trả cả 3 số chứ không chỉ `total`: nơi gọi cần dựng được dòng "tiền món + phí
// ship" cho thu ngân và cho nhật ký bàn.

export type CheckoutPricedItem = { menu_item_price: number; qty: number; state: string };

export type CheckoutTotals = {
  items_total: number;
  ship_fee: number;
  total: number;
};

/**
 * `items` là TOÀN BỘ dòng của order; hàm tự lọc `SERVED`. Cố ý nhận cả danh sách thay vì nhận sẵn
 * bản đã lọc: quy tắc "chỉ món ĐÃ GIAO mới tính tiền" là một phần của công thức tiền, để nơi gọi
 * tự lọc là mở đường cho một chỗ nào đó lọc thiếu rồi tính tiền cả món đã huỷ.
 */
export function computeCheckoutTotals(
  items: CheckoutPricedItem[],
  shipFee: number | null | undefined,
): CheckoutTotals {
  const items_total = items
    .filter((i) => i.state === 'SERVED')
    .reduce((sum, i) => sum + i.menu_item_price * i.qty, 0);
  // `?? 0`: đơn tại quán không bao giờ có phí ship, và đơn cũ tạo trước khi có cột này đọc ra
  // `null`. Cả hai đều là "không có phí ship", không phải lỗi.
  const ship_fee = shipFee ?? 0;
  return { items_total, ship_fee, total: items_total + ship_fee };
}

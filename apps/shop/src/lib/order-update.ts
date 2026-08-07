import type { PublicOrderStatus } from '@order/schemas';

/**
 * Quán có vừa SỬA ĐƠN giữa 2 lần poll không? (M2.D-47)
 *
 * Dùng để bật banner "Quán đã cập nhật đơn của bạn" ở `/o/:token`.
 *
 * ── Vì sao KHÔNG dùng `updated_at_ms` làm điều kiện ──
 * `updated_at_ms` đổi mỗi lần bếp chuyển trạng thái món (PENDING→KITCHEN→COOKING→READY→SERVED).
 * Một bữa lẩu 5 món có thể tạo ra 20+ lần đổi. Nếu banner ăn theo mốc đó thì nó nhảy liên tục,
 * khách học được cách phớt lờ, và đúng lúc quán huỷ món thật (M2.D-21 — thứ BẮT BUỘC phải nói cho
 * khách biết) thì không ai còn đọc banner nữa. Banner mất tác dụng chính là cách vi phạm M2.D-21
 * mà vẫn "đã implement".
 *
 * Nên điều kiện là 4 thứ khách THẤY ĐƯỢC trên màn hình:
 *   1. chữ ký danh sách món (tên · số lượng · đơn giá)
 *   2. `subtotal`
 *   3. `cancelled_count`
 *   4. `ship_fee` (thêm 2026-08-06)
 *   5. `fulfillment_type` (thêm 2026-08-06, cùng ngày mở tính năng cho quán đổi ship ⇄ tự lấy)
 *
 * `ship_fee` là mục quan trọng nhất trong 4 mục: nó là TIỀN KHÁCH PHẢI TRẢ THÊM, quán chốt sau
 * khi gọi điện. Không có nó ở đây thì phí ship được cộng vào đơn hoàn toàn im lặng — khách đang
 * mở sẵn trang theo dõi cũng không thấy gì đổi, chuẩn bị đúng tiền món, rồi shipper tới đòi thêm.
 *
 * Đổi `status`/`stage`/`percent` KHÔNG tính — stepper và số % đã diễn đạt việc đó rõ hơn banner.
 */
export function detectOrderUpdate(
  prev: PublicOrderStatus | null,
  next: PublicOrderStatus,
): boolean {
  // Lần poll đầu chưa có gì để so — không phải "vừa sửa".
  if (prev === null) return false;

  if (prev.subtotal !== next.subtotal) return true;
  if (prev.ship_fee !== next.ship_fee) return true;
  // Quán đổi ship ⇄ tự tới lấy (nhân viên bấm ở màn Đơn hàng online, 2026-08-06). Đây là thứ đổi
  // CÁCH KHÁCH NHẬN HÀNG — không báo thì khách ngồi nhà đợi shipper cho một đơn giờ phải tự ra
  // quán lấy. Stepper cũng đổi hình theo (5 mốc ⇄ 6 mốc) nhưng đổi im lặng, không ai để ý.
  if (prev.fulfillment_type !== next.fulfillment_type) return true;
  if (prev.cancelled_count !== next.cancelled_count) return true;
  return itemsSignature(prev) !== itemsSignature(next);
}

/**
 * Chữ ký danh sách món, KHÔNG phụ thuộc thứ tự.
 *
 * Sắp trước khi join vì query của BE không cam kết `ORDER BY` ổn định — MySQL được phép trả 2 thứ
 * tự khác nhau cho cùng dữ liệu. Thiếu bước sort là banner nhảy oan theo thứ tự ngẫu nhiên, loại
 * lỗi gần như không ai lần ra được nguyên nhân.
 */
function itemsSignature(o: PublicOrderStatus): string {
  return o.items
    .map((i) => `${i.name}|${i.qty}|${i.unit_price}`)
    .sort()
    .join(';');
}

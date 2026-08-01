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
 * Nên điều kiện là 3 thứ khách THẤY ĐƯỢC trên màn hình:
 *   1. chữ ký danh sách món (tên · số lượng · đơn giá)
 *   2. `subtotal`
 *   3. `cancelled_count`
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

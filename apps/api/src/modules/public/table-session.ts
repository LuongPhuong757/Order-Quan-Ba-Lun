/**
 * M7.D-06 / M7.D-19 — phiên thiết bị khách sống đúng bằng vòng đời "bàn còn đang ăn".
 *
 * ── Vì sao mỗi thiết bị có token riêng thay vì dùng thẳng mã 4 số ──
 * Mã bàn là bí mật CHIA SẺ MIỆNG: nó nằm to giữa màn hình, ai đi ngang cũng đọc được, và cả
 * bàn cùng biết. Dùng nó làm credential cho mọi request sau đó là nhân bội cơ hội rò, lại
 * không revoke được một thiết bị quậy. Nên mã chỉ dùng ĐÚNG MỘT LẦN lúc vào bàn, đổi lấy một
 * `guest_token` 64 hex riêng cho từng máy.
 *
 * ── Vì sao không cần cron dọn để mã chết đúng lúc ──
 * Nhánh cuối (`order_id` đã gắn ⇒ đơn phải còn mở) khiến THANH TOÁN XONG là mọi thiết bị của
 * bàn rụng cùng lúc, không phải xoá dòng nào, không phải hook vào `checkout()`. Đây là lý do
 * chính chọn mô hình này (xem §3.2 của spec).
 */

export type GuestSessionLike = {
  order_id: string | null;
  expires_at: number;
  revoked_at: number | null;
};

export type OrderLike = {
  closed_at: number | null;
};

/**
 * @param order đơn mà phiên trỏ tới, hoặc `null` khi phiên chưa gắn đơn **hoặc** khi không
 *              tra được. Hai ca đó phân biệt bằng `session.order_id`, không bằng `order`.
 */
export function isGuestSessionAlive(
  session: GuestSessionLike,
  order: OrderLike | null,
  nowMs: number,
): boolean {
  if (session.revoked_at !== null) return false;
  // Biên: hết hạn ĐÚNG lúc now thì coi là đã hết. Chọn `<=` chứ không `<` để không có một
  // mili giây mà phiên vừa hết hạn vẫn gọi được món.
  if (session.expires_at <= nowMs) return false;

  // Chưa gắn đơn: khách đã gõ số bàn nhưng chưa gửi lượt nào (M7.R1 — tạo đơn LƯỜI).
  if (session.order_id === null) return true;

  // Đã gắn đơn thì đơn PHẢI tra được và PHẢI còn mở. Không tra được mà vẫn cho qua là mở cửa
  // cho phiên trỏ vào đơn đã bị xoá/chuyển — thà chết nhầm, khách gõ lại số bàn là xong.
  if (order === null) return false;
  return order.closed_at === null;
}

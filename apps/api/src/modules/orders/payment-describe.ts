// Câu mô tả hình thức thanh toán cho NHẬT KÝ BÀN (2026-09-14).
//
// Tách thuần khỏi `checkout()` vì cùng lý do `checkout-total.ts` được tách: hàm kia nằm trong một
// transaction dài, không test được nếu không dựng MySQL. Mà đây là dòng chữ người ta đọc lúc đối
// soát cuối ca — nói sai một chỗ thì người đếm két đi tìm một khoản tiền không tồn tại.
//
// Hình thức KHÔNG được lưu thành cột riêng (xem docblock `payment_method` ở order.entity): nó
// luôn suy ra từ phần chuyển khoản so với tổng thu. Hàm này là nơi duy nhất viết ra phép suy đó.

const fmt = (v: number) => `${v.toLocaleString('vi-VN')}đ`;

/**
 * @param total tổng cần thu của đơn
 * @param transferAmount phần đã thu bằng chuyển khoản (0 = tiền mặt toàn bộ)
 * @param qrLabel tên mã QR đã dùng, snapshot lúc thu
 */
export function describePayment(
  total: number,
  transferAmount: number,
  qrLabel: string | null,
): string {
  const to = qrLabel ? ` → ${qrLabel}` : '';
  if (!transferAmount || transferAmount <= 0) return ' · tiền mặt';
  // `>=` chứ không `===`: đơn bị sửa sau khi thu có thể làm tổng tụt xuống dưới phần đã chuyển,
  // và lúc đó "chuyển khoản toàn bộ" vẫn là câu đúng hơn là một khoản tiền mặt ÂM.
  if (transferAmount >= total) return ` · chuyển khoản${to}`;
  return ` · tiền mặt ${fmt(total - transferAmount)} + chuyển khoản ${fmt(transferAmount)}${to}`;
}

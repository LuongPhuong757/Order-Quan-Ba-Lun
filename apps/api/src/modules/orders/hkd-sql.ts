// Điều kiện SQL "đơn thu qua mã QR HKD" — dùng chung cho Lịch sử, tổng hợp và bảng nguyên liệu
// (2026-10-15). Alias đơn phải là `o`.

/** Đơn có thu qua mã QR của HỘ KINH DOANH (2026-10-15) — chỉ những đơn này mới phải gõ sang MISA.
 *
 * Trả hỗn hợp (một phần QR HKD + phần còn lại tiền mặt) VẪN tính: hoá đơn kê cả đơn chứ không
 * tách được, cùng luật "đẩy cả đơn" ở spec CukCuk. Đơn tiền mặt có `paid_to_account_id` NULL nên
 * tự rơi ra ngoài.
 *
 * Subquery chứ không phải cờ snapshot trên `orders`: chủ quán tick nhầm/tick bù mã HKD ở màn cài
 * đặt thì đơn cũ thu qua mã đó phải hiện ra ngay trong tab "chưa lên Misa", không phải chạy lệnh
 * vá dữ liệu. */
export const HKD_SQL =
  'o.transfer_amount > 0 AND o.paid_to_account_id IN (SELECT q.id FROM payment_qr_accounts q WHERE q.is_hkd = 1)';

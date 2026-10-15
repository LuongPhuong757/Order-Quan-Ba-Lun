/**
 * "Ngân hàng đã xác nhận tiền của đơn `o` chưa" — MỘT định nghĩa cho mọi chỗ (2026-10-15).
 *
 * Hai đường để thành ✓:
 *  1. Bộ khớp tự động: một mã QR (`payment_intents`) của đơn đã đủ tiền.
 *  2. Chủ quán gán tay một khoản tiền lạ vào đơn ở màn sổ webhook (`bank_txn_assignments`).
 *
 * Tách ra file riêng vì ba chỗ phải nói CÙNG một câu: cột "Xác thực" + bộ lọc của màn Lịch sử
 * (`orders.service.ts`) và danh sách đơn được phép nhận tiền gán tay (`bank-ledger-link.service.ts`).
 * Lệch nhau là ra đơn đã ✓ mà vẫn hiện trong danh sách chờ gán, hoặc gán xong mà Lịch sử vẫn ✗.
 *
 * Bí danh bảng đơn PHẢI là `o`.
 */
export const BANK_VERIFIED_EXISTS_SQL = `(EXISTS (SELECT 1 FROM payment_intents pi
    WHERE pi.target_type = 'POS' AND pi.target_id = o.id AND pi.paid_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM bank_txn_assignments bta WHERE bta.order_id = o.id))`;

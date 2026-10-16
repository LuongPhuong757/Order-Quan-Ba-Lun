// Hai nhóm "phải đi xử lý" của Sổ webhook, viết thành SQL (2026-10-16, thiết kế lại màn).
//
// Dùng ở HAI chỗ: ô đếm trên khối tổng quan và bộ lọc khi bấm "Xem" ở ô đó. Chung một chuỗi SQL
// là cố ý — ô đếm nói "3 khoản" mà bấm vào ra 2 dòng là người ta thôi tin cả màn.
//
// Cùng luật với `BankLedgerLinkService.linksFor()`: gán tay đứng trước, rồi mới tới mã QR mà bộ
// khớp đã nối (chỉ đơn tại quầy — `target_type = 'POS'`). Alias bảng giao dịch phải là `t`.
//
// ⚠ COLLATE TƯỜNG MINH ở mọi phép so với `bank_txn_assignments`. Bảng này sinh 2026-10-15 bằng
// `synchronize`, và ở DB nào server mặc định `utf8mb4_0900_ai_ci` thì nó mang collation đó, trong
// khi các bảng cũ là `utf8mb4_unicode_ci` → MySQL ném "Illegal mix of collations" ngay ở phép `=`.
// Đã gặp thật trên DB của worktree CK-NCC (2026-10-16); DB dev chính thì đồng nhất nên không lộ.
// Ép về một collation thì câu chạy đúng bất kể DB nào lệch. Bảng nhỏ, mất chỉ mục ở phía này không đáng kể.
const CI = 'COLLATE utf8mb4_unicode_ci';

/** Đơn mà khoản tiền `t` đang nối vào, hoặc NULL. Dùng để đếm số BÀN chứ không phải số khoản
 *  tiền: khách chuyển hai lần cho cùng một bàn vẫn chỉ là một bàn phải đi bấm thanh toán. */
export const LINKED_ORDER_SQL = `COALESCE(
  (SELECT a.order_id ${CI} FROM bank_txn_assignments a WHERE a.bank_txn_id ${CI} = t.id LIMIT 1),
  (SELECT pi.target_id FROM payment_intents pi WHERE pi.id = t.applied_intent_id AND pi.target_type = 'POS')
)`;

/** Tiền lạ: tiền VÀO chưa gán tay và bộ khớp cũng không nối được mã nào — đúng nhóm `via: 'none'`. */
export const UNMATCHED_SQL = `(t.direction = 'in'
  AND NOT EXISTS (SELECT 1 FROM bank_txn_assignments a WHERE a.bank_txn_id ${CI} = t.id)
  AND NOT EXISTS (SELECT 1 FROM payment_intents pi WHERE pi.id = t.applied_intent_id))`;

/** Tiền đã về mà bàn vẫn mở — ca chủ quán muốn bắt nhất (xem `LinkedOrderState` 'open'). */
export const OPEN_TABLE_SQL = `(t.direction = 'in'
  AND EXISTS (SELECT 1 FROM orders o WHERE o.id = ${LINKED_ORDER_SQL} AND o.closed_at IS NULL))`;

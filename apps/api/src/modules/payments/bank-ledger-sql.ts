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
/** Tiền vào đã nối được bàn/đơn — gán tay hoặc mã QR. Đây là "tiền vào của quán" (2026-11-18). */
const IN_LINKED_SQL = `(EXISTS (SELECT 1 FROM bank_txn_assignments a WHERE a.bank_txn_id ${CI} = t.id)
  OR EXISTS (SELECT 1 FROM payment_intents pi WHERE pi.id = t.applied_intent_id))`;

/** Chủ quán đã đánh dấu "không phải tiền quán" (`bank_txn_classes`, 2026-11-18). */
export const OUTSIDE_SQL = `EXISTS (SELECT 1 FROM bank_txn_classes c
  WHERE c.bank_txn_id ${CI} = t.id AND c.kind = 'OUTSIDE')`;

/** Tiền RA đã khớp một lần trả NCC còn tồn tại — xoá lần trả thì khoản tự rơi về "Chưa rõ". */
export const NCC_SQL = `(t.direction = 'out' AND EXISTS (SELECT 1 FROM bank_txn_classes c
  JOIN supplier_payments sp ON sp.id ${CI} = c.supplier_payment_id ${CI}
  WHERE c.bank_txn_id ${CI} = t.id AND c.kind = 'NCC'))`;

/** Tiền lạ: tiền VÀO chưa gán tay, bộ khớp cũng không nối được mã nào, và chủ quán chưa bảo
 *  "không phải tiền quán" — đúng nhóm `via: 'none'` trừ những khoản đã đánh dấu ngoài quán. */
export const UNMATCHED_SQL = `(t.direction = 'in' AND NOT ${IN_LINKED_SQL} AND NOT ${OUTSIDE_SQL})`;

/** Tiền ra chưa rõ trả cho ai: chưa khớp NCC, chưa đánh dấu ngoài quán. */
export const UNSURE_OUT_SQL = `(t.direction = 'out' AND NOT ${NCC_SQL} AND NOT ${OUTSIDE_SQL})`;

/** Mọi thứ KHÔNG tính vào số to: tiền lạ, tiền ra chưa rõ, khoản ngoài quán. */
export const NOT_SHOP_SQL = `(${OUTSIDE_SQL} OR ${UNMATCHED_SQL} OR ${UNSURE_OUT_SQL})`;

/**
 * Năm nhóm của một khoản tiền — MỘT biểu thức dùng cho cả số tổng (GROUP BY) lẫn nhãn từng dòng,
 * để số trên đầu màn luôn bằng tổng các dòng mang nhãn tương ứng.
 *  - `table`   vào, đã nối bàn         → cộng vào số to
 *  - `ncc`     ra, đã khớp NCC         → cộng vào "Trả NCC"
 *  - `stray`   vào, tiền lạ            → không tính, ô "Tiền lạ"
 *  - `unsure`  ra, chưa rõ             → không tính, ô "Tiền ra chưa rõ"
 *  - `outside` chủ quán bảo ngoài quán → không tính
 */
export const BUCKET_SQL = `(CASE
  WHEN ${OUTSIDE_SQL} THEN 'outside'
  WHEN t.direction = 'in' AND ${IN_LINKED_SQL} THEN 'table'
  WHEN t.direction = 'in' THEN 'stray'
  WHEN ${NCC_SQL} THEN 'ncc'
  ELSE 'unsure' END)`;

export type LedgerBucket = 'table' | 'ncc' | 'stray' | 'unsure' | 'outside';

/** Tiền đã về mà bàn vẫn mở — ca chủ quán muốn bắt nhất (xem `LinkedOrderState` 'open'). */
export const OPEN_TABLE_SQL = `(t.direction = 'in'
  AND EXISTS (SELECT 1 FROM orders o WHERE o.id = ${LINKED_ORDER_SQL} AND o.closed_at IS NULL))`;

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * Khoản tiền ở sổ webhook này CÓ PHẢI tiền của quán không (2026-11-18, chủ quán yêu cầu).
 *
 * Số to đầu Sổ webhook trước đây cộng MỌI giao dịch của các tài khoản đã nối SePay — cả tiền
 * chủ quán chuyển qua lại giữa các tài khoản, tiền chi việc riêng. Chủ quán muốn số đó chỉ còn:
 * tiền VÀO = khoản đã khớp bàn, tiền RA = khoản trả NCC. Bảng này ghi phần "ý kiến" cần cho việc
 * đó; cùng lệ `bank_txn_assignments`: bảng `bank_transactions` là bản ghi THÔ của ngân hàng, không
 * thêm cột vào đó.
 *
 *  - `NCC`     tiền RA đã khớp một lần trả NCC (`supplier_payments`). `via = 'auto'` khi máy tự
 *              khớp (cùng TK, cùng số tiền, ±1 ngày, không lẫn ai), `manual` khi người gán.
 *  - `OUTSIDE` chủ quán xác nhận khoản này KHÔNG phải tiền quán (vào hoặc ra). Không tính.
 *  - `UNSURE`  chủ quán đã GỠ một lần khớp NCC. Giữ hàng này để máy không tự khớp lại đúng phiếu
 *              vừa bị gỡ ở lần mở màn sau — trên màn nó vẫn là "Chưa rõ" như khoản chưa ai đụng.
 *
 * Khoản không có hàng nào ở đây: tiền vào → theo bàn (`bank_txn_assignments` / mã QR); tiền ra →
 * "Chưa rõ", chờ máy hoặc người khớp.
 *
 * Vết đầy đủ ai làm gì ở `audit_log` (`bank_txn.ncc_*`, `bank_txn.outside_*`).
 */
export type BankTxnClassKind = 'NCC' | 'OUTSIDE' | 'UNSURE';

@Entity('bank_txn_classes')
// Một khoản tiền một kết luận.
@Index('uq_btc_txn', ['bank_txn_id'], { unique: true })
// Một lần trả NCC chỉ khớp MỘT khoản ngân hàng — không thì hai khoản 500k cùng ngày ăn chung một
// phiếu 500k và số "trả NCC" bị đếm đôi. NULL không đụng nhau trong UNIQUE của MySQL.
@Index('uq_btc_payment', ['supplier_payment_id'], { unique: true })
export class BankTxnClass {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** `bank_transactions.id`. */
  @Column({ type: 'varchar', length: 36 })
  bank_txn_id!: string;

  @Column({ type: 'varchar', length: 8 })
  kind!: BankTxnClassKind;

  /** `supplier_payments.id` — chỉ khi `kind = 'NCC'`. Không khoá ngoại: xoá lần trả NCC thì hàng
   *  này thành mồ côi và khoản tiền tự rơi về "Chưa rõ" (SQL phân loại kiểm phiếu còn tồn tại). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  supplier_payment_id!: string | null;

  @Column({ type: 'varchar', length: 8, default: 'manual' })
  via!: 'auto' | 'manual';

  @Column({ type: 'varchar', length: 36, nullable: true })
  by_user_id!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  by_name!: string | null;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

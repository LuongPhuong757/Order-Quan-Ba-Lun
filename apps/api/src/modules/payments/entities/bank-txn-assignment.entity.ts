import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * Chủ quán GÁN TAY một khoản tiền lạ vào một đơn (2026-10-15).
 *
 * Tiền lạ = dòng `bank_transactions` tiền vào mà bộ khớp không gán được (khách xoá nội dung, quét
 * QR tĩnh dán bàn, gõ STK tay). Bộ khớp CỐ Ý không đoán theo số tiền — xem `payments-apply.service.ts`
 * — nên người phải quyết. Bảng này là quyết định đó.
 *
 * BẢNG RIÊNG chứ không thêm cột vào `bank_transactions`: bảng kia là bản ghi THÔ của ngân hàng,
 * còn đây là ý kiến của một người. Gỡ gán = xoá hàng ở đây, dòng tiền gốc không hề bị đụng.
 *
 * KHÔNG tạo `payment_intents` giả: bảng đó là "mã QR đã chìa ra", và `paid_at` của nó là mốc MỘT
 * CHIỀU không bao giờ gỡ — gán nhầm thì không có đường lui.
 *
 * Vết ai gán / ai gỡ đầy đủ nằm ở `audit_log` (`bank_txn.assigned` / `bank_txn.unassigned`). Hai
 * cột người gán ở đây chỉ để màn sổ webhook hiện được "Gán tay · <tên>" mà không phải lục audit.
 */
@Entity('bank_txn_assignments')
// MỘT khoản tiền chỉ vào MỘT đơn (chủ quán chốt 2026-10-15). UNIQUE ở tầng DB: hai người bấm gán
// cùng lúc thì người sau nhận lỗi chứ không ra hai đơn cùng ✓ bằng một khoản tiền.
@Index('uq_bta_txn', ['bank_txn_id'], { unique: true })
@Index('idx_bta_order', ['order_id'])
export class BankTxnAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** `bank_transactions.id`. */
  @Column({ type: 'varchar', length: 36 })
  bank_txn_id!: string;

  /** `orders.id` — chỉ đơn tại quầy, cùng phạm vi với mọi `payment_intents` đang sinh ra. */
  @Column({ type: 'varchar', length: 36 })
  order_id!: string;

  @Column({ type: 'varchar', length: 36, nullable: true })
  assigned_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  assigned_by_name!: string | null;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

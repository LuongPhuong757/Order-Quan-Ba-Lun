// Lần trả tiền cho nhà cung cấp (M3.D-39, 2026-09-05).
//
// KHÔNG gán vào phiếu cụ thể, chỉ trừ vào tổng nợ của NCC (mục 3.5). Quán trả theo đợt, gộp
// nhiều phiếu, đôi khi trả thiếu rồi bù sau — bắt đối chiếu từng phiếu với từng lần trả là tự
// dựng một module kế toán mà không ai ở quán duy trì nổi, và sổ sẽ lệch ngay tháng thứ hai.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

export type PaymentMethod = 'CASH' | 'TRANSFER';

@Entity('supplier_payments')
// Truy vấn duy nhất của bảng này là "NCC này đã trả bao nhiêu, từ ngày nào" — dùng cho cả công
// nợ lẫn danh sách thanh toán trong chi tiết NCC.
@Index('idx_payment_supplier_date', ['supplier_id', 'paid_on'])
export class SupplierPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  supplier_id!: string;

  /** Ngày TRẢ TIỀN, 'YYYY-MM-DD' — không phải ngày nhập liệu, cùng lý do với
   * `supplier_deliveries.delivery_date`. Đưa tiền hôm qua mà tối nay mới ghi là chuyện thường. */
  @Column({ type: 'date' })
  paid_on!: string;

  /** VND. `int unsigned` như mọi cột tiền trong repo — tiền Việt không có phần lẻ.
   *
   * Không cho số âm: "trả âm" thực chất là NCC hoàn tiền hoặc ghi nhầm, và cho phép nó ở đây là
   * mở đường cho người dùng sửa sai bằng cách cộng trừ lung tung thay vì xoá dòng sai. */
  @Column({ type: 'int', unsigned: true })
  amount!: number;

  @Column({ type: 'varchar', length: 16, default: 'CASH' })
  method!: PaymentMethod;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  created_by_user_id!: string | null;

  /** Snapshot tên người ghi — nhân viên nghỉ việc rồi thì dòng tiền cũ vẫn phải đọc được là ai
   * ghi. Cùng lệ với `supplier_deliveries.created_by_name`. */
  @Column({ type: 'varchar', length: 128, default: '' })
  created_by_name!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

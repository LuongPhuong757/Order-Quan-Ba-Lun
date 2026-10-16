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

  /** Tài khoản của QUÁN mà tiền đi ra (`payment_qr_accounts.id`) — 2026-10-15, chủ quán yêu cầu.
   *
   * Chỉ có nghĩa khi `method = 'TRANSFER'`; tiền mặt luôn NULL. Lần trả ghi trước ngày này cũng
   * NULL và màn hình hiện "—" — không đoán bù: quán có nhiều tài khoản, gán bừa vào một cái là
   * làm sai số "tài khoản này đã chi bao nhiêu" mà không ai biết.
   *
   * Không đặt khoá ngoại: mã QR bị xoá thì dòng tiền cũ vẫn phải còn, đọc tên qua
   * `paid_from_label` bên dưới. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  paid_from_account_id!: string | null;

  /** Snapshot tên mã QR lúc ghi — cùng lệ với `orders.payment_qr_label`: đổi tên hay xoá mã QR
   *  ở Cài đặt sau này thì dòng cũ vẫn đọc được là tiền đi từ đâu. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  paid_from_label!: string | null;

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

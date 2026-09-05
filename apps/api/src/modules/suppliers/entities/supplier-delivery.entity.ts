// Phiếu nhập hàng từ NCC (2026-09-05). Một phiếu = một lần NCC giao hàng.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/** Ai tạo ra phiếu này (M3.D-10).
 *
 * Sáu tháng sau tranh cãi một phiếu, câu hỏi đầu tiên luôn là "ai nhập cái này?". Cột này trả
 * lời được mà không phải đào audit log. Bước 1 chỉ sinh ra `STAFF`; `SUPPLIER` có sẵn từ bây giờ
 * để bước 3 (NCC tự nhập) không phải đổi schema. */
export type DeliverySource = 'STAFF' | 'SUPPLIER';

/** Vòng đời phiếu (mục 5 của spec).
 *
 * - `PENDING_REVIEW`: NCC gửi, quán chưa kiểm hàng. Bước 1 chưa sinh ra trạng thái này.
 * - `PENDING_PRICE`: có dòng lệch giá quá ngưỡng, chờ quán duyệt giá (M3.D-26).
 * - `CONFIRMED`: đã kiểm/đã duyệt. CHỈ phiếu ở trạng thái này mới vào công nợ và thống kê
 *   (M3.D-41) — số NCC tự khai không được tự động thành nợ của quán.
 * - `CANCELLED`: huỷ, giữ lại để truy vết chứ không xoá.
 */
export type DeliveryStatus = 'PENDING_REVIEW' | 'PENDING_PRICE' | 'CONFIRMED' | 'CANCELLED';

@Entity('supplier_deliveries')
// Truy vấn chủ đạo của cả module là "phiếu của NCC này trong khoảng ngày này" — danh sách phiếu,
// tổng mua theo kỳ, thống kê mặt hàng nhập, biến động giá đều đi qua đúng cặp cột này.
@Index('idx_delivery_supplier_date', ['supplier_id', 'delivery_date'])
@Index('idx_delivery_date', ['delivery_date'])
export class SupplierDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  supplier_id!: string;

  /** Ngày GIAO HÀNG, 'YYYY-MM-DD' — không phải ngày nhập liệu.
   *
   * Hai thứ này lệch nhau thật: nhân viên bận thì tối mới ngồi nhập phiếu của sáng, và nhập bù
   * phiếu hôm qua là chuyện thường. Báo cáo theo kỳ phải bám ngày giao, nên `created_at` không
   * thay thế được cột này. */
  @Column({ type: 'date' })
  delivery_date!: string;

  @Column({ type: 'varchar', length: 24, default: 'CONFIRMED' })
  status!: DeliveryStatus;

  /** M3.D-10. Phiếu admin nhập hộ vào thẳng `CONFIRMED` (M3.D-07) vì chính nhân viên đang cầm
   * hàng và đếm — không còn ai để kiểm nữa. */
  @Column({ type: 'varchar', length: 16, default: 'STAFF' })
  source!: DeliverySource;

  /** Người bấm nút tạo phiếu. NULL khi phiếu do NCC tự gửi (bước 3). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  created_by_user_id!: string | null;

  /** Snapshot tên người tạo — cùng lý do snapshot tên món/giá: nhân viên nghỉ việc và bị xoá
   * tài khoản thì phiếu cũ vẫn phải đọc được là ai nhập. */
  @Column({ type: 'varchar', length: 128, default: '' })
  created_by_name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  /** Tổng tiền phiếu, VND. Cộng sẵn thay vì SUM dòng mỗi lần đọc: danh sách phiếu và tổng mua
   * theo kỳ đều chỉ cần con số này, join xuống dòng chỉ để hiện chi tiết. */
  @Column({ type: 'int', unsigned: true, default: 0 })
  total_amount!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

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

  /** Công nợ NCC NGAY SAU khi phiếu này vào sổ, VND. Đóng dấu một lần lúc phiếu thành
   * `CONFIRMED`, sau đó không bao giờ đổi (2026-09-09, chủ quán yêu cầu).
   *
   * Đây là con số màn hình đã báo lúc nhân viên bấm lưu — thứ người ta nhớ và mang đi đối chiếu
   * với NCC. Sổ giao dịch còn tự cộng dồn ra một số dư luỹ kế nữa, và hai số đó KHÁC nhiệm vụ:
   * luỹ kế luôn khớp với hiện tại, cột này khớp với quá khứ. Chúng lệch nhau đúng khi có ai đó
   * sửa phiếu cũ / nhập bù phiếu lùi ngày / sửa nợ cũ — và chính lúc lệch mới là lúc cột này
   * đáng giá, nên KHÔNG được cập nhật lại nó ở `update()`.
   *
   * `int` CÓ DẤU chứ không `unsigned`: trả trước hoặc ghi dư làm công nợ âm, ép unsigned thì
   * MySQL cắt về 0 và con số đối chiếu thành sai.
   *
   * NULL = phiếu chưa từng vào công nợ (NCC gửi, chờ duyệt / đã huỷ), hoặc phiếu có TRƯỚC
   * 2026-09-09. Cố tình không backfill phiếu cũ: tính lại từ dữ liệu hôm nay ra đúng con số luỹ
   * kế, dán vào đây thì thành một dấu vết bịa mà người đọc lại tưởng là thật. */
  @Column({ type: 'int', nullable: true, default: null })
  balance_after_snapshot!: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

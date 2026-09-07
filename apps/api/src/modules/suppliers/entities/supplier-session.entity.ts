// Phiên đăng nhập của nhà cung cấp (M3.D-02, bước 4).
//
// Cùng mô hình với `customer_sessions` của luồng khách: token ngẫu nhiên đục (không phải JWT),
// lưu ở DB, hạn 90 ngày TRƯỢT — mỗi lần dùng hợp lệ thì đẩy hạn lùi tiếp 90 ngày.
//
// Vì sao trượt chứ không phải cố định: điểm rơi lớn nhất của nhóm không rành công nghệ không
// phải lúc nhập liệu mà là lúc QUÊN MẬT KHẨU. NCC giao hàng đều thì gần như không bao giờ phải
// đăng nhập lại; chỉ người bỏ dùng vài tháng mới gặp lại màn đăng nhập.
//
// Token đục thay vì JWT là cố ý: chủ quán phải THU HỒI được ngay khi NCC nghỉ hoặc lộ máy, mà
// JWT thì đã phát ra là sống tới hạn.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('supplier_sessions')
@Index('idx_ssess_token', ['token'], { unique: true })
@Index('idx_ssess_supplier', ['supplier_id'])
export class SupplierSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 32 byte hex sinh bằng CSPRNG — cùng cỡ với `customer_sessions.token`. */
  @Column({ type: 'varchar', length: 64 })
  token!: string;

  @Column({ type: 'varchar', length: 36 })
  supplier_id!: string;

  @Column({ type: 'varchar', length: 36 })
  supplier_user_id!: string;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  expires_at!: number;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  last_used_at!: number;

  /** Set khi chủ quán reset PIN hoặc tắt tài khoản — phiên chết ngay dù chưa hết hạn. */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  revoked_at!: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

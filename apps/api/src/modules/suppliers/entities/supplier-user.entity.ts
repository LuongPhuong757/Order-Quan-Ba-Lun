// Tài khoản đăng nhập của nhà cung cấp (M3.D-01, bước 4).
//
// Chủ quán đã cân nhắc phương án link không mật khẩu và CHỌN tài khoản + mật khẩu. Vì người dùng
// là nhóm không rành công nghệ, mọi thứ ở đây được kéo về phía dễ nhất còn an toàn được:
// tên đăng nhập là SỐ ĐIỆN THOẠI (ai cũng nhớ), mật khẩu là PIN 6 CHỮ SỐ (bàn phím số, không
// phải gõ chữ hoa hay ký tự đặc biệt trên điện thoại).
//
// Bù lại entropy thấp của PIN bằng khoá tạm sau vài lần sai (M3.D-04) chứ không bằng cách bắt
// mật khẩu khó hơn — bắt khó hơn thì họ ghi ra giấy dán lên tường, còn tệ hơn.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('supplier_users')
// SĐT là tên đăng nhập nên phải là duy nhất TOÀN HỆ THỐNG, không phải duy nhất trong một NCC:
// hai NCC cùng số thì lúc đăng nhập không biết là ai.
@Index('idx_supplier_user_phone', ['phone'], { unique: true })
@Index('idx_supplier_user_supplier', ['supplier_id'])
export class SupplierUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  supplier_id!: string;

  /** SĐT đã chuẩn hoá qua `normalizePhone` — cùng hàm với luồng khách, để "0901..." và
   * "+84901..." không thành hai tài khoản. */
  @Column({ type: 'varchar', length: 16 })
  phone!: string;

  /** bcrypt của PIN 6 số. Cùng thư viện và cost với mật khẩu nhân viên. */
  @Column({ type: 'varchar', length: 120 })
  pin_hash!: string;

  /** Số lần nhập sai LIÊN TIẾP. Về 0 sau mỗi lần vào đúng. */
  @Column({ type: 'int', unsigned: true, default: 0 })
  failed_attempts!: number;

  /** Khoá tới thời điểm này (ms). NULL = không khoá. */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  locked_until!: number | null;

  /** Tắt tài khoản mà không xoá NCC — dùng khi ngừng hợp tác nhưng vẫn giữ lịch sử. */
  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

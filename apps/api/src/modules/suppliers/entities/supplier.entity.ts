// Nhà cung cấp (M3.D-05, 2026-09-05). Quán làm việc với 10–30 NCC, phần lớn không rành công
// nghệ — nên bảng này CHỈ cần đủ để nhân viên quán nhập hộ được (M3.D-05). Cột tài khoản/PIN
// cho NCC tự đăng nhập nằm ở bước 3 của lộ trình, chưa có ở đây.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('suppliers')
// UNIQUE trên tên đã chuẩn hoá, cùng lý do như `ingredients.name_key`: gõ "Chị Tư" hôm nay và
// "chi tu" tuần sau mà đẻ ra hai NCC thì công nợ và lịch sử giá của cùng một người bị xẻ đôi.
@Index('idx_supplier_name_key', ['name_key'], { unique: true })
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Tên hiển thị, giữ nguyên chữ người dùng gõ: "Chị Tư rau", "Cty Minh Phát". */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** Tên đã bỏ dấu + thường hoá — xem `normalizeName` trong `ingredient-units.ts`. */
  @Column({ type: 'varchar', length: 128 })
  name_key!: string;

  /** SĐT. Là thứ nhân viên cần nhất khi mở màn NCC ra (gọi đặt hàng), nên không nullable-rỗng
   * mà để chuỗi rỗng khi chưa biết — tránh `null` lọt vào chỗ hiển thị. */
  @Column({ type: 'varchar', length: 32, default: '' })
  phone!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  /** Xoá mềm, cùng lệ với `ingredients.is_active` và `menu_items.is_active`: phiếu nhập cũ đã
   * snapshot tên nên báo cáo quá khứ không hỏng, nhưng giữ dòng lại thì còn truy được. */
  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

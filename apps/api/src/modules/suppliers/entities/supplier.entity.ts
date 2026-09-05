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

  /** Số tiền quán ĐANG NỢ nhà cung cấp này tại thời điểm bắt đầu dùng phần mềm (M3.D-40), VND.
   *
   * Đây là con số DUY NHẤT trong hệ thống không kiểm chứng được từ dữ liệu — nó đến từ việc chủ
   * quán ngồi đối chiếu sổ với từng NCC. Vì vậy chỉ owner sửa được và mỗi lần sửa có vết ở audit
   * log; sửa lung tung thì mọi báo cáo công nợ mất giá trị mà không ai phát hiện ra.
   *
   * Để 0 cũng dùng được: khi đó con số "còn phải trả" hiểu là phát sinh TỪ NGÀY BẮT ĐẦU DÙNG,
   * không phải tổng nợ thật (Q-7 trong spec). */
  @Column({ type: 'int', default: 0 })
  opening_balance!: number;

  /** Mốc của số dư đầu kỳ, 'YYYY-MM-DD'. NULL = số dư tính từ đầu thời gian.
   *
   * BẮT BUỘC PHẢI CÓ, không phải cột trang trí: phiếu nhập và lần trả tiền TRƯỚC mốc này đã nằm
   * trong `opening_balance` rồi. Cộng chúng thêm lần nữa là tính hai lần và số nợ phồng lên —
   * xem `sumAfter` trong `balance.ts`. */
  @Column({ type: 'date', nullable: true })
  opening_balance_date!: string | null;

  /** Xoá mềm, cùng lệ với `ingredients.is_active` và `menu_items.is_active`: phiếu nhập cũ đã
   * snapshot tên nên báo cáo quá khứ không hỏng, nhưng giữ dòng lại thì còn truy được. */
  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

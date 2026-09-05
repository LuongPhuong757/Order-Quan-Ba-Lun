// Danh mục nguyên liệu — DÙNG CHUNG cho mọi món (chốt 2026-09-05).
//
// "Thịt bò" là MỘT dòng duy nhất ở đây, 10 món cùng trỏ vào qua `recipe_lines`. Nếu để tên
// nguyên liệu là chuỗi text nằm trong công thức từng món thì câu hỏi của chủ quán — "tháng này
// hết bao nhiêu thịt bò" — không trả lời được: mỗi món ghi một kiểu, không cộng lại được.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('ingredients')
@Index('idx_ingredient_name_key', ['name_key'], { unique: true })
export class Ingredient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Tên hiển thị, giữ nguyên chữ người dùng gõ: "Thịt bò", "Hành lá". */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** Tên đã chuẩn hoá (bỏ dấu, thường hoá, gộp khoảng trắng) — xem `normalizeName`.
   *
   * UNIQUE, và đây là lớp chặn trùng lặp TỰ ĐỘNG: gõ "Thịt Bò" hay "thit bo" khi nhập công thức
   * đều tra ra đúng dòng đang có thay vì tạo dòng thứ hai. Không có nó thì tính năng tự tạo
   * nguyên liệu sẽ sinh rác sau vài ngày và báo cáo tiêu hao thành vô nghĩa.
   */
  @Column({ type: 'varchar', length: 128 })
  name_key!: string;

  /** Đơn vị GỐC để lưu định lượng: 'g' | 'ml' | 'quả' | 'lá'... Mỗi nguyên liệu chỉ một đơn vị.
   *
   * Người nhập công thức vẫn gõ kg / lít thoải mái — `toBaseQty` quy về đơn vị này TRƯỚC khi
   * lưu. Cho phép hai đơn vị cùng tồn tại trong một cột là tự tạo hai thang đo. */
  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  /** Ghi chú tuỳ ý của chủ quán: "mua ở chợ đầu mối", "loại ba chỉ"... */
  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  /** Xoá mềm, cùng lệ với `menu_items.is_active`.
   *
   * Nguyên liệu bị gộp đi cũng để `false` ở đây (không DELETE): các bản chốt tiêu hao trong quá
   * khứ đã snapshot tên riêng nên không hỏng, nhưng giữ dòng lại thì còn lần ra được vì sao
   * tháng trước có tên đó. */
  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  /** Trỏ tới nguyên liệu đã gộp vào, khi dòng này bị gộp. NULL với nguyên liệu bình thường.
   *
   * Chỉ để truy vết ("cái 'bò' hồi xưa giờ nằm ở đâu"); mọi truy vấn tiêu hao đều đi qua
   * `recipe_lines` đã được trỏ lại nên không đọc cột này. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  merged_into_id!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

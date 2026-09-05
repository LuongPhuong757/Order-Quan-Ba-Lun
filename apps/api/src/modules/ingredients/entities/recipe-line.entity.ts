// Công thức: 1 dòng = 1 nguyên liệu trong 1 món. Món nhiều nguyên liệu thì nhiều dòng (bún bò
// 8 dòng, trà đá 2 dòng) — chủ quán nêu rõ 2026-09-05 là món KHÔNG chỉ có một loại nguyên liệu.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('recipe_lines')
// UNIQUE (món, nguyên liệu): một món không thể có 2 dòng cùng một nguyên liệu — nếu có thì
// người nhập đang định SỬA định lượng chứ không phải thêm dòng, và hai dòng rời sẽ âm thầm
// cộng dồn thành tiêu hao gấp đôi.
@Index('idx_recipe_item_ingredient', ['menu_item_id', 'ingredient_id'], { unique: true })
@Index('idx_recipe_ingredient', ['ingredient_id'])
export class RecipeLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  menu_item_id!: string;

  @Column({ type: 'varchar', length: 36 })
  ingredient_id!: string;

  /** Định lượng cho MỘT phần, tính bằng đơn vị gốc của nguyên liệu (`ingredients.unit`).
   *
   * `decimal(12,3)` chứ không phải `int`: 0,5 quả trứng hay 2,5 g muối là chuyện thường trong
   * định lượng bếp, làm tròn về số nguyên là sai ngay từ dòng đầu tiên. mysql2 trả decimal dạng
   * STRING — khai `string` cho đúng thực tế, giống `orders.distance_km`. */
  @Column({ type: 'decimal', precision: 12, scale: 3 })
  qty_per_serving!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

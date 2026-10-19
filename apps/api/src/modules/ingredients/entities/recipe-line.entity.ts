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
// UNIQUE (món, nguyên liệu, NCC): cùng một cặp nguyên liệu + NCC mà thêm lần nữa là người nhập
// đang SỬA định lượng chứ không phải thêm dòng.
//
// Có `supplier_id` trong khoá (chủ quán chốt 2026-10-19): "Thịt bò" của NCC A và của NCC B là
// HAI dòng riêng, một món được dùng cả hai — trước đó chúng bị gộp làm một và giá vốn lấy bình
// quân của mọi NCC. MySQL coi các NULL là KHÁC nhau trong UNIQUE, nên hai dòng "chưa chọn NCC"
// cùng nguyên liệu không bị DB chặn — `RecipesService.upsertLine` tự tra `IsNull()` để chặn.
@Index('idx_recipe_item_ingredient_ncc', ['menu_item_id', 'ingredient_id', 'supplier_id'], { unique: true })
@Index('idx_recipe_ingredient', ['ingredient_id'])
export class RecipeLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  menu_item_id!: string;

  @Column({ type: 'varchar', length: 36 })
  ingredient_id!: string;

  /** NCC của nguyên liệu này TRONG MÓN NÀY — giá vốn lấy giá lần nhập gần nhất của đúng NCC
   * đó (`supplier_items.last_unit_price_base`).
   *
   * `null` = chưa chọn NCC: dòng khai trước 2026-10-19 của nguyên liệu mua từ nhiều NCC. Dòng
   * đó giữ cách tính cũ (bình quân mọi NCC) và màn Công thức hiện nhãn "chưa chọn NCC". Nguyên
   * liệu chỉ có MỘT NCC thì `IngredientsModule.onModuleInit` tự gắn, không bắt ai chọn lại.
   *
   * KHÔNG dùng cho tồn kho / tiêu hao: kho vẫn tính theo nguyên liệu, gộp mọi NCC. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  supplier_id!: string | null;

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

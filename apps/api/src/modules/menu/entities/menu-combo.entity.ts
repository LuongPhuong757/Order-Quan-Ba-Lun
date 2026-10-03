// Combo gợi ý món (chủ quán chốt 2026-10-03) — nhân vật đồng hành ở thực đơn tại bàn dùng để
// mời món: khách thêm một món nằm trong combo thì CHỈ được mời các món khác của combo đó.
//
// ĐÂY KHÔNG PHẢI món "Combo" bán trong menu (nhóm "Combo" có giá riêng, vào bếp như món thường).
// Combo gợi ý không có giá, không giảm giá, không vào đơn — nó chỉ là bảng ghép món để mời.
//
// Chủ quán tự tạo ở màn admin (không fix trong code) để đổi combo cho đỡ nhàm. Câu thoại của
// nhân vật vẫn nằm trong code — chủ quán chốt chỉ config MÓN. Combo KHÔNG chia ô (món chính, đồ
// uống…) — chủ quán bỏ ý đó ngày 2026-10-03: combo chỉ là một danh sách món.
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('menu_combos')
export class MenuCombo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  emoji!: string | null;

  /**
   * Id các món trong combo. JSON chứ không phải bảng con: luôn đọc/ghi cả combo một lần, và món
   * bị xoá khỏi menu thì trang khách tự bỏ qua (không thấy id đó trong thực đơn) — khoá ngoại
   * không mua thêm được gì.
   */
  @Column({ type: 'json' })
  item_ids!: string[];

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

// Nhóm món (vd: 🍜 Món chính, 🥤 Đồ uống, 🥗 Phụ, 📦 Khác, hoặc owner thêm tuỳ ý)
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('menu_groups')
@Index('idx_menu_group_code', ['code'], { unique: true })
export class MenuGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16, unique: true })
  code!: string;          // 'food' | 'drink' | 'side' | 'other' | custom

  @Column({ type: 'varchar', length: 64 })
  name!: string;          // 'Món chính', 'Đồ uống', ...

  @Column({ type: 'varchar', length: 8, nullable: true })
  icon!: string | null;   // emoji '🍜' tuỳ chọn

  // 'cook' = bếp nấu (lửa nóng), 'ready-made' = lấy ngay (tủ lạnh, quầy)
  @Column({ type: 'varchar', length: 16, default: 'cook' })
  kitchen_type!: string;

  @Column({ type: 'int', default: 0 })
  sort_order!: number;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

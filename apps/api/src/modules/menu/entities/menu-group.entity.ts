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

  // Ẩn CẢ NHÓM khỏi web đặt hàng online (2026-08-04) — phủ lên mọi món trong nhóm,
  // kể cả món thêm vào sau; cờ `is_online_hidden` của TỪNG MÓN vẫn giữ giá trị riêng
  // (nhóm hiện lại thì món nào bị ẩn lẻ vẫn ẩn). POS không bị ảnh hưởng.
  @Column({ type: 'boolean', default: false })
  is_online_hidden!: boolean;

  // Ẩn CẢ NHÓM khỏi trang menu xem (2026-09-04). Song song với `is_online_hidden` nhưng
  // cho một mặt trận khác: nhóm có thể không bán online mà vẫn muốn in trong menu, và
  // ngược lại (vd nhóm "Combo nhân viên" bán online cho khách quen nhưng không khoe).
  // Cờ riêng của TỪNG MÓN giữ nguyên khi bật/tắt cờ này — giống hệt lệ của nhóm online.
  @Column({ type: 'boolean', default: false })
  is_menu_hidden!: boolean;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

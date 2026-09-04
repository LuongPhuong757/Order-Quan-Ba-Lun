import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('menu_items')
@Index('idx_menu_code', ['code'], { unique: true })
@Index('idx_menu_active_group', ['is_active', 'group'])
export class MenuItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 16 })
  group!: string;  // 'food' | 'drink' | 'side' | 'other'

  @Column({ type: 'int', unsigned: true })
  price!: number;  // VND, no decimals

  @Column({ type: 'varchar', length: 32 })
  unit!: string;  // 'phần', 'cốc', 'kg'

  @Column({ type: 'varchar', length: 512, nullable: true })
  image_url!: string | null;

  @Column({ type: 'boolean', default: false })
  is_out_of_stock!: boolean;

  // Ẩn khỏi WEB ĐẶT HÀNG ONLINE (2026-08-04) — khác 2 cờ kia:
  // - is_active=false: xoá mềm, biến mất MỌI NƠI (cả POS).
  // - is_out_of_stock=true: hết hàng tạm, trang khách VẪN THẤY (làm mờ), POS vẫn thấy.
  // - is_online_hidden=true: POS bán bình thường, nhưng trang khách KHÔNG THẤY và
  //   submit đơn online có món này bị chặn (tránh khách đặt món quán không bán online).
  @Column({ type: 'boolean', default: false })
  is_online_hidden!: boolean;

  // Ẩn khỏi TRANG MENU XEM (menu.<domain>, 2026-09-04) — cờ thứ tư, độc lập hoàn toàn
  // với 3 cờ trên. Trang menu xem là quyển menu điện tử để khách ngắm món, KHÔNG phải
  // web đặt hàng: món quán chỉ bán tại chỗ (không ship) vẫn phải khoe được ở đó.
  // Vì vậy `/api/public/menu-book` CỐ Ý bỏ qua `is_online_hidden` và chỉ đọc cờ này.
  @Column({ type: 'boolean', default: false })
  is_menu_hidden!: boolean;

  // Thứ tự món trong nhóm trên trang menu xem. Chủ quán kéo thả ở tab "Menu xem".
  // Mặc định 0 cho MỌI món cũ — khi cả nhóm cùng 0 thì truy vấn rơi về sắp theo tên,
  // tức là menu vẫn có thứ tự hợp lý ngay cả khi chưa ai vào kéo thả lần nào.
  @Column({ type: 'int', default: 0 })
  menu_sort_order!: number;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

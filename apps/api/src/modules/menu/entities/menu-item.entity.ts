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

  // ⚠ KHÔNG CÒN DÙNG từ 2026-09-15 (M4.D-36). Từng là cờ "ẩn khỏi quyển menu xem"
  // (2026-09-04); nay quyển menu hiện đúng danh sách POS, không đọc cờ này, và màn "Menu
  // xem" đã gỡ. CỘT VẪN GIỮ vì `synchronize: true` trên DB dev DÙNG CHUNG giữa các worktree:
  // bỏ khỏi entity ở nhánh này là DROP cột thật, nhánh khác còn đọc nó sẽ đổ "Unknown
  // column". Xoá cột là việc riêng, làm sau khi mọi nhánh đều không còn tham chiếu.
  @Column({ type: 'boolean', default: false })
  is_menu_hidden!: boolean;

  // ⚠ KHÔNG CÒN DÙNG từ 2026-09-15 (M4.D-36). Từng là thứ tự kéo thả trên quyển menu xem;
  // nay quyển menu sắp món theo tên y như POS. Giữ cột cùng lý do với `is_menu_hidden` ngay trên.
  @Column({ type: 'int', default: 0 })
  menu_sort_order!: number;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

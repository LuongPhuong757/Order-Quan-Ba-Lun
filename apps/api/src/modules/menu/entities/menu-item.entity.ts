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

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

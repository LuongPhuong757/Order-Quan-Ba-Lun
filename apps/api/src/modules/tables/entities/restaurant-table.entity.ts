import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('restaurant_tables')
@Index('idx_table_code', ['code'], { unique: true })
export class RestaurantTable {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'varchar', length: 16, default: 'dine-in' })
  kind!: string;  // 'dine-in' | 'takeaway' | 'delivery'

  @Column({ type: 'int', default: 0 })
  x!: number;

  @Column({ type: 'int', default: 0 })
  y!: number;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  // Đánh dấu bàn đang được order qua KiotViet (POS ngoài). Khi true → hệ thống
  // này CHẶN tạo/mở đơn trên bàn để tránh 1 bàn dùng 2 hệ thống cùng lúc.
  @Column({ type: 'boolean', default: false })
  kiotviet_locked!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

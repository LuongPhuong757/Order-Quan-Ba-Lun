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

  // KHÔNG CÒN DÙNG (2026-11-09): từng đánh dấu bàn đang order qua KiotViet và chặn tạo đơn. Chức
  // năng đã bỏ hẳn; cột GIỮ trong entity vì `synchronize` sẽ DROP cột nào không khai — DB dev dùng
  // chung giữa các worktree, nhánh cũ còn đọc cột này thì vỡ. Không code nào đọc/ghi nó nữa.
  @Column({ type: 'boolean', default: false })
  kiotviet_locked!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

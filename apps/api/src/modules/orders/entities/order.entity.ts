import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';
import { OrderItem } from './order-item.entity.js';

@Entity('orders')
@Index('idx_orders_table', ['table_id', 'closed_at'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  table_id!: string;

  @Column({ type: 'varchar', length: 16 })
  table_code!: string;  // snapshot to survive table rename

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  opened_at!: number;

  /** Thời điểm lần đầu báo bếp (PENDING → KITCHEN cho 1 item bất kỳ).
   * Null nếu order chưa từng báo bếp (vẫn còn PENDING hết).
   * Dùng để hiển thị thời gian "vào bàn" trên sơ đồ.
   */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  first_kitchen_at!: number | null;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  closed_at!: number | null;

  @Column({ type: 'boolean', default: false })
  is_paid!: boolean;

  /** Thông tin khách hàng — chỉ dùng cho bàn 'delivery' (ship).
   * NULL với dine-in / takeaway. Bắt buộc nhập khi staff mở order của bàn ship. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  customer_name!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_address!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  customer_phone!: string | null;

  /** Snapshot tên nhân viên đầu tiên mở order — dùng cho drawer header.
   * Lưu khi getOrCreateOpenOrder lần đầu, không update về sau. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  created_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  created_by_full_name!: string | null;

  /** Snapshot nhân viên thanh toán — set tại checkout, dùng cho lịch sử. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  checked_out_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  checked_out_by_full_name!: string | null;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;

  @OneToMany(() => OrderItem, (oi) => oi.order)
  items?: Relation<OrderItem[]>;
}

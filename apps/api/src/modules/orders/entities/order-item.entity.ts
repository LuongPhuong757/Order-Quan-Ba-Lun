import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type Relation,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';
import { Order } from './order.entity.js';

@Entity('order_items')
@Index('idx_orderitem_order', ['order_id'])
@Index('idx_orderitem_state', ['state', 'updated_at'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  order_id!: string;

  @ManyToOne(() => Order, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order?: Relation<Order>;

  @Column({ type: 'varchar', length: 36 })
  menu_item_id!: string;

  @Column({ type: 'varchar', length: 128 })
  menu_item_name!: string;  // snapshot

  @Column({ type: 'int', unsigned: true })
  menu_item_price!: number;  // snapshot, VND

  @Column({ type: 'int', unsigned: true })
  qty!: number;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  state!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancelled_reason!: string | null;

  /** Snapshot ai gọi món này — không FK để tránh cascade khi user bị xoá.
   * Hiển thị trên màn Bếp + drawer chi tiết để biết tìm ai khi có vấn đề. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  created_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  created_by_full_name!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

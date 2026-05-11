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

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  closed_at!: number | null;

  @Column({ type: 'boolean', default: false })
  is_paid!: boolean;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;

  @OneToMany(() => OrderItem, (oi) => oi.order)
  items?: Relation<OrderItem[]>;
}

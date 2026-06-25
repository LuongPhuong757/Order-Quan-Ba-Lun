// Log hoạt động theo từng đơn — ghi câu tiếng Việt sẵn để hiển thị.
// Mỗi dòng snapshot table_code + order_opened_at để phân biệt nhiều lịch sử
// trên cùng 1 bàn (1 bàn dùng đi dùng lại nhiều lần). Immutable: chỉ insert.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('order_activity_logs')
@Index('idx_oalog_order', ['order_id', 'created_at'])
@Index('idx_oalog_table', ['table_id', 'created_at'])
export class OrderActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  order_id!: string;

  // Món liên quan (nếu có) — vd huỷ món.
  @Column({ type: 'varchar', length: 36, nullable: true })
  item_id!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  table_id!: string | null;

  // Snapshot mã bàn + thời gian mở đơn → unique hoá lịch sử theo đơn.
  @Column({ type: 'varchar', length: 16 })
  table_code!: string;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  order_opened_at!: number | null;

  // 'order_created' | 'items_added' | 'item_cancelled' | 'transfer' | 'checkout' | 'order_cancelled'
  @Column({ type: 'varchar', length: 32 })
  event_kind!: string;

  // Câu tiếng Việt hoàn chỉnh để FE hiển thị thẳng.
  @Column({ type: 'varchar', length: 512 })
  message!: string;

  // Ai thực hiện (snapshot).
  @Column({ type: 'varchar', length: 36, nullable: true })
  actor_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  actor_name!: string | null;

  // Vừa là thời điểm sự kiện, vừa là key để cron dọn theo retention.
  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

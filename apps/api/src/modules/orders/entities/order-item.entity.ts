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

  /** NULL với dòng ghi chú (is_note=true) — ghi chú không trỏ tới món nào trong menu. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  menu_item_id!: string | null;

  @Column({ type: 'varchar', length: 128 })
  menu_item_name!: string;  // snapshot; với ghi chú thì đây là nội dung ghi chú

  @Column({ type: 'int', unsigned: true })
  menu_item_price!: number;  // snapshot, VND; ghi chú luôn 0

  /** GHI CHÚ CHO BẾP ("lấy bát cho khách", "nước mắm"...) — là 1 dòng item bình
   * thường để dùng lại nguyên vòng đời: bồi bàn báo bếp, bếp chuyển trạng thái,
   * đánh dấu đã giao. Khác món thật ở chỗ: giá 0, không có menu_item_id, và bị
   * loại khỏi báo cáo "top món bán chạy" (nó không phải hàng bán). */
  @Column({ type: 'boolean', default: false })
  is_note!: boolean;

  @Column({ type: 'int', unsigned: true })
  qty!: number;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  state!: string;

  /** Cờ ưu tiên nấu trước — set bởi Order/Admin khi khách sắp về.
   * Auto-clear khi state → COOKING (bếp đã bắt đầu nấu = priority đã hoàn thành).
   * KitchenPage sort: priority items lên đầu, trong nhóm priority sort theo created_at. */
  @Column({ type: 'boolean', default: false })
  is_priority!: boolean;

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

  /** Snapshot ai đánh dấu SERVED (bếp hoặc bồi bàn). Set tại changeItemState
   * khi state chuyển sang SERVED. Dùng cho notification 'ai giao món'. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  served_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  served_by_full_name!: string | null;

  /** Snapshot ai huỷ món (CANCELLED). Set khi changeItemState → CANCELLED hoặc
   * auto-cancel từ toggleStock. Phân biệt manual cancel vs bếp báo hết qua reason. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  cancelled_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  cancelled_by_full_name!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

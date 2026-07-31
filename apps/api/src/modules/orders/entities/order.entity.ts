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

  /** Phase 9 (§4.5). CHỈ THÊM cột. `synchronize: true`, không migration — rename bất kỳ
   * cột nào ở đây về sau là mất dữ liệu im lặng (C-SCHEMA-07). */
  @Column({ type: 'varchar', length: 16, default: 'STAFF' })
  source!: string; // 'STAFF' | 'ONLINE'

  @Column({ type: 'varchar', length: 16, nullable: true })
  fulfillment_type!: string | null; // 'PICKUP' | 'DELIVERY' | null (null = dine-in)

  @Column({ type: 'varchar', length: 36, nullable: true })
  @Index()
  online_request_id!: string | null; // trỏ ngược online_order_requests.id

  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index({ unique: true })
  order_token!: string | null; // copy từ request để /o/<token> đọc được order thật sau khi duyệt

  // MySQL trả decimal dạng STRING qua mysql2 — khai type TS là `string | null`, giống
  // online-order-request.entity.ts.
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  customer_lat!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  customer_lng!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  customer_map_link!: string | null;

  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  distance_km!: string | null;

  // M2.D-62: KHÔNG vào doanh thu món; `PAID_SQL` ở orders.service.ts tính tiền từ order_items
  // nên mặc định 0 tự động vô hại với đơn tại quán.
  @Column({ type: 'int', default: 0 })
  ship_fee!: number;

  // M2.D-58, chỗ ngỏ cho chuyển khoản sau này.
  @Column({ type: 'varchar', length: 16, default: 'CASH' })
  payment_method!: string;

  @OneToMany(() => OrderItem, (oi) => oi.order)
  items?: Relation<OrderItem[]>;
}

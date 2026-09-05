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

  /** ── 2 mốc chặng giao hàng (thiết kế 2026-08-04) ──────────────────────────
   *
   * CHỌN MỐC THỜI GIAN, KHÔNG CHỌN CỘT STATUS. Lý do:
   * - Mốc thời gian ĐƠN ĐIỆU bẩm sinh: set rồi không unset. Đúng thứ M2.D-19 ("% không bao giờ
   *   tụt") cần, và không cần code nào canh giữ tính đơn điệu.
   * - Đo được THỜI LƯỢNG (`ready→ship`, `ship→nhận`). Phase 10 cần đúng loại số này; một cột
   *   status không cho biết bao lâu.
   * - Một cột `fulfillment_status` sẽ là NGUỒN SỰ THẬT THỨ HAI cạnh `order_items.state` và phải
   *   đồng bộ ở mọi lần đổi state — đúng loại lệch mà `OVERRIDE-DEBT.md` ghi lại suốt.
   *
   * CHỈ THÊM CỘT (C-SCHEMA-07: `synchronize: true`, không migration). Không đụng `varchar` nào
   * đang có nên không lặp lại cái `ALTER TABLE` trên bảng có dữ liệu ở 09-11.
   *
   * Trạng thái suy diễn từ 2 mốc này nằm ở `public/order-progress.ts` — KHÔNG suy diễn lại ở
   * chỗ khác.
   */

  /** Shipper rời quán. LUÔN NULL với PICKUP và dine-in — guard ở `markShipped()`. */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  shipped_at!: number | null;

  /** Khách đã cầm hàng: DELIVERY = khách nhận, PICKUP = khách đến lấy.
   *
   * ⚠ KHÔNG phải "đã thu tiền" và KHÔNG đóng đơn. Chủ dự án chốt 2026-08-04: bàn giữ tới khi thu
   * tiền, nên `closed_at`/`is_paid` vẫn đi theo luồng checkout. Với COD, khách nhận hàng và quán
   * thu được tiền có thể lệch nhau vài tiếng — 2 mốc riêng biệt là cố ý.
   *
   * Với PICKUP mốc này GHI ĐÈ M2.D-15 (LOCKED: "PICKUP hoàn tất ở READY, không cần SERVED") —
   * xem `OVERRIDE-DEBT.md` OD-19. */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  received_at!: number | null;

  /** ── ĐỐI SOÁT MISA (amis.misa.vn) — chốt 2026-09-05 ──────────────────────
   *
   * Quán gõ tay đơn sang AMIS MISA để làm kế toán. Hệ thống này KHÔNG đẩy dữ liệu sang
   * MISA (giai đoạn 1), chỉ ghi nhận "đơn này đã sao chép sang chưa" để cuối ca lọc ra
   * đơn còn sót.
   *
   * CỜ ĐẶT Ở ĐƠN, KHÔNG ĐẶT Ở BÀN. Một bàn trong ngày có nhiều lượt khách; cờ ở
   * `restaurant_tables` (như `kiotviet_locked`) sẽ bị lượt sau ghi đè lên lượt trước và
   * không còn vết nào để đối soát.
   *
   * CHỈ THÊM CỘT (C-SCHEMA-07: `synchronize: true`, không migration).
   */

  /** NULL = chưa sao chép sang MISA. Set tại checkout (thu ngân tick) hoặc bù sau ở màn
   * Lịch sử. Bỏ tick thì về NULL — tick nhầm bàn phải sửa lại được. */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  misa_copied_at!: number | null;

  /** Snapshot ai gõ sang MISA — cùng lệ snapshot với `checked_out_by_*`. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  misa_copied_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  misa_copied_by_full_name!: string | null;

  /** Số chứng từ bên MISA, nhập tay nếu cần đối soát ngược.
   *
   * CHỖ NGỎ CHO GIAI ĐOẠN 2: khi nối API AMIS, chính cột này giữ id chứng từ MISA trả về
   * — luồng tự động dùng lại cột sẵn có, không phải đổi schema lần nữa. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  misa_ref!: string | null;

  @OneToMany(() => OrderItem, (oi) => oi.order)
  items?: Relation<OrderItem[]>;
}

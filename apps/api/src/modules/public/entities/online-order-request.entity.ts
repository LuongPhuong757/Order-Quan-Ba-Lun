import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

// Hàng chờ đơn online, đúng §4.2 spec (docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md).
//
// Bảng này là hàng chờ TRƯỚC KHI thành `orders` thật — M2.D-01: đơn ở trạng thái WAITING
// KHÔNG được xuất hiện ở bếp / sơ đồ bàn / doanh thu. Khi admin duyệt (phase 9), 1 dòng
// `orders` mới được tạo và `order_id` ở đây được set để nối 2 bảng.
//
// C-SCHEMA-07: `synchronize: true`, không migration — tên cột đã chốt theo §4.2, KHÔNG rename
// cột này về sau (rename = mất dữ liệu im lặng).
export type OnlineOrderItemSnapshot = {
  menu_item_id: string;
  code: string;
  name: string;
  unit_price: number;
  qty: number;
  note: string | null;
};

@Entity('online_order_requests')
@Index('idx_oor_token', ['order_token'], { unique: true })
@Index('idx_oor_status_submitted', ['status', 'submitted_at'])
@Index('idx_oor_phone_status', ['customer_phone', 'status'])
@Index('idx_oor_phone_submitted', ['customer_phone', 'submitted_at'])
@Index('idx_oor_customer_token', ['customer_token'])
export class OnlineOrderRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // URL /o/<token> — random 32 byte hex, sinh ở BE lúc submit.
  @Column({ type: 'varchar', length: 64 })
  order_token!: string;

  // Token thiết bị (localStorage), sinh 100% client-side (M2.D-09) — không round-trip BE.
  @Column({ type: 'varchar', length: 64 })
  customer_token!: string;

  // WAITING | CONFIRMED | REJECTED | CANCELLED_BY_CUSTOMER
  //
  // ⚠ `length` PHẢI ≥ 21: `CANCELLED_BY_CUSTOMER` dài đúng 21 ký tự. Cột này ra đời ở phase 8 với
  // `length: 16` — đủ cho 3 giá trị đầu, nên không ai phát hiện; giá trị thứ tư chỉ có đường tạo
  // ra từ phase 9 (plan 09-11, khách tự huỷ) và lúc đó MySQL trả thẳng
  // `Data too long for column 'status'`. Đừng thu hẹp lại.
  @Column({ type: 'varchar', length: 32 })
  status!: string;

  // PICKUP | DELIVERY
  @Column({ type: 'varchar', length: 16 })
  fulfillment_type!: string;

  @Column({ type: 'varchar', length: 128 })
  customer_name!: string;

  @Column({ type: 'varchar', length: 16 })
  customer_phone!: string;

  // NULL khi PICKUP.
  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_address!: string | null;

  // MySQL trả decimal dạng STRING qua mysql2 (không tự ép number) — khai type TS là
  // `string | null`, KHÔNG khai `number` rồi tin sai.
  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  customer_lat!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  customer_lng!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  customer_map_link!: string | null;

  // Haversine × distance_factor. Cùng lý do decimal → string như trên.
  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  distance_km!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  customer_note!: string | null;

  // [{menu_item_id, code, name, unit_price, qty, note}] — snapshot giá tại submit (M2.D-42),
  // BE tự lookup giá từ menu_item, KHÔNG bao giờ tin giá do client gửi lên.
  @Column({ type: 'json' })
  items_snapshot!: OnlineOrderItemSnapshot[];

  // VND, không thập phân — khớp menu_items.price.
  @Column({ type: 'int', unsigned: true })
  subtotal!: number;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  submitted_at!: number;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  reviewed_at!: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  reviewed_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  reviewed_by_full_name!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reject_reason!: string | null;

  // D-09 — ghi chú tự do của admin khi từ chối. CHỈ lưu DB + audit log. TUYỆT ĐỐI không
  // đưa vào `PublicOrderStatus` hay bất kỳ response `/api/public/*` nào; `reject_reason`
  // (câu soạn sẵn) mới là thứ khách đọc.
  @Column({ type: 'varchar', length: 500, nullable: true })
  internal_reject_note!: string | null;

  // Lúc KHÁCH tự huỷ (M2.D-44, phase 9 plan 09-11). Cột riêng chứ không dùng chung
  // `reviewed_at`: `reviewed_at` là mốc NHÂN VIÊN xử lý đơn và đi kèm `reviewed_by_*`. Nhét
  // hành động của khách vào đó là làm hỏng mọi câu hỏi "ai đã xử lý đơn này, lúc nào".
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  cancelled_at!: number | null;

  // FK → orders.id, set khi CONFIRMED (phase 9).
  @Column({ type: 'varchar', length: 36, nullable: true })
  order_id!: string | null;

  // % đã hiện cho khách, đảm bảo đơn điệu (M2.D-19) — dùng ở phase 9, tạo cột ngay để không
  // phải sửa schema lần hai.
  @Column({ type: 'int', default: 0 })
  max_progress_shown!: number;

  // HMAC hash của IP (M2.D-56) — 64 hex của HMAC-SHA256. KHÔNG BAO GIỜ lưu IP thô.
  @Column({ type: 'varchar', length: 64 })
  ip_hash!: string;

  @Column({ type: 'varchar', length: 255 })
  user_agent!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

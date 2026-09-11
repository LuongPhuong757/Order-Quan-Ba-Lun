import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';
import type { OnlineOrderItemSnapshot } from './online-order-request.entity.js';

/**
 * Giỏ hàng khách tự chọn tại bàn qua QR, chờ nhân viên gõ mã (M4.D-24,
 * docs/MILESTONE-04-QR-DINE-IN-SPEC.md §5.2).
 *
 * ── Vì sao KHÔNG dùng lại `online_order_requests` ──
 * Bảng đó bắt buộc `customer_name`/`customer_phone`, `fulfillment_type` chỉ có PICKUP|DELIVERY,
 * và là nguồn của màn Đơn Online + toàn bộ thống kê online. Nhét giỏ tại bàn vào đó là phải nới
 * NOT NULL và thêm điều kiện lọc trừ ở MỌI query online đang chạy ổn định — quên một chỗ là báo
 * cáo online sai âm thầm, loại lỗi không ai phát hiện cho tới lúc đối chiếu doanh thu.
 *
 * ── Bảng này KHÔNG có cột `status` ──
 * Bốn trạng thái (ACTIVE/USED/CANCELLED/EXPIRED) suy ra từ `used_at`, `cancelled_at`,
 * `expires_at`. Thêm cột enum song song với các mốc thời gian là hẹn một ca hai nguồn lệch nhau
 * mà không có luật nào nói bên nào đúng. Hàm suy trạng thái duy nhất: `dineInCartState()` ở
 * `dine-in-code.ts`.
 *
 * C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau (rename = mất
 * dữ liệu im lặng).
 */
@Entity('dine_in_carts')
// Tra mã lúc nhân viên gõ: luôn kèm điều kiện thời gian/đã dùng, nên index gộp cả 3 cột.
// KHÔNG unique trên `code` — theo M4.D-14 mã chỉ unique trong tập CÒN HIỆU LỰC, hết hạn thì
// số đó được cấp lại. Unique tuyệt đối là tự giới hạn hệ thống ở 10.000 giỏ trong cả đời.
@Index('idx_dic_code_live', ['code', 'used_at', 'expires_at'])
@Index('idx_dic_token_created', ['customer_token', 'created_at'])
@Index('idx_dic_expires', ['expires_at'])
export class DineInCart {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 5 chữ số, chữ số cuối là số kiểm tra Luhn (M4.D-04). `varchar(8)` để còn chỗ nếu sau này
   * đổi độ dài — nhưng đổi độ dài là đổi hợp đồng với nhân viên, không làm âm thầm. */
  @Column({ type: 'varchar', length: 8 })
  code!: string;

  /** Cùng shape `OnlineOrderItemSnapshot` để dùng lại mapper của luồng online. Giá trong này
   * là giá lúc SINH MÃ — không phải giá sẽ tính. Giá tính là giá menu lúc nhân viên xác nhận
   * (M4.D-20); preview đối chiếu hai con số và cảnh báo chỗ lệch. */
  @Column({ type: 'json' })
  items_snapshot!: OnlineOrderItemSnapshot[];

  /** VND, không thập phân — khớp `menu_items.price`. Tổng theo giá lúc sinh mã. */
  @Column({ type: 'int', unsigned: true })
  subtotal!: number;

  /** Token thiết bị (localStorage), sinh 100% client-side. Dùng cho rate-limit (M4.D-26) và
   * kiểm quyền huỷ ở `DELETE` (M4.D-07). KHÔNG phải danh tính — giỏ tại bàn vô danh (M4.D-02). */
  @Column({ type: 'varchar', length: 64 })
  customer_token!: string;

  /** HMAC-SHA256 của IP (M2.D-56) — 64 hex. KHÔNG BAO GIỜ lưu IP thô. */
  @Column({ type: 'varchar', length: 64 })
  ip_hash!: string;

  @Column({ type: 'varchar', length: 255 })
  user_agent!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  /** `created_at + DINE_IN_CART_TTL_MS` (15 phút, M4.D-12). Lưu thành cột thay vì tính lại từ
   * `created_at`: đổi hằng số TTL về sau KHÔNG được làm thay đổi hạn của các mã đã phát. */
  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  expires_at!: number;

  /** Khách bấm "Sửa lại" (M4.D-07) — mã chết ngay, khách sinh mã mới. */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  cancelled_at!: number | null;

  /** Mốc nhân viên đổ giỏ vào đơn. Set là mã chết vĩnh viễn (M4.D-13). */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  used_at!: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  used_by_user_id!: string | null;

  /** Snapshot tên, không FK: câu báo "Mã đã dùng lúc 19:42 bởi Hà, bàn 5" (M4.D-13) phải đọc
   * được cả sau khi nhân viên đó bị xoá khỏi hệ thống. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  used_by_full_name!: string | null;

  /** Snapshot mã bàn đã nhận giỏ — cùng lý do snapshot như `orders.table_code`. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  used_table_code!: string | null;

  /** FK → orders.id, set cùng `used_at`. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  order_id!: string | null;
}

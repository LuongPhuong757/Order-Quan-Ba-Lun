import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * M7 — một LƯỢT GỌI của khách đang chờ nhân viên duyệt (2026-10-01).
 *
 * ── Vì sao bảng riêng, KHÔNG thêm state vào `order_items` ──
 * Ba lý do, theo thứ tự sức nặng (xem §3.3 của spec):
 *
 * 1. GIÁ. State mới hay cột cờ trên `order_items` đều buộc phải chèn dòng ngay lúc khách gửi,
 *    mà `order_items.menu_item_price` là NOT NULL. Hoặc ghi giá lúc gửi — phá M7.D-11 (giá
 *    chốt lúc nhân viên duyệt) — hoặc ghi 0 rồi sửa lúc duyệt, tức để một dòng tiền SAI nằm
 *    sẵn trong bảng tiền, chờ một câu SUM nào đó đọc trúng.
 * 2. DIỆN ẢNH HƯỞNG. Thêm state buộc sửa song song: `ALLOWED_TRANSITIONS` ở hai chỗ, bản sao
 *    thủ công trong `OrderDrawer.tsx`, `HAS_ALIVE_ITEMS_SQL` (bàn sẽ sáng "đang dùng" vì một
 *    lượt chưa ai duyệt), `computeCheckoutTotals`, `COOKED_STATES` của trừ kho, mọi báo cáo
 *    đếm theo state. Mỗi chỗ bỏ sót là một lỗi IM LẶNG về tiền hoặc về kho.
 * 3. NGỮ NGHĨA. `PENDING` nghĩa là "nhân viên đã gọi, chưa báo bếp". Lượt khách gửi là thứ
 *    khác hẳn: CHƯA AI CHẤP NHẬN NÓ.
 *
 * Giá phải trả đã chấp nhận: duyệt = tạo dòng mới, nên `order_items.created_at` là giờ DUYỆT
 * chứ không phải giờ khách gửi. Giờ khách gửi nằm ở `created_at` của bảng này — và đúng hơn
 * cho màn bếp, vì bếp đo thời gian từ lúc món được NHẬN.
 *
 * C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau.
 */
@Entity('table_order_requests')
@Index('idx_tor_order', ['order_id'])
/** Chống gửi trùng (M7 §3.4 chống đua điểm 3): khách bấm hai lần hoặc mạng retry thì đụng
 *  unique này, và tầng service TRẢ LẠI `request_id` cũ với HTTP 200 — không phải 409. */
@Index('uq_tor_client', ['order_id', 'client_request_id'], { unique: true })
/** Màn bếp poll mỗi 2 giây để lấy lượt đang chờ — index này là thứ giữ nó rẻ. */
@Index('idx_tor_waiting', ['status', 'created_at'])
export class TableOrderRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  order_id!: string;

  @Column({ type: 'varchar', length: 36 })
  guest_session_id!: string;

  /** Snapshot để thẻ duyệt ở màn bếp vẫn in đúng bàn kể cả khi bàn bị đổi tên sau đó. */
  @Column({ type: 'varchar', length: 16 })
  table_code!: string;

  /** FE sinh, bắt buộc đúng dạng UUID v4 (server validate). Ép format để không ai nhận chuỗi
   * rỗng/cố định làm giá trị hợp lệ — khi đó mọi lượt sau bị âm thầm nuốt, trông y hệt bug. */
  @Column({ type: 'varchar', length: 64 })
  client_request_id!: string;

  /** 'WAITING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'. Để varchar thay vì enum theo lệ của repo
   * (`order_items.state` cũng là varchar) — enum MySQL đổi giá trị là ALTER cả bảng. */
  @Column({ type: 'varchar', length: 16, default: 'WAITING' })
  status!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  decided_at!: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  decided_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  decided_by_full_name!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  decided_reason!: string | null;
}

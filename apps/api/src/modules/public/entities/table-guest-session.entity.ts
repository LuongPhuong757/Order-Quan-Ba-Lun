import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * M7 — phiên thiết bị của khách tự gọi món tại bàn (2026-10-01).
 *
 * ── Vì sao mỗi thiết bị một token, thay vì dùng thẳng mã bàn 4 số ──
 * Mã bàn là bí mật CHIA SẺ MIỆNG: nó hiện to giữa màn hình khách, cả bàn cùng biết, ai đi
 * ngang cũng đọc được. Dùng nó làm credential cho mọi request sau đó là nhân bội cơ hội rò,
 * lại không revoke được một thiết bị quậy và không truy được lượt gọi nào từ máy nào. Nên mã
 * chỉ dùng ĐÚNG MỘT LẦN lúc vào bàn, đổi lấy `token` riêng cho từng máy.
 *
 * Token là credential — cùng cỡ 32 byte hex với `order_token` và `customer_sessions.token`,
 * sinh ở BE bằng CSPRNG (`randomBytes(32).toString('hex')`). KHÔNG `Math.random`, KHÔNG uuid.
 *
 * ── Vì sao không cần cron để mã chết đúng lúc ──
 * Phiên hợp lệ ⇔ chưa revoke ∧ chưa hết hạn ∧ (chưa gắn đơn ∨ đơn đó còn mở) — xem
 * `table-session.ts`. Nhánh cuối khiến THANH TOÁN XONG là mọi thiết bị của bàn rụng cùng lúc,
 * không phải xoá dòng nào.
 *
 * ⚠ M7.R11 — `expires_at` chỉ làm phiên HẾT HIỆU LỰC khi truy vấn, nó KHÔNG xoá dòng. Phải có
 *   cron dọn phiên hết hạn chưa gắn đơn, nếu không bảng phình mãi (xem index `idx_tgs_expires`).
 *
 * C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau.
 */
@Entity('table_guest_sessions')
@Index('idx_tgs_token', ['token'], { unique: true })
@Index('idx_tgs_table', ['table_id'])
@Index('idx_tgs_order', ['order_id'])
@Index('idx_tgs_expires', ['expires_at'])
export class TableGuestSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  token!: string;

  /** Bàn khách đã gõ. Gắn ngay từ lúc vào, trước khi có đơn nào. */
  @Column({ type: 'varchar', length: 36 })
  table_id!: string;

  /** Gắn LƯỜI: chỉ set khi khách gửi lượt gọi đầu tiên (M7.R1 — `/table/open` không tạo đơn,
   * nên quét QR gõ bừa 30 số bàn không sinh ra dòng `orders` nào). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  order_id!: string | null;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  expires_at!: number;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  last_used_at!: number;

  /** Set khi nhân viên bấm "Đổi mã" (M7 §3.11 ca 8) hoặc khi phiên bị thu hồi vì lý do khác. */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  revoked_at!: number | null;

  /** M2.D-56 — IP không bao giờ lưu thô. Dùng `hashIp()` của `ip-hash.ts` (HMAC có salt),
   * KHÔNG sha256 trần. Chỉ để truy vết, KHÔNG dùng để chặn. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip_hash!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

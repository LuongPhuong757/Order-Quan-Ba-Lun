// Thống kê truy cập trang khách (2026-08-05) — MỘT DÒNG / MỘT PHIÊN, không phải một dòng
// mỗi request. Đó là quyết định gốc của cả module: bảng phải nhỏ để trang admin query được
// bằng full scan trong vài chục ms, và để ghi bằng UPSERT gộp lô 10s (xem
// `analytics-collector.service.ts`) chứ không ghi đồng bộ trên đường request của khách.
//
// ⚠ KHÔNG thêm cột "mỗi lượt xem một dòng" vào bảng này. Lượt xem theo đường dẫn đã có bảng
// riêng đã gộp sẵn theo ngày (`web_page_views_daily`) — đúng thứ trang admin cần, mà vẫn giữ
// số dòng ở mức chục/ngày thay vì nghìn/ngày.
//
// ⚠ KHÔNG lưu IP thô (M2.D-56) — chỉ HMAC hash qua `hashIp()`. Cột `customer_phone` là SĐT
// khách đã tự nhập khi đặt đơn trước đó (đọc từ localStorage của chính họ), dùng để trả lời
// "phiên này có phải khách quen không"; nó KHÔNG phải bằng chứng nhận dạng (client gửi lên
// được nên giả mạo được) — mọi con số về "SĐT từng đặt đơn" phải lấy từ
// `online_order_requests`, không lấy từ bảng này.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigIntTransformer, dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('web_visit_sessions')
// UNIQUE là điều kiện SỐNG của luồng ghi: `INSERT ... ON DUPLICATE KEY UPDATE` chỉ gộp được
// nhiều ping của cùng một phiên khi `session_id` có unique index. Bỏ nó đi là biến mỗi ping
// thành một dòng mới.
@Index('idx_visit_session_id', ['session_id'], { unique: true })
@Index('idx_visit_first_seen', ['first_seen_ms'])
@Index('idx_visit_last_seen', ['last_seen_ms'])
export class WebVisitSession {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  // 32 ký tự hex sinh client-side bằng CSPRNG, sống trong sessionStorage → đóng tab là hết
  // phiên (khuôn `customer-token.ts` nhưng KHÁC khoá và KHÁC vòng đời: customer_token sống
  // mãi ở localStorage, session_id chỉ sống trong một lần mở tab).
  @Column({ type: 'varchar', length: 64 })
  session_id!: string;

  // 'shop' (trang khách) | 'admin' (trang quản lý). Hiện chỉ trang khách gửi ping — cột này
  // để số của nhân viên không bao giờ trộn vào số của khách nếu sau này bật thêm.
  @Column({ type: 'varchar', length: 8, default: 'shop' })
  app!: string;

  // Đồng hồ SERVER (không tin timestamp client gửi lên). Thời gian ở lại =
  // last_seen_ms - first_seen_ms.
  @Column({ type: 'bigint', transformer: bigIntTransformer })
  first_seen_ms!: number;

  @Column({ type: 'bigint', transformer: bigIntTransformer })
  last_seen_ms!: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  page_views!: number;

  @Column({ type: 'varchar', length: 128 })
  entry_path!: string;

  @Column({ type: 'varchar', length: 128 })
  last_path!: string;

  // CHỈ host (vd 'zalo.me', 'google.com') — không lưu full URL referrer để không kéo theo
  // query string của trang khác vào DB.
  @Column({ type: 'varchar', length: 128, nullable: true })
  referrer_host!: string | null;

  // 'mobile' | 'tablet' | 'desktop' | 'bot'
  @Column({ type: 'varchar', length: 8, default: 'desktop' })
  device!: string;

  @Column({ type: 'varchar', length: 64 })
  ip_hash!: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  customer_phone!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

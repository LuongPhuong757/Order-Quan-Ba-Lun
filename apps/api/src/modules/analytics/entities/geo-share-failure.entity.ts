// Từng LẦN HỎNG của nút "Chia sẻ vị trí" (2026-09-04) — một dòng mỗi cú bấm không thành công.
//
// ⚠ Đây là NGOẠI LỆ với luật "mọi bảng thống kê đều gộp sẵn, không lưu từng lượt" của module
// này (`web_visit_sessions`, `web_page_views_daily`, `geo_share_daily`). Lý do ngoại lệ:
//
//   - Bảng `geo_share_daily` trả lời được "hôm nay hỏng bao nhiêu lượt", nhưng KHÔNG trả lời
//     được "hỏng như thế nào". Câu hỏi thật của chủ quán là câu thứ hai: khách gọi điện báo
//     "bấm chia sẻ vị trí không được", cần biết ngay máy gì, trình duyệt gì, lỗi gì.
//   - Chi tiết đó TỪNG chỉ nằm ở log container, mà log chết mỗi lần `docker compose up --build`
//     — đúng lý do `geo_share_daily` ra đời, chỉ là lần trước mới cứu được con số chứ chưa cứu
//     được chi tiết.
//   - Bảng chỉ nhận HỎNG. Thành công là số đông (mong vậy) và không mang thông tin chẩn đoán —
//     ghi cả 'ok' vào đây là biến bảng chẩn đoán thành bảng theo dõi hành vi.
//
// KHÔNG lưu: IP, toạ độ, sid, user-agent thô. `device` + `browser` đã đủ trả lời "khách vào
// bằng gì" mà không giữ lại chuỗi nhận dạng được máy khách. UA thô vẫn đi ra log container như
// cũ cho ai cần soi sâu — xem `public-geo-log.controller.ts`.
//
// Chặn phình: cron 3h sáng xoá theo `GEO_FAILURE_RETENTION_DAYS` (mặc định 14) VÀ cắt còn
// `GEO_FAILURE_MAX_ROWS` dòng mới nhất (mặc định 1000). Cần cả hai vì throttle của endpoint là
// 30 lượt/phút/IP — một script spam trong ngày có thể đẻ hàng chục nghìn dòng trước khi cron
// kịp chạy, mốc ngày một mình không cứu được.
//
// C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau.
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigIntTransformer } from '../../auth/entities/user.entity.js';

@Entity('geo_share_failures')
// Màn admin luôn đọc "N lần gần nhất trong khoảng đang xem", cron xoá theo cùng cột.
@Index('idx_geo_fail_created', ['created_ms'])
export class GeoShareFailure {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  // Đồng hồ SERVER (không tin timestamp client) — cùng quy ước với `web_visit_sessions`.
  @Column({ type: 'bigint', transformer: bigIntTransformer })
  created_ms!: number;

  // 'denied' | 'unavailable' | 'timeout' | 'unsupported' — KHÔNG bao giờ là 'ok' (xem docblock).
  @Column({ type: 'varchar', length: 16 })
  outcome!: string;

  /** Mã thô của `GeolocationPositionError` (1 = denied, 2 = unavailable, 3 = timeout). */
  @Column({ type: 'int', unsigned: true, nullable: true })
  code!: number | null;

  /**
   * Chuỗi lỗi THÔ của trình duyệt, không diễn dịch. Đây là field giá trị nhất trên iOS:
   * "kCLErrorDomain error 0" (máy không bắt được tín hiệu) và "User denied Geolocation"
   * (quyền bị chặn) đều rơi vào cùng một `outcome` ở vài phiên bản Safari.
   */
  @Column({ type: 'varchar', length: 300, nullable: true })
  message!: string | null;

  /** Từ lúc bấm nút tới lúc trình duyệt trả lời — phân biệt "chặn ngay" (vài ms, quyền đã bị
   *  nhớ Deny) với "chờ mòn mỏi" (10s+, sóng/GPS yếu). */
  @Column({ type: 'int', unsigned: true, default: 0 })
  elapsed_ms!: number;

  /** 'mobile' | 'tablet' | 'desktop' | 'bot' — server tự phân loại từ UA (`classifyDevice`). */
  @Column({ type: 'varchar', length: 8, default: 'desktop' })
  device!: string;

  /** `classifyBrowser()` — 'zalo'/'facebook' là nghi phạm số một của "cái được cái không". */
  @Column({ type: 'varchar', length: 16, default: 'other' })
  browser!: string;

  /** Trang đang đứng lúc bấm ('/checkout' hay '/cart'). */
  @Column({ type: 'varchar', length: 128 })
  page!: string;

  /** Geolocation đòi secure context; `false` là tự giải thích được ngay vì sao hỏng. */
  @Column({ type: 'boolean', default: true })
  secure!: boolean;
}

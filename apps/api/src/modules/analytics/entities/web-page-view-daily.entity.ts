// Lượt xem theo đường dẫn, ĐÃ GỘP theo ngày (giờ VN) ngay lúc ghi — không lưu từng lượt.
// 7 route × 1 dòng/ngày ≈ 210 dòng/tháng, nên câu "top trang" ở màn admin luôn là scan bảng
// bé, kể cả khi lượt truy cập thật tăng gấp trăm lần.
//
// `day_key` là chuỗi 'YYYY-MM-DD' theo giờ VN (UTC+7) do app tính (`dayKeyIct()`), KHÔNG dùng
// hàm timezone của MySQL: connection đang ép `timezone: 'Z'` (data-source.ts) nên mọi hàm
// ngày/tháng trong SQL đều trả theo UTC — gộp theo đó thì "ngày" bị cắt lúc 7h sáng VN.
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('web_page_views_daily')
// UNIQUE (day_key, path) — điều kiện sống của `ON DUPLICATE KEY UPDATE views = views + …`.
@Index('idx_pv_daily_key', ['day_key', 'path'], { unique: true })
export class WebPageViewDaily {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'char', length: 10 })
  day_key!: string;

  @Column({ type: 'varchar', length: 128 })
  path!: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  views!: number;
}

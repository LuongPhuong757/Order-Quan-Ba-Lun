// Số lần khách bấm "Chia sẻ vị trí", ĐÃ GỘP theo ngày (giờ VN) + kết quả — không lưu từng lượt.
//
// Vì sao có bảng này (2026-08-30): `POST /api/public/geo-log` từ trước tới nay chỉ in một dòng ra
// log container. Log container CHẾT MỖI LẦN DEPLOY, mà dự án này deploy bằng `docker compose up
// --build` — nghĩa là số liệu chẩn đoán biến mất đúng vào lúc vừa sửa xong thứ cần đo. Muốn trả
// lời "sửa hôm qua có bớt lỗi không" thì con số phải nằm trong DB.
//
// 5 outcome × 1 dòng/ngày = tối đa 5 dòng/ngày, ~1.800 dòng/năm. Bé tới mức không cần buffer như
// `analytics-collector`: ghi thẳng, mỗi cú bấm một câu UPSERT.
//
// KHÔNG có gì nhận dạng khách ở đây — không IP, không sid, không toạ độ. Đây là bộ ĐẾM, còn chi
// tiết chẩn đoán (message thô của iOS, user-agent) vẫn chỉ đi ra log như cũ. Giữ vậy để bảng
// thống kê không lặng lẽ biến thành một bảng theo dõi người dùng.
//
// `day_key` là chuỗi 'YYYY-MM-DD' theo giờ VN do app tính (`dayKeyIct()`), KHÔNG dùng hàm timezone
// của MySQL: connection đang ép `timezone: 'Z'` nên mọi hàm ngày/tháng trong SQL trả theo UTC —
// gộp theo đó thì "ngày" bị cắt lúc 7h sáng VN, đúng giữa ca sáng.
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('geo_share_daily')
// UNIQUE (day_key, outcome) — điều kiện SỐNG của `ON DUPLICATE KEY UPDATE hits = hits + …`.
// Thiếu index này thì mỗi cú bấm đẻ một dòng mới và bảng phình theo lượt, không theo ngày.
@Index('idx_geo_share_daily_key', ['day_key', 'outcome'], { unique: true })
export class GeoShareDaily {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'char', length: 10 })
  day_key!: string;

  /** 'ok' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' — nhãn do client gửi, đã qua
   *  `@IsIn` ở controller nên không thể là chuỗi lạ. */
  @Column({ type: 'varchar', length: 16 })
  outcome!: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  hits!: number;
}

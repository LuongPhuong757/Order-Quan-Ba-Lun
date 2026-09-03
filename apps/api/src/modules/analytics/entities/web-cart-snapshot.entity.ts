// Ảnh chụp giỏ hàng đang treo trên máy khách (2026-09-03) — chỉ để trả lời ĐÚNG 2 câu:
// "bao nhiêu giỏ đang có món" và "tổng bao nhiêu món trong các giỏ đó".
//
// MỘT DÒNG / MỘT THIẾT BỊ, không phải một dòng mỗi lần giỏ đổi. Đó là quyết định gốc:
//   - Giỏ hàng của apps/shop sống 100% ở localStorage (`cart-store.ts`), BE không hề biết nó
//     tồn tại. Thống kê này là bản chụp GẦN NHẤT mà máy khách tự khai kèm theo ping truy cập
//     có sẵn (`POST /api/public/track`) — KHÔNG có request mới nào thêm vào đường đi của khách.
//   - Vì mỗi thiết bị chỉ một dòng, bảng này to bằng "số thiết bị từng thêm món", không phải
//     "số lần thêm món". Trang admin query được bằng full scan.
//
// ⚠ CỐ Ý chỉ có 4 cột dữ liệu. Bảng này KHÔNG lưu SĐT, KHÔNG lưu tiền, KHÔNG lưu món nào:
//   - SĐT: chốt tại yêu cầu 2026-09-03 là chỉ cần 2 con số, nên không có lý do lưu thêm một
//     bản sao SĐT khách ở bảng thứ ba. Muốn biết "ai đang treo giỏ" thì phải thêm cột lại —
//     và lúc đó phải đọc kỹ cảnh báo ở `web_visit_sessions.customer_phone` trước (SĐT do
//     client gửi lên KHÔNG phải bằng chứng nhận dạng).
//   - Tiền: đơn giá nằm ở localStorage của khách, sửa được bằng devtools. Hiện một con số
//     tiền giả lên màn admin tệ hơn không hiện gì.
//
// ⚠ `qty` do CLIENT gửi lên nên KHÔNG phải nguồn sự thật về đơn hàng — cùng hạng dữ liệu với
// `web_visit_sessions.customer_phone`. Mọi con số về đơn và doanh thu vẫn phải lấy từ
// `online_order_requests`. Bảng này chỉ để trả lời "giỏ đang treo".
//
// ⚠ Ghi theo luật MỚI-NHẤT-THẮNG (không phải min/max như `web_visit_sessions`): giỏ CO LẠI
// được (khách bớt món, đặt xong thì giỏ về 0). Gộp bằng GREATEST là số chỉ tăng không giảm,
// màn admin sẽ báo "đang có 300 món trong giỏ" trong khi mọi giỏ đã thành đơn từ hôm qua.
//
// C-SCHEMA-07: `synchronize: true`, không migration — KHÔNG rename cột về sau.
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigIntTransformer, dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('web_cart_snapshots')
// UNIQUE là điều kiện SỐNG của luồng ghi: `INSERT ... ON DUPLICATE KEY UPDATE` chỉ gộp được
// nhiều ping của cùng một thiết bị khi `cart_key` có unique index. Bỏ nó đi là biến mỗi ping
// thành một dòng mới và biến bảng "một dòng mỗi thiết bị" thành bảng log.
@Index('idx_cart_snap_key', ['cart_key'], { unique: true })
// Màn admin luôn lọc theo "còn tươi" (`updated_ms >= now - N giờ`), cron retention cũng xoá
// theo cột này.
@Index('idx_cart_snap_updated', ['updated_ms'])
export class WebCartSnapshot {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  // 32 ký tự hex sinh client-side bằng CSPRNG, sống ở localStorage cạnh chính giỏ hàng
  // (`CART_ID_KEY` trong `apps/shop/src/lib/cart-store.ts`) — cùng vòng đời với giỏ.
  //
  // Vì sao KHÔNG dùng lại khoá có sẵn:
  //   - `session_id` (analytics) ở sessionStorage → đóng tab là mất, mở lại là thiết bị mới:
  //     một người bỏ giỏ rồi mở web 5 lần sẽ đếm thành 5 giỏ.
  //   - `customer_token` chỉ được sinh lúc khách ĐẶT ĐƠN; dùng nó thì thống kê phải sinh token
  //     cho cả người chỉ xem thực đơn, tức là chạm vào dữ liệu của luồng đặt hàng.
  @Column({ type: 'varchar', length: 64 })
  cart_key!: string;

  // Tổng số lượng món trong giỏ. 0 = giỏ đã rỗng (khách đặt xong hoặc tự xoá) — dòng vẫn được
  // GIỮ với qty = 0 chứ không xoá, để lần ping sau còn chỗ cập nhật và để số "giỏ đang có món"
  // tụt xuống ngay khi khách đặt đơn.
  @Column({ type: 'int', unsigned: true, default: 0 })
  qty!: number;

  // 'mobile' | 'tablet' | 'desktop' | 'bot'. Giữ lại DÙ chỉ cần 2 con số, vì cả module này có
  // một quy ước duy nhất: mọi con số về khách ở màn admin đều lọc `device <> 'bot'`. Không có
  // cột này thì đúng 2 con số người dùng cần lại là 2 con số có thể bị máy quét làm phồng.
  @Column({ type: 'varchar', length: 8, default: 'desktop' })
  device!: string;

  // Đồng hồ SERVER của ping gần nhất (không tin timestamp client). Vừa là mốc "còn tươi" của
  // màn admin, vừa là mốc quyết định ping nào thắng khi gộp.
  @Column({ type: 'bigint', transformer: bigIntTransformer })
  updated_ms!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

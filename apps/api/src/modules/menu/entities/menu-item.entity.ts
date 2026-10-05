import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('menu_items')
@Index('idx_menu_code', ['code'], { unique: true })
// Thêm `name` vào đuôi index cũ `(is_active, group)`: câu mặc định của order picker / màn Bếp là
// `WHERE is_active ORDER BY group, name` — EXPLAIN 2026-09-14 báo `Using filesort` vì index cũ
// hết cột ở `group`. Có `name` thì đọc index ra là đã đúng thứ tự, bỏ được bước sắp xếp.
@Index('idx_menu_active_group_name', ['is_active', 'group', 'name'])
// Cho `GET /menu/version` (= MAX(updated_at) + COUNT): màn Bếp poll mốc này mỗi 2 giây thay
// cho cả 597 món. MAX trên cột có index là đọc đúng 1 dòng cuối, không quét bảng.
@Index('idx_menu_updated', ['updated_at'])
export class MenuItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 16 })
  group!: string;  // 'food' | 'drink' | 'side' | 'other'

  @Column({ type: 'int', unsigned: true })
  price!: number;  // VND, no decimals

  @Column({ type: 'varchar', length: 32 })
  unit!: string;  // 'phần', 'cốc', 'kg'

  @Column({ type: 'varchar', length: 512, nullable: true })
  image_url!: string | null;

  @Column({ type: 'boolean', default: false })
  is_out_of_stock!: boolean;

  // "Đang đẩy bán" (2026-10-05) — bếp/phục vụ bật ở màn Quản lý menu khi món ế: còn nhiều
  // nguyên liệu, nấu sẵn rồi, hoặc sắp hỏng nếu không bán hết ca. Món bật cờ này nổi lên một
  // dải ghim đầu màn Gọi món để nhân viên order mời khách trước.
  // KHÁC hẳn is_out_of_stock dù hai cờ đứng cạnh nhau: cờ kia CHẶN bán, cờ này THÚC bán.
  // Hai cờ loại trừ nhau — bật "hết món" thì toggle-stock tự tắt cờ này (mời khách món
  // không nấu được là tệ hơn không mời).
  // CỐ Ý không hiện cho khách (trang online + thực đơn QR tại bàn): khách đọc "món nên gọi"
  // thành "món ế" thì phản tác dụng. Mời món là việc của người phục vụ.
  @Column({ type: 'boolean', default: false })
  is_push_sale!: boolean;

  // Ẩn khỏi WEB ĐẶT HÀNG ONLINE (2026-08-04) — khác 2 cờ kia:
  // - is_active=false: xoá mềm, biến mất MỌI NƠI (cả POS).
  // - is_out_of_stock=true: hết hàng tạm, trang khách VẪN THẤY (làm mờ), POS vẫn thấy.
  // - is_online_hidden=true: POS bán bình thường, nhưng trang khách KHÔNG THẤY và
  //   submit đơn online có món này bị chặn (tránh khách đặt món quán không bán online).
  @Column({ type: 'boolean', default: false })
  is_online_hidden!: boolean;

  // Ẩn khỏi TRANG MENU XEM (menu.<domain>, 2026-09-04) — cờ thứ tư, độc lập hoàn toàn
  // với 3 cờ trên. Trang menu xem là quyển menu điện tử để khách ngắm món, KHÔNG phải
  // web đặt hàng: món quán chỉ bán tại chỗ (không ship) vẫn phải khoe được ở đó.
  // Vì vậy `/api/public/menu-book` CỐ Ý bỏ qua `is_online_hidden` và chỉ đọc cờ này.
  @Column({ type: 'boolean', default: false })
  is_menu_hidden!: boolean;

  // Thứ tự món trong nhóm trên trang menu xem. Chủ quán kéo thả ở tab "Menu xem".
  // Mặc định 0 cho MỌI món cũ — khi cả nhóm cùng 0 thì truy vấn rơi về sắp theo tên,
  // tức là menu vẫn có thứ tự hợp lý ngay cả khi chưa ai vào kéo thả lần nào.
  @Column({ type: 'int', default: 0 })
  menu_sort_order!: number;

  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

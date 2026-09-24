// Danh mục nguyên liệu — DÙNG CHUNG cho mọi món (chốt 2026-09-05).
//
// "Thịt bò" là MỘT dòng duy nhất ở đây, 10 món cùng trỏ vào qua `recipe_lines`. Nếu để tên
// nguyên liệu là chuỗi text nằm trong công thức từng món thì câu hỏi của chủ quán — "tháng này
// hết bao nhiêu thịt bò" — không trả lời được: mỗi món ghi một kiểu, không cộng lại được.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('ingredients')
@Index('idx_ingredient_name_key', ['name_key'], { unique: true })
export class Ingredient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Tên hiển thị, giữ nguyên chữ người dùng gõ: "Thịt bò", "Hành lá". */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** Tên đã chuẩn hoá (bỏ dấu, thường hoá, gộp khoảng trắng) — xem `normalizeName`.
   *
   * UNIQUE, và đây là lớp chặn trùng lặp TỰ ĐỘNG: gõ "Thịt Bò" hay "thit bo" khi nhập công thức
   * đều tra ra đúng dòng đang có thay vì tạo dòng thứ hai. Không có nó thì tính năng tự tạo
   * nguyên liệu sẽ sinh rác sau vài ngày và báo cáo tiêu hao thành vô nghĩa.
   */
  @Column({ type: 'varchar', length: 128 })
  name_key!: string;

  /** Đơn vị GỐC để lưu định lượng: 'g' | 'ml' | 'quả' | 'lá'... Mỗi nguyên liệu chỉ một đơn vị.
   *
   * Người nhập công thức vẫn gõ kg / lít thoải mái — `toBaseQty` quy về đơn vị này TRƯỚC khi
   * lưu. Cho phép hai đơn vị cùng tồn tại trong một cột là tự tạo hai thang đo. */
  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  /** Ghi chú tuỳ ý của chủ quán: "mua ở chợ đầu mối", "loại ba chỉ"... */
  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  /** Ngưỡng cảnh báo đổi giá RIÊNG cho mặt hàng này, tính bằng % (M3.D-23). NULL = dùng ngưỡng
   * chung 10% — xem `DEFAULT_WARN_PCT` trong `suppliers/purchase-units.ts`.
   *
   * Cố ý cho phép NULL và mặc định là NULL: bắt chủ quán gắn nhãn "giá cố định / giá thả nổi"
   * cho vài trăm mặt hàng TRƯỚC khi dùng được thì tính năng chết yểu. Nguyên tắc là khai báo
   * khi thấy đau — mặt hàng nào kêu quá nhiều thì mới vào nới ngưỡng riêng cho nó.
   *
   * `string` chứ không phải `number`: mysql2 trả decimal dạng chuỗi, giống `recipe_lines
   * .qty_per_serving` và `orders.distance_km`. Khai `number` thì `tsc` xanh mà runtime là chuỗi. */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  price_alert_threshold_pct!: string | null;

  /** Có khai thứ này vào công thức món không (M6.D-10, 2026-09-24).
   *
   * `false` = gia vị nhỏ: nước mắm, muối, tiêu, dầu ăn. Chúng VẪN nhập hàng, vẫn có công nợ,
   * vẫn được cảnh báo biến động giá — chỉ không hiện ra ở ô gợi ý của màn Công thức.
   *
   * Ranh giới (M6.D-12): thứ nào khi nấu KHÔNG ĐONG ĐẾM thì không khai. Nêm nếm theo tay thì
   * bỏ; cân, đếm, múc theo định lượng thì khai — nên nước dùng xương (múc theo tô) và sả, lá
   * chanh (đếm cây, đếm lá) vẫn khai dù nghe cũng "nhỏ".
   *
   * Mặc định `true` chứ không phải `false` (M6.D-11): thứ quên phân loại thì hiện ra trong công
   * thức — thấy được, sửa được. Mặc định ẩn thì người khai tìm mãi không thấy tôm đâu mà không
   * hiểu vì sao.
   *
   * Hệ quả bắt buộc: giá vốn tính ra LUÔN thiếu phần gia vị, nên mọi nhãn hiển thị phải nói rõ
   * "nguyên liệu chính" (M6.D-09) — ai nhìn con số này rồi tính lãi sẽ tính dư. */
  @Column({ type: 'boolean', default: true })
  track_in_recipe!: boolean;

  /** Xoá mềm, cùng lệ với `menu_items.is_active`.
   *
   * Nguyên liệu bị gộp đi cũng để `false` ở đây (không DELETE): các bản chốt tiêu hao trong quá
   * khứ đã snapshot tên riêng nên không hỏng, nhưng giữ dòng lại thì còn lần ra được vì sao
   * tháng trước có tên đó. */
  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  /** Trỏ tới nguyên liệu đã gộp vào, khi dòng này bị gộp. NULL với nguyên liệu bình thường.
   *
   * Chỉ để truy vết ("cái 'bò' hồi xưa giờ nằm ở đâu"); mọi truy vấn tiêu hao đều đi qua
   * `recipe_lines` đã được trỏ lại nên không đọc cột này. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  merged_into_id!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

// Một dòng hàng trong phiếu nhập (2026-09-05).
//
// Bảng này là NGUỒN DUY NHẤT cho cả ba báo cáo của milestone: biến động giá, thống kê mặt hàng
// nhập, và tổng mua theo kỳ. Vì vậy nó snapshot mọi thứ cần để đọc lại phiếu cũ mà không phải
// join sang bảng cấu hình hiện hành (M3.D-27) — sửa đơn vị hay giá hôm nay không được phép làm
// đổi báo cáo tháng trước.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('supplier_delivery_lines')
@Index('idx_delivery_line_delivery', ['delivery_id'])
// Index cho biến động giá + thống kê mặt hàng nhập: "lịch sử giá mặt hàng X của NCC Y".
@Index('idx_delivery_line_ingredient', ['ingredient_id'])
export class SupplierDeliveryLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  delivery_id!: string;

  @Column({ type: 'varchar', length: 36 })
  ingredient_id!: string;

  /** Snapshot tên + đơn vị GỐC của nguyên liệu lúc nhập (M3.D-27). Nguyên liệu bị gộp hay đổi
   * tên về sau thì phiếu cũ vẫn đọc lên đúng thứ đã nhận. */
  @Column({ type: 'varchar', length: 128 })
  ingredient_name_snapshot!: string;

  @Column({ type: 'varchar', length: 16 })
  unit_snapshot!: string;

  /** Đơn vị NCC báo lúc đó: "thùng", "kg", "bó" (M3.D-33). */
  @Column({ type: 'varchar', length: 32 })
  purchase_unit_snapshot!: string;

  /** Hệ số quy đổi ÁP DỤNG CHO PHIẾU NÀY (M3.D-37).
   *
   * Snapshot chứ không đọc từ `supplier_items`, vì NCC đổi cỡ đóng gói là chuyện có thật: thùng
   * 24 chai xuống 20 chai. Đọc hệ số hiện hành để tính lại phiếu cũ sẽ bịa ra một lịch sử giá
   * chưa từng xảy ra. */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  qty_base_per_unit_snapshot!: string;

  // ── Số NCC nói ────────────────────────────────────────────────────────────
  /** Số đơn vị mua: "5 thùng", "20 bó". */
  @Column({ type: 'decimal', precision: 12, scale: 3 })
  qty_purchase!: string;

  /** Đồng / đơn vị mua. */
  @Column({ type: 'int', unsigned: true })
  unit_price!: number;

  /** = qty_purchase × unit_price, VND. */
  @Column({ type: 'int', unsigned: true })
  amount!: number;

  // ── Số hệ thống tính (đẳng thức bất biến ở mục 5 của spec) ────────────────
  /** = qty_purchase × qty_base_per_unit_snapshot. Đây là con số đi vào tồn kho. */
  @Column({ type: 'decimal', precision: 16, scale: 3 })
  qty_base!: string;

  /** = unit_price ÷ qty_base_per_unit_snapshot, đồng / đơn vị gốc (M3.D-36).
   *
   * MỌI so sánh giá chạy trên cột này, không phải `unit_price`. Lần trước nhập theo kg, lần này
   * NCC báo theo thùng — so `unit_price` trực tiếp thì popup báo động sai hàng loạt và người
   * dùng sẽ tập quen bấm bừa. */
  @Column({ type: 'decimal', precision: 16, scale: 6 })
  unit_price_base!: string;

  // ── So với lần nhập trước ─────────────────────────────────────────────────
  /** Giá quy đổi của lần nhập gần nhất trước phiếu này. NULL = mặt hàng nhập lần đầu ở NCC này,
   * không có gì để so nên không cảnh báo (M3.D-25). */
  @Column({ type: 'decimal', precision: 16, scale: 6, nullable: true })
  prev_unit_price_base!: string | null;

  /** % thay đổi của `unit_price_base` so với lần trước. Lưu sẵn để màn biến động giá không phải
   * tính lại từ đầu mỗi lần mở. Âm = giảm giá. */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  price_change_pct!: string | null;

  /** Hệ số quy đổi lần trước — để phát hiện đổi cỡ đóng gói (M3.D-37).
   *
   * NCC giữ nguyên "180.000/thùng" nhưng rút thùng từ 24 xuống 20 chai là tăng thật 20%. Chỉ
   * canh `unit_price` thì không bao giờ thấy; so hai cột hệ số này thì thấy ngay. */
  @Column({ type: 'decimal', precision: 14, scale: 3, nullable: true })
  prev_qty_base_per_unit!: string | null;

  /** Ai bấm đồng ý cho mức giá mới ở popup (M3.D-21). NULL khi giá không lệch quá ngưỡng. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  price_approved_by_user_id!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

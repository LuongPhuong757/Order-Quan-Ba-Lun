// Cấu hình mặc định cho cặp (NCC, mặt hàng) — M3.D-18, 2026-09-05.
//
// KHÔNG phải bảng khai báo trước. Chủ quán không phải ngồi khai "NCC nào bán gì giá bao nhiêu";
// dòng ở đây TỰ SINH lần đầu nhập mặt hàng đó cho NCC đó, rồi mỗi lần nhập sau lại tự cập nhật.
// Tác dụng: lần nhập kế tiếp điền sẵn đơn vị mua + giá lần trước (M3.D-20), và popup cảnh báo có
// cái để so (M3.D-19).
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('supplier_items')
// Một cặp (NCC, mặt hàng) chỉ có ĐÚNG một dòng cấu hình. Hai dòng thì hai giá tham chiếu khác
// nhau cho cùng một thứ, và cảnh báo giá so vào dòng nào là chuyện hên xui.
@Index('idx_supplier_item', ['supplier_id', 'ingredient_id'], { unique: true })
@Index('idx_supplier_item_ingredient', ['ingredient_id'])
export class SupplierItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  supplier_id!: string;

  @Column({ type: 'varchar', length: 36 })
  ingredient_id!: string;

  /** Đơn vị NCC báo hàng: "thùng", "bao", "kg", "bó" (M3.D-33).
   *
   * CHUỖI TỰ DO, cố ý không dùng `parseUnit()`. NCC nói "1 thùng nước mắm" mà `parseUnit` chỉ
   * biết g/kg/ml/l + 11 đơn vị đếm — nhét "thùng" vào đó (phương án A) thì `toBaseQty` trả về số
   * vô nghĩa và báo cáo tiêu hao đứt gãy (M3.D-34). Đơn vị mua sống ở tầng nhập hàng, quy về đơn
   * vị gốc bằng `qty_base_per_unit` ngay dưới, không bao giờ đi vào tầng định lượng.
   */
  @Column({ type: 'varchar', length: 32 })
  purchase_unit!: string;

  /** 1 đơn vị mua = bao nhiêu đơn vị gốc của nguyên liệu (M3.D-35).
   *
   * "1 thùng = 12000" khi nguyên liệu đo bằng ml; "1 bao = 25000" khi đo bằng g; "1 bó = 1" khi
   * chính đơn vị mua đã là đơn vị gốc. decimal vì "1 khay = 0,5 kg" là chuyện thường. */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  qty_base_per_unit!: string;

  /** Giá lần gần nhất, đồng / ĐƠN VỊ MUA. Đây là con số NCC đọc lên ("180 nghìn một thùng") nên
   * dùng để điền sẵn ô nhập; int vì tiền Việt không có phần lẻ. */
  @Column({ type: 'int', unsigned: true })
  last_unit_price!: number;

  /** Giá lần gần nhất quy về đồng / ĐƠN VỊ GỐC (M3.D-36).
   *
   * ĐÂY mới là con số dùng để so sánh và cảnh báo — `last_unit_price` không so được vì đơn vị
   * mua có thể đổi giữa hai lần nhập (kg → thùng), và cỡ đóng gói cũng đổi được (M3.D-37).
   * decimal(16,6) vì 7.500đ/kg = 7,5 đ/g: làm tròn về int là mất ngay 1/15 giá trị. */
  @Column({ type: 'decimal', precision: 16, scale: 6 })
  last_unit_price_base!: string;

  /** Ngày của lần nhập gần nhất, dạng 'YYYY-MM-DD' — hiển thị "giá này từ hôm nào". */
  @Column({ type: 'date' })
  last_delivery_date!: string;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;
}

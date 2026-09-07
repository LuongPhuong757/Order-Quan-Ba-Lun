// BẢN CHỐT TIÊU HAO — nguồn sự thật duy nhất cho báo cáo "tháng này / bàn này tốn bao nhiêu
// nguyên liệu" (2026-09-05).
//
// SỰ TỒN TẠI CỦA DÒNG NÀY CHÍNH LÀ BẰNG CHỨNG "MÓN ĐÃ ĐƯỢC NẤU". Hai quyết định của chủ quán
// gộp lại thành một cơ chế duy nhất ở đây:
//
//  1. "Món huỷ có tính tiêu hao không?" → tính nếu bếp ĐÃ bắt đầu nấu. Dòng chỉ được ghi khi
//     món lần đầu vào COOKING/READY/SERVED, nên món huỷ lúc còn PENDING/KITCHEN tự động không
//     có dòng nào → không trừ nguyên liệu. Không cần cột trạng thái hay logic canh giữ.
//  2. "Sửa công thức thì báo cáo tháng cũ ra sao?" → giữ nguyên số cũ. Định lượng được CHÉP
//     vào đây tại thời điểm chốt, nên đổi `recipe_lines` về sau không đụng tới quá khứ. Cùng
//     lệ snapshot mà `order_items` đã dùng cho tên/giá món.
//
// Lưu THÀNH BẢNG RIÊNG chứ không nhét JSON vào `order_items`: báo cáo là `SUM(...) GROUP BY
// nguyên liệu`, mà JSON thì không cộng được bằng SQL.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

@Entity('order_item_ingredient_usage')
// UNIQUE (dòng món, nguyên liệu): chốt hai lần cho cùng một món là tiêu hao gấp đôi. Món đi
// COOKING → READY → SERVED sẽ chạm hàm chốt 3 lần; ràng buộc này là chốt chặn cuối ở DB, còn
// `ConsumptionService` đã kiểm trước bằng truy vấn.
@Index('idx_usage_item_ingredient', ['order_item_id', 'ingredient_id'], { unique: true })
@Index('idx_usage_ingredient', ['ingredient_id'])
@Index('idx_usage_order', ['order_id'])
export class OrderItemIngredientUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  order_item_id!: string;

  /** Chép sẵn từ `order_items` để báo cáo lọc theo đơn/bàn không phải join thêm một bảng nữa. */
  @Column({ type: 'varchar', length: 36 })
  order_id!: string;

  @Column({ type: 'varchar', length: 36 })
  ingredient_id!: string;

  /** Snapshot tên + đơn vị nguyên liệu tại lúc chốt.
   *
   * Đổi tên hay gộp nguyên liệu về sau KHÔNG viết lại lịch sử: báo cáo tháng trước vẫn đọc lên
   * đúng cái tên hồi đó, giống hệt cách `order_items.menu_item_name` sống sót qua việc đổi tên
   * món. */
  @Column({ type: 'varchar', length: 128 })
  ingredient_name!: string;

  @Column({ type: 'varchar', length: 16 })
  unit!: string;

  /** TỔNG lượng đã dùng cho dòng món này = định lượng 1 phần × số phần lúc chốt.
   *
   * Bớt lẻ sau khi đã nấu (`removeItemUnits` tách dòng CANCELLED) KHÔNG sửa lại số này — và đó
   * là chủ ý: nguyên liệu đã nằm trong nồi rồi, khách trả lại cũng không lấy về được. */
  @Column({ type: 'decimal', precision: 14, scale: 3 })
  qty_total!: string;

  /** Số phần lúc chốt — giữ lại để đối chiếu khi số liệu trông lạ (`qty_total / qty` phải bằng
   * đúng định lượng trong công thức hồi đó). */
  @Column({ type: 'int', unsigned: true })
  qty!: number;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

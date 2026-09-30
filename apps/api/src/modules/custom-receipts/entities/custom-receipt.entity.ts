import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';
import type { CustomReceiptItem } from '../custom-receipt-model.js';

/**
 * Một tờ HOÁ ĐƠN TỰ DO đã in (M6.D-02).
 *
 * ⚠ Bảng này nằm HOÀN TOÀN ngoài dòng tiền của quán: không có `order_id`, không khoá ngoại tới
 * `menu_items`, không sinh dòng nào trong `orders`/`order_items`/nhật ký bàn. Đúng theo yêu cầu
 * của chủ quán — tính năng này chỉ tạo ra GIẤY, không tạo ra doanh thu hay chi phí.
 *
 * Vì sao phải lưu, thay vì dựng byte rồi in thẳng: cầu in dựng tờ giấy LÚC NÓ TỚI LẤY JOB (hai
 * giây sau khi bấm), không phải lúc bấm — xem `PrintJob`. Hoá đơn thật dựng lại được vì đọc
 * `orders`; tờ tự do thì không có đơn nào để đọc, nên nội dung buộc phải nằm ở đâu đó.
 *
 * Bất biến sau khi tạo: không có API sửa. In lại một tờ phải ra tờ GIỐNG HỆT — cho sửa là mở
 * đường cho hai tờ giấy khác nhau cùng mang một mã.
 */
@Entity('custom_receipts')
// Màn quản lý luôn đọc "mới nhất trước", và bảng chỉ dài thêm theo thời gian.
@Index('idx_custom_receipts_recent', ['created_at'])
export class CustomReceipt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Ô người in gõ tự do, in ở đúng chỗ hoá đơn thật ghi "Bàn 5": có thể là "Bàn 5", "Mang về",
   *  tên khách, hoặc rỗng. Rỗng thì dòng đó trên giấy chỉ còn mã đơn. */
  @Column({ type: 'varchar', length: 64, default: '' })
  header_note!: string;

  /**
   * Các dòng trên giấy. JSON chứ không phải bảng con, có chủ ý: những dòng này KHÔNG tham chiếu
   * `menu_items` — tên và giá được chụp lại tại chỗ, và một dòng có thể là món không hề tồn tại
   * trong menu. Một bảng con không khoá ngoại với cái gì chỉ để chứa ba con số là bảng con vô ích.
   */
  @Column({ type: 'json' })
  items!: CustomReceiptItem[];

  @Column({ type: 'int', default: 0 })
  ship_fee!: number;

  /** Phần trả bằng chuyển khoản. 0 = tờ giấy in "Tiền mặt", giống hệt hoá đơn tại quán. */
  @Column({ type: 'int', default: 0 })
  transfer_amount!: number;

  /** Chốt lúc tạo dù cộng lại từ `items` được: màn danh sách hiện tổng của hàng trăm tờ, và
   *  parse JSON từng dòng chỉ để cộng là chỗ chậm không có lý do tồn tại. */
  @Column({ type: 'int', default: 0 })
  items_total!: number;

  @Column({ type: 'int', default: 0 })
  total!: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  created_by_user_id!: string | null;

  /** Tên hiện ở ô "Thu ngân" trên giấy, và là câu trả lời cho "tờ này ở đâu ra". Lưu tên đã chụp
   *  chứ không join `users`: nhân viên nghỉ việc rồi thì tờ giấy cũ vẫn phải đọc được. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  created_by_full_name!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

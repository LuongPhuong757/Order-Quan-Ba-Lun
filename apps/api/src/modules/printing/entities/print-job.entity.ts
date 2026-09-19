import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * Một lần in. Bảng này là HÀNG ĐỢI giữa điện thoại của nhân viên và máy in ở quán.
 *
 * Vì sao phải có hàng đợi thay vì in thẳng: VPS không nhìn thấy máy in (máy in nằm sau NAT
 * của quán), còn trình duyệt trên điện thoại thì không mở được socket thô. Nên không tồn tại
 * đường nối trực tiếp nào. Hàng đợi cho phép chiều đi ngược lại: cầu in ở quán chủ động hỏi
 * server "có gì phải in không".
 *
 * ⚠ KHÔNG lưu byte ESC/POS vào đây, và đó là quyết định có chủ ý:
 *  - Mỗi tờ hoá đơn ~30KB. Nhân với vài trăm đơn/ngày là bảng phình nhanh hơn cả `orders`.
 *  - Quan trọng hơn: bản in được DỰNG LẠI lúc cầu in tới lấy. Nếu ai đó sửa đơn giữa chừng
 *    (huỷ một món gọi nhầm) thì tờ giấy in ra là tờ ĐÚNG. Đóng băng byte lúc xếp hàng thì
 *    hoá đơn cầm trên tay mâu thuẫn với số liệu trong máy — loại lỗi không ai truy ra được.
 */
@Entity('print_jobs')
// Câu quét của cầu in: `status='PENDING' ORDER BY created_at`. Mỗi tablet hỏi vài giây một
// lần, suốt 24/7, trong khi bảng chỉ TĂNG theo lịch sử — không có index này thì chi phí mỗi
// lần hỏi tăng dần theo tuổi của quán, y hệt `idx_orders_open` bên `orders`.
@Index('idx_print_jobs_queue', ['status', 'created_at'])
@Index('idx_print_jobs_order', ['order_id'])
export class PrintJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  order_id!: string;

  /** 'RECEIPT' — hoá đơn cho khách. Cột tồn tại sẵn để phiếu bếp sau này không phải đổi schema
   *  của một bảng đang chạy; vòng đầu chỉ có đúng một giá trị. */
  @Column({ type: 'varchar', length: 16, default: 'RECEIPT' })
  kind!: string;

  /** 'CHECKOUT' = tự sinh lúc thanh toán · 'REPRINT' = người bấm in lại. In lại phải phân biệt
   *  được để đóng dấu "BẢN IN LẠI" lên giấy — hai tờ giống hệt nhau trên quầy là đường dẫn
   *  thẳng tới thu tiền hai lần. */
  @Column({ type: 'varchar', length: 16, default: 'CHECKOUT' })
  reason!: string;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: string; // 'PENDING' | 'CLAIMED' | 'DONE' | 'FAILED'

  /**
   * Khoá chống in trùng. `CHECKOUT` dùng `<order_id>:RECEIPT:CHECKOUT` nên một đơn chỉ tự in
   * đúng một lần dù `checkout()` có bị gọi lại (bấm hai lần lúc mạng chập chờn — chuyện xảy ra
   * hàng ngày ở quầy đông khách). `REPRINT` gắn thêm mốc thời gian vì in lại là hành động có
   * chủ đích, lần nào cũng phải ra giấy.
   */
  @Column({ type: 'varchar', length: 96 })
  @Index({ unique: true })
  dedupe_key!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  last_error!: string | null;

  /** Thiết bị đang giữ job (`print_devices.id`). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  claimed_by_device_id!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  claimed_at!: number | null;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  printed_at!: number | null;

  /** Ai bấm in lại — để màn Máy in trả lời được "tờ thứ hai này ở đâu ra". */
  @Column({ type: 'varchar', length: 128, nullable: true })
  requested_by_full_name!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

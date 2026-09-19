import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * Một cầu in — chiếc máy tính bảng ở quầy chạy script Termux.
 *
 * Xác thực bằng token RIÊNG của thiết bị, không dùng JWT nhân viên: tablet nằm ở quầy cả ngày,
 * ai cũng chạm được, nên nó không được phép cầm quyền của một con người. Token này chỉ mở được
 * đúng 3 endpoint `/print/*` và không đọc được gì khác.
 *
 * Token lưu nguyên văn (không băm), theo đúng `supplier_sessions` đang chạy production. Đánh
 * đổi có ý thức: nó phải HIỂN THỊ LẠI được ở màn quản lý, vì người dựng tablet hay phải dán lại
 * token sau khi cài lại máy, và bắt họ tạo thiết bị mới mỗi lần thì danh sách thiết bị sẽ đầy
 * rác chỉ sau vài tháng.
 */
@Entity('print_devices')
export class PrintDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Tên người đặt: "Tablet quầy", "Tablet dự phòng". Hiện trên màn Máy in. */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'varchar', length: 64 })
  @Index({ unique: true })
  token!: string;

  /**
   * Khoá nhận dạng CHIẾC MÁY, do trình duyệt tự sinh và giữ trong localStorage.
   *
   * Nhờ nó, một tài khoản "Máy in" dùng chung cho nhiều máy POS mà mỗi máy vẫn có token riêng:
   * lần ghép đầu tiên server tạo thiết bị mới, những lần sau trả lại đúng thiết bị cũ thay vì
   * đẻ thêm một dòng mỗi lần tải trang. Null với thiết bị tạo tay ở màn quản lý (chế độ LAN).
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index()
  pair_key!: string | null;

  /** Lần cuối thiết bị gọi về. Đây là thứ duy nhất trả lời được "cầu in còn sống không" —
   *  tablet chết thì không có ai báo, hàng đợi chỉ lặng lẽ dài ra. */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  last_seen_at!: number | null;

  /** Tình trạng máy in mà thiết bị báo về lần cuối ('OK', 'Máy in hết giấy'...). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  last_status!: string | null;

  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  revoked_at!: number | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  created_by_full_name!: string | null;
}

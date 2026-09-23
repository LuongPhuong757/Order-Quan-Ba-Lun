import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * Một lần thu tiền chuyển khoản đang chờ tiền về (2026-09-22).
 *
 * MỘT BẢNG CHO CẢ HAI LUỒNG — đơn online trả trước và đơn thu tại quầy — thay vì hai bảng hay
 * hai cách tra. Lý do rất cụ thể: nếu đơn quầy khớp bằng cách dò `orders.transfer_note LIKE
 * '%DH123456%'` thì (a) không index được, mỗi webhook quét toàn bảng đơn, và (b) mã sống trong
 * một chuỗi tự do mà người khác có thể sinh lại khác đi. Ở đây mã là một CỘT CÓ KHOÁ DUY NHẤT,
 * bộ khớp chỉ có đúng một đường tra cho mọi loại đơn.
 *
 * Bảng này KHÔNG phải nguồn sự thật về tiền. `orders.transfer_amount` vẫn là con số nhân viên
 * ghi nhận và vẫn là thứ mọi báo cáo doanh thu đọc. Ở đây chỉ trả lời đúng một câu: *ngân hàng
 * đã báo tiền về cho mã này chưa, và bao nhiêu*.
 */
@Entity('payment_intents')
// Mã in trên QR. UNIQUE là ràng buộc NGHIỆP VỤ chứ không phải tối ưu tốc độ: hai đơn trùng mã thì
// webhook về không biết trả tiền cho đơn nào, và không có cách nào chữa sau khi tiền đã vào.
// DUY NHẤT THEO NGÀY, không phải vĩnh viễn (chủ quán chốt 2026-09-22).
//
// Mã (`BAN05ABC`) chỉ có 3 chữ cái ngẫu nhiên, nên duy nhất vĩnh viễn là bất khả thi — và cũng
// không cần: mã đã mang sẵn số bàn, nên phạm vi phải duy nhất chỉ là MỘT BÀN trong MỘT NGÀY, tức
// 2–3 đơn. Khoá này biến "gần như không trùng" thành "không thể trùng".
//
// ⚠ BỎ `code_day` KHỎI KHOÁ NÀY LÀ HỎNG NGẦM: mã sẽ phải duy nhất vĩnh viễn với chỉ 13.824 khả
// năng cho mỗi bàn, và vài tháng sau là đụng mã liên tục.
@Index('uq_pi_code_day', ['code', 'code_day'], { unique: true })
@Index('idx_pi_target', ['target_type', 'target_id'])
@Index('idx_pi_created', ['created_at'])
export class PaymentIntent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 6 chữ số, sinh bằng CSPRNG ở `payments.service.ts`. Nội dung CK = `DH` + cột này. */
  @Column({ type: 'char', length: 8 })
  code!: string;

  /** Ngày sinh mã, dạng `YYYY-MM-DD` theo GIỜ VIỆT NAM.
   *
   *  Chuỗi chứ không phải cột `date` suy từ `created_at`: container chạy UTC nên một đơn thu lúc
   *  22h tối sẽ rơi sang ngày hôm sau nếu để MySQL tự cắt ngày — và lúc đó "duy nhất theo ngày"
   *  nói về một cái ngày không phải ngày mà quán đang bán. */
  @Column({ type: 'char', length: 10 })
  code_day!: string;

  /** `ONLINE` = `online_order_requests.id` · `POS` = `orders.id`.
   *
   * Không dùng khoá ngoại: hai bảng đích khác nhau, mà FK tới một trong hai thì TypeORM phải
   * dựng hai cột nullable và mọi truy vấn phải nhớ kiểm cột nào đang có giá trị. Cặp
   * (type, id) đọc ra là hiểu ngay đang nói về cái gì. */
  @Column({ type: 'varchar', length: 8 })
  target_type!: 'ONLINE' | 'POS';

  @Column({ type: 'varchar', length: 36 })
  target_id!: string;

  /** Số tiền PHẢI THU, server chốt lúc tạo. KHÔNG BAO GIỜ đọc lại từ client — client sửa được
   *  thì khách trả 1.000đ cũng thành "đã thanh toán". */
  @Column({ type: 'int', unsigned: true })
  amount!: number;

  /** Chuỗi EMVCo đã dựng, lưu để khách F5 trang không sinh ra mã khác (và để soi lại khi một app
   *  ngân hàng không đọc được mã). */
  @Column({ type: 'text', nullable: true })
  qr_payload!: string | null;

  /** Mã QR đã chìa ra, và SNAPSHOT số tài khoản của nó (2026-09-23).
   *
   *  Đây là thứ duy nhất cho phép phát hiện "khách chuyển ĐÚNG MÃ nhưng VÀO TÀI KHOẢN KHÁC" —
   *  không lưu thì lúc tiền về ta không có gì để so. Snapshot số tài khoản chứ không chỉ id: chủ
   *  quán sửa hoặc ngừng dùng một mã QR thì đơn cũ vẫn phải đối chiếu được, cùng lý do
   *  `payment_qr_label` được snapshot ở `orders`.
   *
   *  NULL = lúc sinh mã chưa có tài khoản nào (chưa khai mã QR) — lúc đó không so được, và màn sổ
   *  giao dịch hiện "không rõ" chứ không vu cho khách là chuyển sai. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  expected_account_id!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  expected_account_no!: string | null;

  /** SNAPSHOT nội dung CK đã in lên QR, vd `SEVQR BAN05ABC`.
   *
   *  Lưu chứ không dựng lại từ `code`: nội dung phụ thuộc TIỀN TỐ của tài khoản nhận, mà tiền tố
   *  đó chủ quán sửa được ở màn Cài đặt. Dựng lại sau khi họ sửa sẽ ra một chuỗi KHÁC với chuỗi
   *  khách đang cầm trong app ngân hàng — cùng lý do `payment_qr_label` được snapshot ở `orders`. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  note!: string | null;

  /** Tổng đã nhận, CỘNG DỒN. Khách chuyển thiếu rồi bù là chuyện có thật. */
  @Column({ type: 'int', unsigned: true, default: 0 })
  received_amount!: number;

  /** Mốc đủ tiền. MỘT CHIỀU, set rồi không bao giờ gỡ — cùng lý do 2 mốc giao hàng ở
   *  `order.entity.ts` chọn mốc thời gian thay vì cột trạng thái: đơn điệu bẩm sinh, không cần
   *  code nào canh giữ, và đo được "khách quét QR xong bao lâu thì tiền về". */
  @Column({ type: 'datetime', precision: 6, nullable: true, transformer: dateToMsTransformer })
  paid_at!: number | null;

  /** Có tiền về nhưng KHÔNG khớp sạch (thiếu, hoặc thừa đáng kể) → cần người nhìn.
   *  Máy không tự sửa tiền trên đơn, đây là toàn bộ quyền hạn của nó. */
  @Column({ type: 'boolean', default: false })
  needs_review!: boolean;

  /** Hết hạn hiển thị QR. KHÔNG dùng để từ chối tiền: khách quét muộn 3 tiếng thì tiền vẫn về
   *  tài khoản thật, chối ở phần mềm không làm tiền quay lại. Hết hạn chỉ có nghĩa với màn khách. */
  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  expires_at!: number;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

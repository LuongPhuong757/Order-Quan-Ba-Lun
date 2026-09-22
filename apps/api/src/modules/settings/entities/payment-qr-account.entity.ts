// Danh sách mã QR nhận tiền của quán (2026-09-14, chủ quán: "nhà tôi rất nhiều mã QR").
//
// Vì sao là BẢNG RIÊNG chứ không phải một key JSON trong `store_settings` (như `ship_fee_tiers`):
// đơn hàng phải trỏ ngược vào đây để cuối ngày mở sao kê của TỪNG tài khoản mà đối soát. Phần tử
// trong một mảng JSON không có id ổn định — chủ quán xoá một dòng là mọi đơn cũ trỏ vào hư không,
// và lịch sử đối soát mất theo. Một hàng có `id` thì đơn cũ vẫn đọc được mãi.
//
// Cùng lý do: KHÔNG xoá cứng. "Xoá" ở giao diện = `is_active = false` — số tài khoản đổi, thẻ bị
// khoá, người nhà nghỉ bán, đều là ngừng DÙNG chứ không phải chưa từng tồn tại.
//
// C-SCHEMA-07: `synchronize: true`, không migration — bảng mới nên không đụng bảng nào đang có.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PaymentQrKind } from '@order/schemas';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

// `BANK` = tài khoản ngân hàng → app TỰ VẼ được QR kèm số tiền và nội dung chuyển khoản.
// `IMAGE` = ảnh QR có sẵn (ví MoMo/ZaloPay, QR in giấy dán ở quán) → chỉ hiện lại tấm ảnh, khách
// phải tự gõ số tiền và nội dung. Hai loại KHÁC NHAU về thứ người dùng nhận được, nên giao diện
// phải nói thẳng điều đó ra chứ không để chủ quán up 5 tấm ảnh rồi thắc mắc vì sao vẫn không dò
// được sao kê.
//
// Kiểu lấy từ `@order/schemas` (cùng chỗ với luật `validatePaymentQrDraft` và bảng mã ngân hàng)
// — định nghĩa lại ở đây là mở đường cho entity và luật kiểm lệch nhau.

@Entity('payment_qr_accounts')
// Đường đọc duy nhất: "liệt kê mã đang dùng, theo thứ tự chủ quán xếp". Lọc `is_active` rồi sắp
// theo `sort_order` là truy vấn của cả màn cài đặt lẫn hộp thoại thu tiền.
@Index('idx_payment_qr_active_sort', ['is_active', 'sort_order'])
export class PaymentQrAccount {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cái nhân viên nhìn để chọn lúc khách đang đứng đợi — "TK Thuý – VCB", "MoMo bố".
   *  Đây là chuỗi chủ quán tự đặt, KHÔNG sinh từ số tài khoản: người thu nhớ mặt người, không
   *  nhớ dãy số. */
  @Column({ type: 'varchar', length: 128 })
  label!: string;

  @Column({ type: 'varchar', length: 8 })
  kind!: PaymentQrKind;

  // ── Chỉ có nghĩa với `kind = 'BANK'` ─────────────────────────────────────
  /** Mã BIN 6 số của ngân hàng theo chuẩn Napas/VietQR (vd Vietcombank = 970436). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  bank_bin!: string | null;

  /** Tên ngân hàng để HIỂN THỊ. Snapshot ngay lúc lưu chứ không tra ngược từ `bank_bin` mỗi lần
   *  đọc: bảng tra ngân hàng nằm trong code, code đổi thì tên hiện trên đơn cũ đổi theo. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  bank_name!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  account_no!: string | null;

  /** Tên chủ tài khoản. Khách nhìn tên này để biết mình chuyển đúng người trước khi bấm xác nhận. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  account_name!: string | null;

  // ── Chỉ có nghĩa với `kind = 'IMAGE'` ────────────────────────────────────
  /** `/uploads/payment-qr/<file>.webp` — đi qua đúng `saveImage()` của ảnh món và ảnh phiếu nhập
   *  (resize + webp + xoá EXIF/GPS + tên file sinh ở server). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  image_url!: string | null;

  /** Tiền tố BẮT BUỘC ở đầu nội dung chuyển khoản, do NGÂN HÀNG/cổng đòi chứ không phải quy ước
   *  của quán (2026-09-22).
   *
   *  VietinBank cá nhân nối qua SePay: thiếu `SEVQR` ở đầu nội dung thì SePay KHÔNG nhận được
   *  biến động số dư — tiền về tài khoản thật nhưng app không bao giờ biết, và không có lỗi nào
   *  hiện ra ở đâu cả. Đã gặp thật khi chạy thử.
   *
   *  NULL = ngân hàng không đòi gì. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  note_prefix!: string | null;

  /** Thứ tự hiện trong hộp thoại thu tiền. Chủ quán xếp mã hay dùng lên đầu để người thu bấm
   *  một nhát là xong. */
  @Column({ type: 'int', default: 0 })
  sort_order!: number;

  /** `false` = ngừng dùng, KHÔNG hiện lúc thu tiền nữa, nhưng đơn cũ vẫn trỏ vào được. */
  @Column({ type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;

  @UpdateDateColumn({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  updated_at!: number;

  @Column({ type: 'varchar', length: 36, nullable: true })
  created_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  created_by_full_name!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  updated_by_user_id!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  updated_by_full_name!: string | null;
}

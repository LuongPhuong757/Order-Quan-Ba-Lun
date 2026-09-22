import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { dateToMsTransformer } from '../../auth/entities/user.entity.js';

/**
 * Một dòng tiền VỀ tài khoản, do cổng trung gian (SePay) báo (2026-09-22).
 *
 * Đây là bản ghi THÔ và BẤT BIẾN: nó là thứ ngân hàng nói, không phải thứ ta suy ra. Mọi kết
 * luận ("đơn này đã trả") sống ở `payment_intents`, ở đây chỉ lưu nguyên văn để còn đối chiếu
 * khi hai bên lệch nhau. `raw` giữ cả payload gốc vì lúc đi dò một ca sai, thứ thiếu nhất luôn
 * là cái mà cổng thực sự đã gửi, chứ không phải cái ta đã hiểu.
 */
@Entity('bank_transactions')
// KHOÁ CHỐNG TRÙNG — thứ quan trọng nhất của cả bảng.
//
// SePay gửi lại giao dịch khi không nhận đủ phản hồi (HTTP 200 + body đúng + trong 30 giây), và
// job quét bù cũng kéo về đúng những giao dịch đã có. Không có index này thì tiền được cộng hai
// lần vào `received_amount`, và một đơn chuyển thiếu bỗng thành đã trả đủ.
//
// Chống trùng phải nằm ở TẦNG DB chứ không ở tầng code: hai webhook song song đều đọc "chưa có"
// rồi cùng ghi.
@Index('uq_bt_gateway_ref', ['gateway', 'gateway_txn_id'], { unique: true })
@Index('idx_bt_occurred', ['occurred_at'])
@Index('idx_bt_intent', ['applied_intent_id'])
export class BankTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** `sepay` hôm nay. Có cột này để đổi/thêm cổng không phải đập bảng — mã giao dịch của hai cổng
   *  khác nhau có thể trùng số, nên khoá duy nhất là CẶP (gateway, id). */
  @Column({ type: 'varchar', length: 16 })
  gateway!: string;

  /** `id` của SePay. KHÔNG dùng `referenceCode` của ngân hàng làm khoá: nó do bên thứ ba sinh,
   *  có thể trống, và không có gì bảo đảm duy nhất qua các lần quét lại. */
  @Column({ type: 'varchar', length: 64 })
  gateway_txn_id!: string;

  /** Luôn > 0: bảng này CHỈ ghi tiền vào. Tiền ra bị lọc từ tầng controller. */
  @Column({ type: 'int', unsigned: true })
  amount!: number;

  /** Nội dung CK NGUYÊN VĂN. Giữ nguyên chứ không lưu bản đã chuẩn hoá — khi phải giải thích vì
   *  sao một dòng không khớp, câu trả lời gần như luôn nằm trong đúng chuỗi khách đã gõ. */
  @Column({ type: 'varchar', length: 255 })
  content!: string;

  /** Số tài khoản nhận, để tách sao kê theo từng mã QR khi quán có nhiều tài khoản. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  account_no!: string | null;

  /** Giờ ngân hàng ghi có. SePay gửi chuỗi KHÔNG có múi giờ → quy về +07 ở `sepay-payload.ts`. */
  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  occurred_at!: number;

  /** Đã áp vào mã thanh toán nào. NULL = tiền lạ: khách xoá nội dung, chuyển nhầm, hoặc tiền
   *  riêng của chủ vào cùng tài khoản. Để NULL là đúng — đoán theo số tiền là gán tiền của người
   *  này sang đơn của người khác, sai lặng lẽ và không cứu được. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  applied_intent_id!: string | null;

  /** Payload gốc của cổng, nguyên si. */
  @Column({ type: 'json', nullable: true })
  raw!: object | null;

  @Column({ type: 'datetime', precision: 6, transformer: dateToMsTransformer })
  created_at!: number;
}

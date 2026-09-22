import { Injectable, Logger } from '@nestjs/common';
import { Between, DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { extractPaymentCode } from '@order/schemas';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import { OnlineOrderRequest } from '../public/entities/online-order-request.entity.js';
import type { IngestInput } from './sepay-payload.js';

/**
 * Nhận một dòng tiền về rồi áp vào đơn (2026-09-22).
 *
 * BA NGUYÊN TẮC, và cả ba đều là quyết định đã cân nhắc chứ không phải cách viết tiện tay:
 *
 * 1. **Chống trùng ở tầng DB.** `INSERT IGNORE` + khoá duy nhất `(gateway, gateway_txn_id)`.
 *    Kiểm-rồi-ghi trong code thì hai webhook song song đều đọc "chưa có" rồi cùng ghi, và tiền
 *    được cộng hai lần. Đây cũng là thứ khiến job quét bù chạy bao nhiêu lần cũng vô hại.
 *
 * 2. **Máy chỉ gắn cờ, không sửa tiền.** Chủ quán chốt 2026-09-21. Không dòng nào ở đây đụng tới
 *    `orders.transfer_amount`, `closed_at` hay `is_paid`. Con số tiền vẫn là thứ nhân viên ghi;
 *    cái ta thêm vào chỉ là câu trả lời cho "ngân hàng đã báo về chưa".
 *
 * 3. **Không đoán.** Không có mã đơn trong nội dung thì để nguyên, KHÔNG dò theo số tiền. Hai bàn
 *    cùng trả 250.000đ trong năm phút là chuyện thường; đoán sai ở đây là đánh dấu đã trả cho đơn
 *    của người khác — sai lặng lẽ, không ai phát hiện cho tới lúc đếm két.
 */
@Injectable()
export class PaymentsApplyService {
  private readonly log = new Logger(PaymentsApplyService.name);

  /** Thừa quá ngưỡng này mới coi là bất thường. Khách làm tròn 248.000 lên 250.000 là chuyện hàng
   *  ngày, gắn cờ mọi ca như vậy thì màn đối soát đầy cờ và không ai nhìn nữa. */
  private static readonly OVERPAY_TOLERANCE = 1.05;

  constructor(private readonly ds: DataSource) {}

  /**
   * Trả về `true` nếu đây là giao dịch MỚI (đã ghi), `false` nếu đã xử lý rồi.
   *
   * KHÔNG ném khi không khớp được đơn nào: "tiền về mà chưa biết của ai" là trạng thái hợp lệ và
   * thường xuyên, người đối soát sẽ xử. Ném ở đây làm cổng gửi lại mãi một payload mà lần nào ta
   * cũng sẽ từ chối y hệt.
   */
  async ingest(input: IngestInput): Promise<boolean> {
    return this.ds.transaction(async (m) => {
      const inserted = await this.insertOnce(m, input);
      if (!inserted) {
        this.log.log(`[webhook] ${input.gateway}#${input.gatewayTxnId} đã xử lý trước đó, bỏ qua`);
        return false;
      }

      const code = extractPaymentCode(input.content);
      if (!code) {
        // Khách xoá nội dung, hoặc tiền riêng vào cùng tài khoản. Dòng vẫn nằm trong bảng và hiện
        // ở màn đối soát dưới dạng "tiền lạ" — mất dấu tiền mới là hỏng, chưa khớp thì chưa sao.
        this.log.warn(`[webhook] không thấy mã đơn trong nội dung: "${input.content}"`);
        return true;
      }

      const intent = await this.pickIntent(m, code, input);
      if (!intent) return true;

      await m.update(BankTransaction, { gateway: input.gateway, gateway_txn_id: input.gatewayTxnId }, {
        applied_intent_id: intent.id,
      });

      const received = intent.received_amount + input.amount;
      const enough = received >= intent.amount;
      // `>=` chứ không `===`: khách làm tròn lên là chuyện hàng ngày, bắt đúng từng đồng thì phần
      // lớn đơn sẽ mắc kẹt ở "chưa đủ" và tính năng thành vô dụng.
      const paidAt = intent.paid_at ?? (enough ? input.occurredAt : null);

      await m.update(PaymentIntent, intent.id, {
        received_amount: received,
        paid_at: paidAt,
        needs_review: !enough || received > intent.amount * PaymentsApplyService.OVERPAY_TOLERANCE,
      });

      if (enough && !intent.paid_at) {
        await this.markTargetPaid(m, intent, paidAt!);
        this.log.log(
          `[webhook] DH${code} (${intent.target_type}) ĐÃ THANH TOÁN ${received}/${intent.amount}`,
        );
      } else if (!enough) {
        this.log.warn(`[webhook] DH${code} CHUYỂN THIẾU ${received}/${intent.amount}`);
      }
      return true;
    });
  }


  /**
   * Chọn ĐÚNG lần thu mà dòng tiền này thuộc về — không phải cứ thấy mã là lấy.
   *
   * Mã chỉ có 3 chữ số và được TÁI SỬ DỤNG sang ngày hôm sau (chủ quán chốt 2026-09-22, xem
   * `payment-code.ts`). Trong một ngày thì `UNIQUE(code, code_day)` bảo đảm không trùng, nhưng một
   * giao dịch về MUỘN QUA NGÀY — webhook lỡ lúc deploy, hoặc job quét bù kéo về giao dịch cũ — sẽ
   * thấy mã đó tồn tại ở CẢ hôm qua lẫn hôm nay.
   *
   * Ba tầng lọc, theo đúng thứ tự tin cậy:
   *  ① CỬA SỔ THỜI GIAN — chỉ xét mã sinh trước lúc tiền về, trong vòng 36 giờ. Tiền không bao giờ
   *    về TRƯỚC khi mã được sinh ra, nên mã sinh sau là chắc chắn không phải.
   *  ② SỐ TIỀN khớp đúng — dấu hiệu mạnh nhất khi có nhiều ứng viên.
   *  ③ CHƯA TRẢ trước, mới nhất trước.
   *
   * Còn mơ hồ thì KHÔNG ĐOÁN: dòng tiền nằm lại nhóm "chưa khớp" ở màn đối soát để người quyết.
   * Đoán sai ở đây là đánh dấu "đã trả" cho đơn của người khác — sai lặng lẽ, không ai phát hiện.
   */
  private async pickIntent(
    m: EntityManager,
    code: string,
    input: IngestInput,
  ): Promise<PaymentIntent | null> {
    // +5 phút phòng lệch đồng hồ giữa ngân hàng và máy ta; 36 giờ đủ phủ một đêm deploy hỏng.
    const from = input.occurredAt - 36 * 60 * 60 * 1000;
    const to = input.occurredAt + 5 * 60 * 1000;

    // Khoá hàng trước khi đọc `received_amount`: khách chuyển hai lần, hai webhook về gần như cùng
    // lúc, cả hai đọc số cũ rồi cùng ghi đè → mất một nửa số tiền đã nhận.
    const rows = await m.find(PaymentIntent, {
      where: { code, created_at: Between(from, to) },
      order: { created_at: 'DESC' },
      lock: { mode: 'pessimistic_write' },
    });

    if (rows.length === 0) {
      this.log.warn(`[webhook] mã DH${code} không có lần thu nào khớp cửa sổ thời gian`);
      return null;
    }
    if (rows.length === 1) return rows[0];

    const unpaid = rows.filter((r) => r.paid_at === null);
    const pool = unpaid.length > 0 ? unpaid : rows;
    const exact = pool.filter((r) => r.amount === input.amount);
    if (exact.length === 1) return exact[0];
    if (exact.length === 0 && pool.length === 1) return pool[0];

    this.log.warn(
      `[webhook] mã DH${code} khớp ${rows.length} lần thu, KHÔNG đoán — để người đối soát quyết`,
    );
    return null;
  }

  /**
   * `INSERT IGNORE` — trả `false` khi hàng đã tồn tại.
   *
   * Đọc `affectedRows` chứ KHÔNG đọc `identifiers`: khoá chính là uuid do TypeORM sinh ở phía
   * ứng dụng, nên `identifiers` có giá trị kể cả khi MySQL đã bỏ qua lệnh ghi. Nhìn vào đó sẽ
   * tưởng mọi giao dịch trùng đều là giao dịch mới.
   */
  private async insertOnce(m: EntityManager, input: IngestInput): Promise<boolean> {
    const res = await m
      .createQueryBuilder()
      .insert()
      .into(BankTransaction)
      .values({
        gateway: input.gateway,
        gateway_txn_id: input.gatewayTxnId,
        amount: input.amount,
        content: input.content,
        account_no: input.accountNo,
        occurred_at: input.occurredAt,
        raw: input.raw,
        created_at: Date.now(),
      })
      .orIgnore()
      .execute();
    return Number((res.raw as { affectedRows?: number })?.affectedRows ?? 0) > 0;
  }

  /**
   * Ghi mốc đã trả lên đơn đích.
   *
   * ĐƠN QUẦY KHÔNG CÓ GÌ ĐỂ GHI, và đó là chủ ý: cờ "ngân hàng đã báo về" sống ở `payment_intents`
   * và màn đối soát đọc từ đó. Thêm một cột trên `orders` sẽ là nguồn sự thật thứ hai cạnh con số
   * tiền — đúng thứ mà docblock của `payment_method` trong `order.entity.ts` đã từ chối một lần.
   */
  private async markTargetPaid(m: EntityManager, intent: PaymentIntent, paidAt: number): Promise<void> {
    if (intent.target_type !== 'ONLINE') return;
    await m.update(OnlineOrderRequest, intent.target_id, { paid_at: paidAt });
  }
}

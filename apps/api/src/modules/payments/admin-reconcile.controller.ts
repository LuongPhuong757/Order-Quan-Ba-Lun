import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { apiOk, type ApiOk } from '@order/utils';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import { OrderPaymentPhoto } from '../orders/entities/order-payment-photo.entity.js';
import { BankTransaction } from './entities/bank-transaction.entity.js';

export type BankReconcile = {
  /** Tổng số lần thu chuyển khoản trong kỳ (đã chìa QR). */
  total: number;
  /** Số mã thanh toán trong kỳ mà ngân hàng ĐÃ báo đủ tiền. */
  confirmed: number;
  /** Lần thu đã chìa QR nhưng ngân hàng chưa xác nhận đủ tiền — con số chủ quán cần nhất.
   *
   *  `has_photo` là thứ phân biệt hai mức lo khác hẳn nhau: chưa xác thực NHƯNG có ảnh bill thì
   *  còn bằng chứng để đối chiếu; chưa xác thực VÀ KHÔNG có ảnh thì không còn gì cả — đó mới là
   *  đơn phải đi hỏi người thu ngay trong ngày, trước khi không ai nhớ nữa. */
  pending: Array<{
    code: string;
    target_type: string;
    target_id: string;
    amount: number;
    received: number;
    has_photo: boolean;
  }>;
  /** Tiền về mà không mang mã đơn nào: khách xoá nội dung, chuyển nhầm, hoặc tiền riêng của chủ. */
  unknown: Array<{ amount: number; content: string; occurred_at: number; account_no: string | null }>;
};

/**
 * Khối "ngân hàng đã báo về chưa" của màn Lịch sử (2026-09-22).
 *
 * CHỈ ADMIN, cùng ranh giới với khối đối soát đã có (`PaymentReconcilePanel`, chủ quán chốt
 * 2026-09-14 — role `report` cũng không được). Đây là con số tiền của cả ca: bày ra cho ai đứng
 * cạnh liếc qua vai cũng đọc được là một quyết định, không phải mặc định.
 */
@Controller('payments')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminReconcileController {
  constructor(
    @InjectRepository(PaymentIntent) private readonly intents: Repository<PaymentIntent>,
    @InjectRepository(BankTransaction) private readonly txns: Repository<BankTransaction>,
  ) {}

  /**
   * `from`/`to` là epoch ms, cùng khuôn với `historyQuery` của màn Lịch sử.
   *
   * Lọc theo `created_at` của mã (lúc chìa QR ra) chứ không theo `occurred_at` của tiền: câu hỏi
   * là "những lần thu của hôm nay đã về tiền chưa", mà tiền của lần thu cuối ngày có thể về sau
   * nửa đêm. Lọc theo giờ tiền về sẽ làm đúng những đơn đáng lo nhất rơi khỏi danh sách.
   */
  @Get('reconcile')
  async reconcile(@Query('from') from?: string, @Query('to') to?: string): Promise<ApiOk<BankReconcile>> {
    const fromMs = Number(from) || 0;
    const toMs = Number(to) || Date.now();

    const all = await this.intents.find({
      where: { created_at: Between(fromMs, toMs) },
      order: { created_at: 'DESC' },
    });

    const confirmed = all.filter((i) => i.paid_at !== null).length;
    const unpaid = all.filter((i) => i.paid_at === null);

    // Một truy vấn cho tất cả, không phải mỗi đơn một lần đếm ảnh.
    const orderIds = unpaid.filter((i) => i.target_type === 'POS').map((i) => i.target_id);
    const withPhoto = new Set<string>();
    if (orderIds.length > 0) {
      const rows = await this.intents.manager
        .createQueryBuilder()
        .select('p.order_id', 'order_id')
        .from(OrderPaymentPhoto, 'p')
        .where('p.order_id IN (:...ids)', { ids: orderIds })
        .groupBy('p.order_id')
        .getRawMany<{ order_id: string }>();
      for (const r of rows) withPhoto.add(r.order_id);
    }

    const pending = unpaid.map((i) => ({
      code: i.code,
      target_type: i.target_type,
      target_id: i.target_id,
      amount: i.amount,
      received: i.received_amount,
      has_photo: withPhoto.has(i.target_id),
    }));

    const unknown = (
      await this.txns.find({
        where: { applied_intent_id: IsNull(), occurred_at: Between(fromMs, toMs) },
        order: { occurred_at: 'DESC' },
        take: 50,
      })
    ).map((t) => ({
      amount: t.amount,
      content: t.content,
      occurred_at: t.occurred_at,
      account_no: t.account_no,
    }));

    return apiOk({ total: all.length, confirmed, pending, unknown });
  }
}

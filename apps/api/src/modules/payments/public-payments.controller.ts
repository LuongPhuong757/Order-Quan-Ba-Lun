import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { apiOk, type ApiOk } from '@order/utils';
import { paymentNote } from '@order/schemas';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import { PaymentsService } from './payments.service.js';
import { OnlineOrderRequest } from '../public/entities/online-order-request.entity.js';

/** Thứ trang QR của khách cần biết. KHÔNG trả `target_id` hay bất cứ id nội bộ nào — `order_token`
 *  đã là credential của trang này, thêm id khác chỉ mở rộng bề mặt rò dữ liệu. */
export type PublicPaymentState = {
  code: string;
  note: string;
  amount: number;
  qr_payload: string | null;
  expires_at: number;
  paid_at: number | null;
  received_amount: number;
};

/**
 * Trang trả tiền của khách cho đơn online (2026-09-22).
 *
 * TÁCH KHỎI `PublicOrderStatus` có chủ ý: hợp đồng đó là `.strict()` và được cả `apps/shop` lẫn
 * một loạt test bám vào, còn màn QR là một màn riêng chỉ hỏi đúng ba câu (mã, số tiền, đã trả
 * chưa). Nhét thêm khối `payment` vào giữa hợp đồng cũ thì mọi nơi dùng nó phải biết về một thứ
 * mà 90% thời gian là `null`.
 *
 * Nằm dưới `/api/public/*` nên `CsrfOriginGuard` phủ sẵn — ĐÚNG như mong muốn ở đây, vì cả hai
 * endpoint này đều do trình duyệt của khách gọi (cùng origin). Chỉ webhook của SePay mới phải
 * đứng ngoài, xem `payments-webhook.controller.ts`.
 */
@Controller('api/public/payments')
export class PublicPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    @InjectRepository(PaymentIntent) private readonly intents: Repository<PaymentIntent>,
    @InjectRepository(OnlineOrderRequest) private readonly requests: Repository<OnlineOrderRequest>,
  ) {}

  /**
   * Lấy (hoặc tạo) mã thanh toán cho đơn.
   *
   * CHỈ CHO TRẢ SAU KHI QUÁN ĐÃ DUYỆT (`CONFIRMED`). Hai lý do, cả hai đều là tiền thật:
   *  - trước khi duyệt, phí ship chưa chốt (`ship_fee_estimated` còn là ước tính), nên số tiền in
   *    lên QR sẽ sai;
   *  - đơn chưa duyệt có thể bị TỪ CHỐI, mà tiền đã vào tài khoản thì phải hoàn thủ công — đúng
   *    loại việc mà quán không có quy trình nào để làm.
   *
   * Gọi lại nhiều lần trả về CÙNG một mã: khách F5 hay quay lại trang không được sinh mã mới, nếu
   * không thì mã cũ đã nằm trong app ngân hàng của họ trở thành mồ côi.
   */
  @Post(':token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async start(@Param('token') token: string): Promise<ApiOk<PublicPaymentState>> {
    const req = await this.requests.findOne({ where: { order_token: token } });
    if (!req) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn.' });
    if (req.status !== 'CONFIRMED') {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_READY',
        message: 'Đơn chưa được quán xác nhận, chưa thanh toán được.',
      });
    }

    const amount = await this.amountToPay(req);
    const intent = await this.payments.ensureIntent({
      targetType: 'ONLINE',
      targetId: req.id,
      amount,
    });
    return apiOk(toState(intent));
  }

  /** Trang QR hỏi lại mỗi vài giây trong lúc đang mở. Nhẹ hết mức: một truy vấn theo khoá. */
  @Get(':token')
  @Header('Cache-Control', 'no-store')
  async poll(@Param('token') token: string): Promise<ApiOk<PublicPaymentState | null>> {
    const req = await this.requests.findOne({ where: { order_token: token } });
    if (!req) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn.' });
    const intent = await this.findIntent(req.id);
    return apiOk(intent ? toState(intent) : null);
  }

  private findIntent(requestId: string): Promise<PaymentIntent | null> {
    return this.intents.findOne({
      where: { target_type: 'ONLINE', target_id: requestId },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Tiền MÓN + phí ship đã chốt.
   *
   * `subtotal` cố ý KHÔNG gồm phí ship (M2.D-62 — phí ship là tiền thu hộ), nên phải cộng tay ở
   * đây. Phí ship chốt nằm trên `orders.ship_fee` sau khi quán duyệt; đơn chưa có `order_id` thì
   * không thể tới được nhánh này vì đã chặn ở `status !== 'CONFIRMED'` phía trên.
   */
  private async amountToPay(req: OnlineOrderRequest): Promise<number> {
    if (!req.order_id) return req.subtotal;
    const row = await this.requests.manager.query(
      'SELECT ship_fee FROM orders WHERE id = ? LIMIT 1',
      [req.order_id],
    );
    const shipFee = Number(row?.[0]?.ship_fee ?? 0);
    return req.subtotal + (Number.isFinite(shipFee) ? shipFee : 0);
  }
}

function toState(i: PaymentIntent): PublicPaymentState {
  return {
    code: i.code,
    note: paymentNote(i.code),
    amount: i.amount,
    qr_payload: i.qr_payload,
    expires_at: i.expires_at,
    paid_at: i.paid_at,
    received_amount: i.received_amount,
  };
}

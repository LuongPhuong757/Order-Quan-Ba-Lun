import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import type { Request } from 'express';
import { apiOk, type ApiOk } from '@order/utils';
import { paymentNote } from '@order/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { PaymentsService } from './payments.service.js';

/**
 * Cấp mã thanh toán cho một lần thu tiền TẠI QUẦY (2026-09-22).
 *
 * Vì sao cần một lượt gọi mạng ở màn thu tiền, khi QR vốn dựng offline được: mã phải DUY NHẤT
 * trong toàn hệ thống, mà thứ duy nhất biết được điều đó là DB. Sinh mã ở trình duyệt thì hai máy
 * thu tiền cùng lúc có thể ra cùng một mã, và webhook về không biết trả tiền cho bàn nào.
 *
 * ⚠ BẤT BIẾN PHẢI GIỮ: **nút Thanh toán không bao giờ bị chặn bởi QR hay mạng**
 * (`CheckoutDialog.tsx`, chủ quán chốt 2026-09-14). Endpoint này hỏng hoặc mạng chết thì màn thu
 * tiền PHẢI lùi về nội dung CK cũ không mã ("BAN05 LUONG THUY") và thu tiền bình thường — mất
 * đối soát tự động cho đơn đó, không mất khả năng thu tiền. Phía gọi ở FE chịu trách nhiệm điều
 * này; đừng bao giờ biến lỗi ở đây thành lỗi chặn màn.
 *
 * Tiền tố RIÊNG `/payments` chứ không ghép vào `@Controller('orders')` đang có: hai controller
 * cùng tiền tố thì route của cái này vô hình với người đọc `orders.controller.ts`, mà đó đúng là
 * chỗ người ta mở ra khi đi tìm "đơn có những endpoint nào". Đổi lại phải thêm `/payments` vào
 * danh sách proxy liệt kê cứng của Vite — xem `vite.config.ts`.
 */
@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PosPaymentsController {
  private readonly log = new Logger(PosPaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    @InjectRepository(PaymentIntent) private readonly intents: Repository<PaymentIntent>,
  ) {}

  /**
   * Màn thu tiền hỏi "ngân hàng báo về chưa" trong lúc khách vừa chuyển xong.
   *
   * Nhẹ hết mức có thể — một truy vấn theo khoá duy nhất — vì nó bị gọi vài lần một giây trong
   * đúng 10 giây người thu đứng đợi trước mặt khách.
   *
   * KHÔNG dùng `AdminGuard`: người đứng quầy phải xem được kết quả của chính lần thu họ đang làm.
   * Thứ lộ ra ở đây chỉ là số tiền của một mã mà họ vừa tự tạo.
   */
  @Get('intent/:code')
  @Header('Cache-Control', 'no-store')
  async status(
    @Param('code') code: string,
  ): Promise<ApiOk<{ paid: boolean; received_amount: number; amount: number }>> {
    const intent = await this.intents.findOne({ where: { code } });
    if (!intent) {
      throw new NotFoundException({ code: 'PAYMENT_CODE_NOT_FOUND', message: 'Không thấy mã thanh toán.' });
    }
    return apiOk({
      paid: intent.paid_at !== null,
      received_amount: intent.received_amount,
      amount: intent.amount,
    });
  }

  @Post('intent')
  @HttpCode(200)
  async create(
    @Body()
    body: {
      order_id?: string;
      amount?: number;
      account_id?: string | null;
      /** Mã bàn, chỉ để lấy hai chữ số nhét vào chính mã thanh toán (`BAN05ABC`). Nhận từ client
       *  là chấp nhận được: nó chỉ ảnh hưởng phần ĐỌC BẰNG MẮT của mã, còn tính duy nhất do khoá
       *  `UNIQUE(code, code_day)` ở DB bảo đảm, không phụ thuộc client nói gì. */
      table_code?: string | null;
    },
    @Req() req: Request,
  ): Promise<ApiOk<{ code: string; note: string }>> {
    // Cùng cánh cửa với việc thu chuyển khoản: ai không được thu CK thì cũng không có việc gì để
    // xin mã. `can_collect_transfer` do `JwtAuthGuard` nạp từ DB mỗi request (KHÔNG nằm trong
    // token — nhét vào token thì tắt quyền xong nhân viên vẫn thu được tới lúc đăng xuất).
    if (!req.user?.can_collect_transfer) {
      throw new ForbiddenException({
        code: 'TRANSFER_NOT_ALLOWED',
        message: 'Tài khoản này chưa được bật quyền thu chuyển khoản.',
      });
    }

    const orderId = String(body?.order_id ?? '');
    const amount = Number(body?.amount);
    if (!orderId || !Number.isInteger(amount) || amount <= 0) {
      throw new ForbiddenException({
        code: 'PAYMENT_INTENT_INVALID',
        message: 'Thiếu đơn hoặc số tiền để sinh mã thanh toán.',
      });
    }

    const intent = await this.payments.ensureIntent({
      targetType: 'POS',
      targetId: orderId,
      amount,
      tableNo: tableNoFrom(body?.table_code),
      accountId: body?.account_id ?? null,
    });
    return apiOk({ code: intent.code, note: intent.note ?? paymentNote(intent.code) });
  }
}

/** `B05` → 5 · `ban-12` → 12 · bàn không có số ("Mang về") → `null`, thành `00` trong mã. */
function tableNoFrom(code: string | null | undefined): number | null {
  const digits = String(code ?? '').match(/\d+/)?.[0];
  return digits ? Number(digits) : null;
}

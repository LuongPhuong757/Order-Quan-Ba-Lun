import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { apiOk, type ApiOk } from '@order/utils';
import { OnlineOrderSubmit, type PublicOrderStatus } from '@order/schemas';
import { PublicOrdersService } from './public-orders.service.js';

/**
 * `POST /api/public/orders` + `GET /api/public/orders/:token` — trái tim của phase 8.
 *
 * `CsrfOriginGuard` đã phủ `/api/public/*` từ plan 08-07 (T-08-32) — endpoint mutation này
 * sống được là nhờ dependency cứng đó, KHÔNG tự thêm ngoại lệ path nào ở đây.
 *
 * `@Throttle` riêng 10 request/phút/IP cho `POST orders` — CHẶT HƠN throttler `default`
 * toàn cục (600/phút/IP, `app.module.ts`) vẫn áp song song, không thay thế nó.
 *
 * Response giữ đúng khuôn `apiOk()`/error compact của `public.controller.ts` (docblock bắt
 * buộc dùng lại, xem 08-RESEARCH.md Pitfall #6 — KHÔNG thêm 9 code phase 8 vào
 * `FRIENDLY_VN` của `GlobalExceptionFilter`, message build tại `submit-order.ts`).
 */
@Controller('api/public')
export class PublicOrdersController {
  constructor(private readonly svc: PublicOrdersService) {}

  @Post('orders')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async submit(@Body() body: unknown, @Req() req: Request): Promise<ApiOk<{ order_token: string }>> {
    const parsed = OnlineOrderSubmit.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Dữ liệu đơn hàng không hợp lệ, vui lòng kiểm tra lại.',
        field_errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const userAgentHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader) ? (userAgentHeader[0] ?? '') : (userAgentHeader ?? '');

    // KHÔNG trả lại items_snapshot/subtotal trong response — khách đã tự biết giỏ hàng của
    // mình, giảm bề mặt rò dữ liệu server-side (T-08-49 phụ).
    const { order_token } = await this.svc.submit(parsed.data, {
      ip: req.ip ?? '',
      userAgent,
      nowMs: Date.now(),
    });
    return apiOk({ order_token });
  }

  @Get('orders/:token')
  @Header('Cache-Control', 'no-store')
  async getByToken(@Param('token') token: string): Promise<ApiOk<PublicOrderStatus>> {
    return apiOk(await this.svc.getByToken(token));
  }
}

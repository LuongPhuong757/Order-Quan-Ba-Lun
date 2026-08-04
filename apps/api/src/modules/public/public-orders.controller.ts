import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { apiOk, type ApiOk } from '@order/utils';
import {
  OnlineOrderSubmit,
  PublicOrderLookup,
  type PublicOrderCancelResult,
  type PublicOrderHistory,
  type PublicOrderStatus,
} from '@order/schemas';
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

  /**
   * Tra cứu lịch sử đơn theo SĐT (2026-08-04) — trang "Đơn của tôi" ở apps/shop.
   *
   * POST chứ không GET dù đây là thao tác ĐỌC: SĐT không được nằm trên URL (lọt access log
   * nginx + history), xem docblock `PublicOrderLookup`. Hệ quả chấp nhận được: đi qua
   * `CsrfOriginGuard` như mọi POST của `/api/public/*` — FE cùng origin nên vô hại.
   *
   * `@Throttle` 10/phút/IP — với endpoint này còn là chốt CHỐNG DÒ QUÉT SĐT hàng loạt
   * (ranh giới "ai biết SĐT là xem được" đã chốt, xem docblock schema).
   */
  @Post('orders/lookup')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async lookupByPhone(@Body() body: unknown): Promise<ApiOk<PublicOrderHistory>> {
    const parsed = PublicOrderLookup.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Số điện thoại không hợp lệ' });
    }
    return apiOk(await this.svc.lookupByPhone(parsed.data.phone));
  }

  /**
   * Khách tự huỷ đơn khi quán chưa duyệt (M2.D-44 nửa huỷ).
   *
   * `@Throttle` giống hệt `POST orders` — huỷ đơn là thao tác GHI, không được lỏng hơn đặt đơn
   * (T-09-81). `CsrfOriginGuard` đã phủ `DELETE` trên `/api/public/*` sẵn
   * (`csrf-origin.middleware.ts` có `DELETE` trong `MUTATION_METHODS`), KHÔNG thêm ngoại lệ nào.
   *
   * Ranh giới quyền đã cân nhắc và chấp nhận (T-09-80): `order_token` là credential DUY NHẤT của
   * trang này — ai có link là huỷ được, y hệt ai có link là xem được đơn qua `GET /:token` đã
   * ship từ phase 8. Bắt khách nhập SĐT để huỷ sẽ phá đúng mục tiêu "khách tự huỷ thoải mái,
   * không cần xin phép" của M2.D-44. Thiệt hại bị chặn ở chỗ khác: chỉ huỷ được khi còn
   * `WAITING`, và sau khi quán xác nhận thì thao tác này không còn tác dụng.
   */
  @Delete('orders/:token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async cancelByToken(@Param('token') token: string): Promise<ApiOk<PublicOrderCancelResult>> {
    return apiOk(await this.svc.cancelByToken(token));
  }
}

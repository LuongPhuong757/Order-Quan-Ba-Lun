import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { apiOk, type ApiOk } from '@order/utils';
import {
  DineInCartCancel,
  DineInCartCreate,
  type DineInCartCreateResult,
  type PublicDineInCartStatus,
} from '@order/schemas';
import { DineInCartsService } from './dine-in-carts.service.js';

/**
 * `/api/public/dine-in-carts` — khách quét QR chung trong quán, chọn món, rồi bấm "Sinh mã"
 * để đọc 5 số cho nhân viên (M4, docs/MILESTONE-04-QR-DINE-IN-SPEC.md).
 *
 * `CsrfOriginGuard` đã phủ `/api/public/*` (POST + DELETE nằm trong `MUTATION_METHODS`) —
 * endpoint mutation ở đây sống nhờ dependency cứng đó, KHÔNG tự thêm ngoại lệ path nào.
 *
 * `@Throttle` 10/phút/IP giống `POST /api/public/orders`. Lưu ý đây là lớp chặn theo IP nên nó
 * áp cho CẢ QUÁN (chung wifi) — nó chỉ chặn kịch bản bấm loạn, còn hạn mức thật cho mỗi thiết
 * bị là `DINE_IN_MAX_CODES_PER_TOKEN_PER_WINDOW` trong `create-cart.ts`, đếm trong DB theo
 * `customer_token`. Đừng siết con số dưới đây xuống: 10/phút cho cả quán đã là sát.
 */
@Controller('api/public')
export class PublicDineInCartsController {
  constructor(private readonly svc: DineInCartsService) {}

  @Post('dine-in-carts')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ApiOk<DineInCartCreateResult>> {
    const parsed = DineInCartCreate.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Giỏ hàng không hợp lệ, vui lòng chọn lại món.',
        field_errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const uaHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(uaHeader) ? (uaHeader[0] ?? '') : (uaHeader ?? '');

    return apiOk(
      await this.svc.create(parsed.data, {
        ip: req.ip ?? '',
        userAgent,
        nowMs: Date.now(),
      }),
    );
  }

  /**
   * Khách mở lại tab thì vẫn thấy mã + hạn còn lại (M4.D-08).
   *
   * Ranh giới quyền đã cân nhắc: mã 5 số nằm trên URL nên ai dò được mã là xem được giỏ. Chấp
   * nhận vì thứ lộ ra ở đây gần như không có giá trị — số món và tổng tiền của một giỏ vô danh,
   * không tên, không SĐT, không bàn (`PublicDineInCartStatus` là whitelist `.strict()`). Thao
   * tác GHI thì chặt hơn hẳn: `DELETE` bắt `customer_token` khớp.
   */
  @Get('dine-in-carts/:code')
  @Header('Cache-Control', 'no-store')
  async getByCode(@Param('code') code: string): Promise<ApiOk<PublicDineInCartStatus>> {
    return apiOk(await this.svc.getByCode(code, Date.now()));
  }

  /**
   * Nút "Sửa lại" (M4.D-07) — huỷ mã cũ để khách sửa giỏ rồi sinh mã mới.
   *
   * `customer_token` đi trong BODY chứ không phải URL: token là credential của thiết bị, đưa
   * lên query string là để nó lọt vào access log của nginx. `DELETE` có body là hợp lệ theo
   * spec HTTP và Nest/Express xử lý bình thường.
   */
  @Delete('dine-in-carts/:code')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async cancelByCode(
    @Param('code') code: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ApiOk<{ cancelled: boolean }>> {
    const parsed = DineInCartCancel.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Thiếu thông tin thiết bị, vui lòng tải lại trang.',
      });
    }
    return apiOk(
      await this.svc.cancelByCode(code, parsed.data.customer_token, {
        ip: req.ip ?? '',
        nowMs: Date.now(),
      }),
    );
  }
}

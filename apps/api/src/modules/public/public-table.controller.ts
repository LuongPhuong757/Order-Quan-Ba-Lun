import { BadRequestException, Body, Controller, Get, Header, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Req } from '@nestjs/common';
import { apiOk, type ApiOk } from '@order/utils';
import {
  TableCallInput,
  TableCartInput,
  TableOpenInput,
  type TableCartResult,
  type TableOpenResult,
  type TableStateResult,
} from '@order/schemas';
import { TableGuestService } from './table-guest.service.js';
import { hashIp, resolveIpHashSalt } from './ip-hash.js';

/**
 * M7 — khách tự gọi món tại bàn. Bốn endpoint CÔNG KHAI, không đăng nhập.
 *
 * `CsrfOriginGuard` đã phủ sẵn `/api/public/*` → mọi POST bắt buộc có header `Origin` hợp lệ.
 * Thử tay bằng curl mà quên `Origin` thì nhận 403, và triệu chứng trông y hệt lỗi code.
 *
 * ⚠ M7.R6 — `getTracker` của throttler PHẢI đổi sang `guest:<token>` cho nhánh này. Cả quán đi
 *   chung MỘT IP public; 20 khách poll 5 giây là +240 req/phút trên đúng IP đó, đủ làm 429 nút
 *   "Báo bếp" của nhân viên.
 */
@Controller('api/public/table')
export class PublicTableController {
  constructor(private readonly svc: TableGuestService) {}

  private ipHashOf(req: Request): string | null {
    const ip = req.ip ?? null;
    return ip ? hashIp(ip, resolveIpHashSalt()) : null;
  }

  /** M7.R1 — KHÔNG tạo dòng `orders` nào. Gõ bừa 30 số bàn không làm bẩn sơ đồ. */
  @Post('open')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async open(@Body() body: unknown, @Req() req: Request): Promise<ApiOk<TableOpenResult>> {
    const parsed = TableOpenInput.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ.' });
    }
    return apiOk(await this.svc.open(parsed.data, this.ipHashOf(req)));
  }

  @Post('cart')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async cart(@Body() body: unknown, @Req() req: Request): Promise<ApiOk<TableCartResult>> {
    const parsed = TableCartInput.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ.' });
    }
    return apiOk(await this.svc.submitCart(parsed.data, this.ipHashOf(req)));
  }

  /**
   * Token đi bằng HEADER chứ không query string: GET không có body, mà URL thì lọt vào log của
   * proxy, lịch sử trình duyệt và referrer. Cùng lý do `POST orders/lookup` không cho SĐT lên URL.
   */
  @Get('state')
  @Header('Cache-Control', 'no-store')
  async state(@Headers('x-guest-token') token: string | undefined): Promise<ApiOk<TableStateResult>> {
    if (!token) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Thiếu phiên.' });
    }
    return apiOk(await this.svc.getState(token));
  }

  @Post('call')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async call(@Body() body: unknown): Promise<ApiOk<{ call_id: string; cooldown_until: number }>> {
    const parsed = TableCallInput.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ.' });
    }
    return apiOk(await this.svc.createCall(parsed.data.guest_token, parsed.data.kind));
  }
}

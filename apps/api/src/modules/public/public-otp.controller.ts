import { BadRequestException, Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { apiOk, type ApiOk } from '@order/utils';
import {
  PublicOtpRequest,
  PublicOtpRequestResult,
  PublicOtpVerify,
  type PublicPhoneSession,
} from '@order/schemas';
import { PublicOtpService } from './public-otp.service.js';

/**
 * `POST /api/public/otp/request` + `POST /api/public/otp/verify` (2026-08-04) — cửa vào
 * duy nhất của "đăng nhập bằng OTP" phía khách.
 *
 * `CsrfOriginGuard` đã phủ mọi POST của `/api/public/*` — không thêm ngoại lệ path nào.
 *
 * `@Throttle` ở đây chỉ là lớp CHẶN THÔ theo IP; rate limit THẬT (cooldown 60s, 3 mã/giờ/SĐT,
 * 10 mã/giờ/IP) đếm trong DB ở `otp.ts` — sống sót qua restart, đúng khuôn D-18. Mã lỗi OTP
 * (`OTP_INVALID`/`OTP_EXPIRED`/...) build message tại chỗ throw, không thêm vào `FRIENDLY_VN`.
 */
@Controller('api/public/otp')
export class PublicOtpController {
  constructor(private readonly svc: PublicOtpService) {}

  @Post('request')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async request(@Body() body: unknown, @Req() req: Request): Promise<ApiOk<PublicOtpRequestResult>> {
    const parsed = PublicOtpRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Số điện thoại không hợp lệ' });
    }
    const result = await this.svc.request(parsed.data.phone, { ip: req.ip ?? '', nowMs: Date.now() });
    return apiOk(PublicOtpRequestResult.strict().parse(result));
  }

  @Post('verify')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(@Body() body: unknown, @Req() req: Request): Promise<ApiOk<PublicPhoneSession>> {
    const parsed = PublicOtpVerify.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ' });
    }
    const session = await this.svc.verify(
      {
        phone: parsed.data.phone,
        code: parsed.data.code,
        currentSessionToken: parsed.data.current_session_token,
      },
      { ip: req.ip ?? '', nowMs: Date.now() },
    );
    return apiOk(session);
  }
}

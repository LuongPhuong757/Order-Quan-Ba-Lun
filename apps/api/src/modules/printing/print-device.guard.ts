import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PrintingService } from './printing.service.js';
import type { PrintDevice } from './entities/print-device.entity.js';

/** Request đã qua guard thì chắc chắn có `printDevice`. */
export type PrintDeviceRequest = Request & { printDevice: PrintDevice };

/**
 * Xác thực CẦU IN bằng token thiết bị trong header `x-print-token`.
 *
 * Cố ý KHÔNG dùng `JwtAuthGuard`: cầu in là một script chạy 24/7 trên máy tính bảng đặt ở quầy,
 * không phải một con người đăng nhập. Cho nó mượn phiên của nhân viên nghĩa là một tài khoản
 * thật đăng nhập vĩnh viễn trên một thiết bị ai cũng chạm được — và mọi thao tác của script sẽ
 * mang tên người đó trong nhật ký. Token riêng chỉ mở đúng 3 endpoint `/print/*`, thu hồi được
 * độc lập, và không lẫn vào lịch sử của bất kỳ ai.
 */
@Injectable()
export class PrintDeviceGuard implements CanActivate {
  constructor(private readonly printing: PrintingService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = req.headers['x-print-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    const device = await this.printing.findDeviceByToken((token ?? '').trim());
    if (!device) throw new UnauthorizedException('Token thiết bị in không hợp lệ hoặc đã bị thu hồi');
    (req as PrintDeviceRequest).printDevice = device;
    return true;
  }
}

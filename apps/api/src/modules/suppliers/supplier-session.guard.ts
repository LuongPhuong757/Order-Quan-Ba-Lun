// Guard cho cổng nhà cung cấp (bước 4).
//
// Đọc token phiên từ header `x-supplier-token` và gắn `req.supplier`. KHÔNG dùng chung
// `JwtAuthGuard` của nhân viên: NCC không phải một dòng trong bảng `users`, không có role, và
// không được phép chạm vào bất cứ endpoint nội bộ nào. Trộn hai loại chủ thể vào một guard là
// cách nhanh nhất để một ngày nào đó NCC nhìn thấy doanh thu của quán.
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SupplierAuthService, type SupplierPrincipal } from './supplier-auth.service.js';

declare module 'express' {
  interface Request {
    supplier?: SupplierPrincipal;
  }
}

@Injectable()
export class SupplierSessionGuard implements CanActivate {
  constructor(private readonly auth: SupplierAuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = req.headers['x-supplier-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    const nowMs = Date.now();

    const principal = await this.auth.resolveSession(token ?? '', nowMs);
    if (!principal) {
      throw new UnauthorizedException({
        code: 'SUPPLIER_SESSION_INVALID',
        message: 'Phiên đã hết hạn — đăng nhập lại giúp quán nhé.',
      });
    }

    req.supplier = principal;
    // Gia hạn trượt, không chặn luồng nếu hỏng: NCC đang đứng giao hàng, một lỗi ghi bảng phiên
    // không được phép làm họ không gửi được phiếu.
    void this.auth.touch(principal.session_token, nowMs).catch(() => undefined);
    return true;
  }
}

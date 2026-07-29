// RequireRoles(...roles): factory sinh guard chặn theo danh sách role cho phép.
//
// Khác AdminGuard (chỉ 'admin') — dùng khi endpoint mở cho NHIỀU role nhưng không
// phải tất cả. Ví dụ nhật ký bàn: admin + order được, bếp KHÔNG (không liên quan
// nghiệp vụ bàn/tiền).
//
// Không tự chạy JwtAuthGuard: guard này chỉ dùng ở method-level dưới controller
// đã có @UseGuards(JwtAuthGuard) ở class-level (Nest chạy class guard trước method
// guard), nên req.user chắc chắn đã được gán.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  mixin,
  type Type,
} from '@nestjs/common';
import type { Request } from 'express';

export function RequireRoles(...allowed: string[]): Type<CanActivate> {
  @Injectable()
  class RolesGuardMixin implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<Request>();
      // owner cũ có thể chưa được gán role → coi như admin (giống jwt-auth.guard)
      const role = req.user?.role ?? (req.user?.is_owner ? 'admin' : null);
      if (!role || !allowed.includes(role)) {
        throw new ForbiddenException({
          code: 'ROLE_FORBIDDEN',
          message: 'Bạn không có quyền xem mục này.',
        });
      }
      return true;
    }
  }
  return mixin(RolesGuardMixin);
}

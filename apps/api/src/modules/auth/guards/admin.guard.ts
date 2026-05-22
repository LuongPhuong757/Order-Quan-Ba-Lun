// AdminGuard: extends JwtAuthGuard + check role === 'admin'.
// Khác OwnerGuard (chỉ chủ quán is_owner=true): cho phép MỌI user role admin
// quản lý nhân viên (thêm/sửa/xoá). Owner cũng có role='admin' nên vẫn pass.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwtGuard: JwtAuthGuard) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const ok = await this.jwtGuard.canActivate(ctx);
    if (!ok) return false;
    const req = ctx.switchToHttp().getRequest<Request>();
    // role='admin' bao gồm cả owner (jwt-auth gán role='admin' khi is_owner=true)
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException({
        code: 'ADMIN_REQUIRED',
        message: 'Chỉ admin mới có quyền thực hiện thao tác này',
      });
    }
    return true;
  }
}

// P01.D-02 — OwnerGuard: extends JwtAuthGuard + check is_owner
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(private readonly jwtGuard: JwtAuthGuard) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // First run JWT guard
    const ok = await this.jwtGuard.canActivate(ctx);
    if (!ok) return false;
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user?.is_owner) {
      throw new ForbiddenException({
        code: 'ADMIN_REQUIRED',
        message: 'Only owner can do this',
      });
    }
    return true;
  }
}

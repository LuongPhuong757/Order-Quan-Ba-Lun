// P01.D-08 — JwtAuthGuard: cookie → verify → JTI blacklist → token_version → is_active
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService, JwtPayload } from '../jwt.service.js';
import { User, canCollectTransfer } from '../entities/user.entity.js';
import { RevokedJti } from '../entities/revoked-jti.entity.js';
import { isBlockedWrite } from '../read-only-role.js';
import { isBlockedForPrintRole } from '../print-role.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtSvc: JwtService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RevokedJti) private readonly jtiRepo: Repository<RevokedJti>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const cookieName = this.jwtSvc.cookieName;
    const token = (req.cookies as Record<string, string>)?.[cookieName];
    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH_INVALID_CRED',
        message: 'No token',
      });
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtSvc.verify(token);
    } catch (err) {
      const msg = (err as Error).name === 'TokenExpiredError' ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_INVALID_CRED';
      throw new UnauthorizedException({ code: msg, message: 'Token invalid/expired' });
    }

    // JTI blacklist check
    const revoked = await this.jtiRepo.findOne({ where: { jti: payload.jti } });
    if (revoked) {
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_REVOKED', message: 'Token revoked' });
    }

    // is_active + token_version match
    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CRED', message: 'User not found' });
    }
    if (!user.is_active) {
      throw new UnauthorizedException({ code: 'AUTH_INACTIVE_USER', message: 'User disabled' });
    }
    if (Number(user.token_version) !== payload.tv) {
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_REVOKED', message: 'token_version mismatch' });
    }
    // Chặn user chưa được gán role (admin chưa duyệt)
    if (!user.role && !user.is_owner) {
      throw new UnauthorizedException({
        code: 'AUTH_ROLE_NOT_ASSIGNED',
        message: 'Tài khoản chưa được gán quyền, liên hệ admin để duyệt.',
      });
    }

    req.user = {
      sub: payload.sub,
      name: payload.name,
      full_name: user.full_name || user.username,
      is_owner: user.is_owner,
      role: user.role || (user.is_owner ? 'admin' : null),
      // Đọc từ DB mỗi request (guard này vốn đã tải user để kiểm `is_active`/`token_version`),
      // KHÔNG nhét vào token: nhét vào token thì chủ quán tắt công tắc xong nhân viên vẫn thu
      // được cho tới lúc đăng xuất — thường là hết ca, tức công tắc vô dụng đúng lúc cần nhất.
      can_collect_transfer: canCollectTransfer(user),
      jti: payload.jti,
    };

    // Chốt chặn GHI của role chỉ-đọc (`report`). Đặt ở ĐÂY chứ không ở guard riêng vì đây là
    // điểm MỌI request đã đăng nhập đều đi qua — kể cả route chỉ gắn `AdminGuard`/`ReportGuard`
    // (hai guard đó tự gọi guard này) và route chỉ gắn `JwtAuthGuard` ở class-level. Gắn ở
    // APP_GUARD toàn cục thì không dùng được: guard toàn cục chạy TRƯỚC guard của route, lúc đó
    // `req.user` chưa được gán nên không biết role là gì.
    // Role `print` là MÁY IN ở quầy, không phải một con người. Chặn ở đây vì cùng lý do với
    // `isBlockedWrite` ngay bên dưới: đây là điểm duy nhất mọi request đã đăng nhập đi qua, kể
    // cả route chỉ gắn `JwtAuthGuard` ở cấp lớp — mà `POST /orders/:id/checkout` đúng là một
    // route như vậy. Xem `print-role.ts` về vì sao là danh sách CHO PHÉP chứ không phải CẤM.
    if (isBlockedForPrintRole(req.user.role, req.path)) {
      throw new ForbiddenException({
        code: 'PRINT_ROLE_FORBIDDEN',
        message: 'Tài khoản Máy in chỉ dùng để in hoá đơn, không làm được thao tác này.',
      });
    }

    if (isBlockedWrite(req.user.role, req.method, req.path)) {
      throw new ForbiddenException({
        code: 'READ_ONLY_ROLE',
        message: 'Quyền Báo cáo chỉ được xem, không thực hiện được thao tác này.',
      });
    }
    return true;
  }
}

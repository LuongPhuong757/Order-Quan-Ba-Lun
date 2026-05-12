// P01.D-08 — JwtAuthGuard: cookie → verify → JTI blacklist → token_version → is_active
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService, JwtPayload } from '../jwt.service.js';
import { User } from '../entities/user.entity.js';
import { RevokedJti } from '../entities/revoked-jti.entity.js';

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

    req.user = {
      sub: payload.sub,
      name: payload.name,
      full_name: user.full_name || user.username,
      is_owner: user.is_owner,
      jti: payload.jti,
    };
    return true;
  }
}

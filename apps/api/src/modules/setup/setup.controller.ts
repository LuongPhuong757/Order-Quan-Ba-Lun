// P01.D-05 + D-24 — First owner bootstrap (DB-empty + IP allowlist guard)
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity.js';
import { AuthService } from '../auth/auth.service.js';
import { SetupDto } from '../auth/dto/auth.dto.js';

const SETUP_ALLOWED_IPS = (process.env.SETUP_ALLOWED_IP || '127.0.0.1,::1').split(',').map((s) => s.trim());

function ipAllowed(ip: string): boolean {
  // ::ffff:127.0.0.1 → 127.0.0.1
  const normalized = ip.replace(/^::ffff:/, '');
  return SETUP_ALLOWED_IPS.includes(normalized) || SETUP_ALLOWED_IPS.includes(ip);
}

@Controller('setup')
export class SetupController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /** E-06 GET /setup — returns 200 if DB empty + IP allowed, else 404 */
  @Get()
  async check(@Req() req: Request) {
    if (!ipAllowed(req.ip || '')) {
      throw new ForbiddenException({
        code: 'SETUP_IP_BLOCKED',
        message: `Setup blocked from IP ${req.ip}`,
      });
    }
    const ownerCount = await this.userRepo.count({ where: { is_owner: true } });
    if (ownerCount > 0) {
      throw new NotFoundException({ code: 'SETUP_ALREADY_DONE', message: 'Setup already completed' });
    }
    return { data: { status: 'ready', message: 'No owner yet. POST /setup to create.' } };
  }

  /** E-07 POST /setup — atomic transaction (DB-empty check inside) */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: SetupDto, @Req() req: Request) {
    if (!ipAllowed(req.ip || '')) {
      throw new ForbiddenException({
        code: 'SETUP_IP_BLOCKED',
        message: `Setup blocked from IP ${req.ip}`,
      });
    }

    return await this.ds.transaction(async (mgr) => {
      const userRepo = mgr.getRepository(User);

      // Atomic check: count owners with row lock (MySQL InnoDB will serialize via UNIQUE constraint later, but pre-check first)
      const ownerCount = await userRepo.count({ where: { is_owner: true } });
      if (ownerCount > 0) {
        throw new BadRequestException({ code: 'SETUP_ALREADY_DONE', message: 'Setup already completed' });
      }

      const hash = await AuthService.hashPassword(dto.password);
      const user = userRepo.create({
        username: dto.username,
        full_name: dto.full_name.trim(),
        password_hash: hash,
        is_owner: true,
        role: 'admin',
        is_active: true,
        token_version: 0,
      });
      await userRepo.save(user);

      // Không còn sinh mã khôi phục (bỏ 2026-11-09 cùng `POST /auth/recover`). Chủ quán quên
      // mật khẩu thì đặt lại bằng script trong container API.
      return { data: { user_id: user.id } };
    });
  }
}

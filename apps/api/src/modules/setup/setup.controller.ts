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
import { randomBytes } from 'crypto';
import { User } from '../auth/entities/user.entity.js';
import { RecoveryCode } from '../auth/entities/recovery-code.entity.js';
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
    @InjectRepository(RecoveryCode) private readonly recoveryRepo: Repository<RecoveryCode>,
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
      const recoveryRepo = mgr.getRepository(RecoveryCode);

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

      // Generate 1-time recovery code (16 chars)
      const recoveryCode = generateRecoveryCode();
      const codeHash = await AuthService.hashPassword(recoveryCode);
      await recoveryRepo.save(recoveryRepo.create({
        user_id: user.id,
        code_hash: codeHash,
        used_at: null as unknown as undefined,
      }));

      return {
        data: {
          user_id: user.id,
          recovery_code: recoveryCode,
          warning: '⚠ Lưu mã khôi phục này NGAY. Nó sẽ KHÔNG hiển thị lại. Nếu mất, bạn không thể reset password owner.',
        },
      };
    });
  }
}

function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous (I, 1, O, 0)
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

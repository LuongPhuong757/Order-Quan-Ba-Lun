import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity.js';
import { OwnerGuard } from '../auth/guards/owner.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { randomBytes } from 'crypto';

class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  full_name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) full_name?: string;
}

@Controller('admin/users')
@UseGuards(OwnerGuard)
export class AdminUsersController {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  /** E-08 POST /admin/users */
  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateUserDto) {
    const exists = await this.userRepo.findOne({ where: { username: dto.username } });
    if (exists) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Username already exists' });
    }
    const hash = await AuthService.hashPassword(dto.password);
    const user = this.userRepo.create({
      username: dto.username,
      full_name: dto.full_name.trim(),
      password_hash: hash,
      is_owner: false,
      is_active: true,
      token_version: 0,
    });
    await this.userRepo.save(user);
    return {
      data: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        is_active: user.is_active,
        created_at: Number(user.created_at),
      },
    };
  }

  /** E-09 GET /admin/users */
  @Get()
  async list(@Query() query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const page_size = Math.min(100, Math.max(1, Number(query.page_size) || 20));
    const [items, total] = await this.userRepo.findAndCount({
      order: { created_at: 'DESC' },
      skip: (page - 1) * page_size,
      take: page_size,
    });
    return {
      data: {
        items: items.map((u) => ({
          id: u.id,
          username: u.username,
          full_name: u.full_name,
          is_active: u.is_active,
          is_owner: u.is_owner,
          created_at: Number(u.created_at),
        })),
        total,
        page,
        page_size,
      },
    };
  }

  /** E-10 POST /admin/users/:id/reset-password */
  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string, @Req() req: Request) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    if (user.is_owner && req.user!.sub !== user.id) {
      throw new BadRequestException({
        code: 'ADMIN_REQUIRED',
        message: 'Cannot reset another owner; use /auth/recover instead',
      });
    }

    const tempPassword = generateTempPassword();
    const hash = await AuthService.hashPassword(tempPassword);
    await this.userRepo.update(
      { id },
      { password_hash: hash, token_version: () => 'token_version + 1' as never },
    );
    return {
      data: {
        temp_password: tempPassword,
        message: 'Đưa mật khẩu này cho nhân viên + yêu cầu họ đổi password sau khi đăng nhập.',
      },
    };
  }

  /** PATCH /admin/users/:id — sửa thông tin nhân viên (hiện chỉ full_name) */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    if (dto.full_name !== undefined) user.full_name = dto.full_name.trim();
    await this.userRepo.save(user);
    return {
      data: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        is_active: user.is_active,
        is_owner: user.is_owner,
        created_at: Number(user.created_at),
      },
    };
  }

  /** E-11 POST /admin/users/:id/disable — soft disable (giữ row, đặt is_active=false) */
  @Post(':id/disable')
  @HttpCode(204)
  async disable(@Param('id') id: string, @Req() req: Request) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    if (user.is_owner && user.id === req.user!.sub) {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Cannot disable self (owner)' });
    }
    if (user.is_active) {
      await this.userRepo.update(
        { id },
        { is_active: false, token_version: () => 'token_version + 1' as never },
      );
    }
  }

  /** DELETE /admin/users/:id — HARD DELETE: xoá hẳn row khỏi DB.
   * Snapshot full_name trên Order/OrderItem vẫn giữ (varchar, không FK) → audit trail
   * vẫn nguyên vẹn ở phía order. Chặn self-delete + chặn owner xoá owner khác. */
  @Delete(':id')
  @HttpCode(204)
  async hardDelete(@Param('id') id: string, @Req() req: Request) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
    if (user.id === req.user!.sub) {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Không thể xoá chính mình' });
    }
    if (user.is_owner) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Không thể xoá tài khoản chủ quán',
      });
    }
    await this.userRepo.delete({ id });
  }
}

/** 12-char temp password (mixed alphanumeric, no ambiguous chars) */
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

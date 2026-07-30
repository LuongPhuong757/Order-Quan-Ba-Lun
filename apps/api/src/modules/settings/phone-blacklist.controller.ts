// GET + POST + DELETE /admin/phone-blacklist — chỉ admin gọi được (AdminGuard class-level).
// M2.D-59 ghi đè M2.D-41: thêm/xoá TAY, KHÔNG tự hết hạn — không có luồng nào ở đây ghi
// `expires_at` khác NULL, và KHÔNG có cron dọn dẹp nào trong phase này.
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
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { PhoneBlacklist } from './entities/phone-blacklist.entity.js';
import { normalizePhone } from '../public/phone.js';

class CreatePhoneBlacklistDto {
  @IsString() @MinLength(1) @MaxLength(20)
  phone!: string;

  @IsString() @MinLength(1) @MaxLength(255)
  reason!: string;
}

@Controller('admin/phone-blacklist')
@UseGuards(AdminGuard)
export class PhoneBlacklistController {
  constructor(
    @InjectRepository(PhoneBlacklist) private readonly repo: Repository<PhoneBlacklist>,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const page_size = Math.min(100, Math.max(1, Number(query.page_size) || 100));
    const normalizedQ = query.q ? normalizePhone(query.q) : null;
    const where = query.q ? { phone: normalizedQ ?? Like(`%${query.q}%`) } : {};
    const [items, total] = await this.repo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      skip: (page - 1) * page_size,
      take: page_size,
    });
    return {
      data: {
        items: items.map((i) => ({
          phone: i.phone,
          reason: i.reason,
          created_at: Number(i.created_at),
          expires_at: i.expires_at !== null ? Number(i.expires_at) : null,
          created_by_user_id: i.created_by_user_id,
          created_by_full_name: i.created_by_full_name,
        })),
        total,
        page,
        page_size,
      },
    };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreatePhoneBlacklistDto, @Req() req: Request) {
    const phone = normalizePhone(dto.phone);
    if (!phone) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Số điện thoại không hợp lệ' });
    }
    const exists = await this.repo.findOne({ where: { phone } });
    if (exists) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Số này đã có trong danh sách' });
    }
    const entry = this.repo.create({
      phone,
      reason: dto.reason.trim(),
      expires_at: null, // vĩnh viễn (M2.D-59) — không nhận từ client
      created_by_user_id: req.user!.sub,
      created_by_full_name: req.user!.full_name,
    });
    await this.repo.save(entry);
    return {
      data: {
        phone: entry.phone,
        reason: entry.reason,
        expires_at: null,
      },
    };
  }

  @Delete(':phone')
  @HttpCode(200)
  async remove(@Param('phone') phoneParam: string) {
    const phone = normalizePhone(phoneParam) ?? phoneParam;
    const exists = await this.repo.findOne({ where: { phone } });
    if (!exists) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Số không có trong danh sách' });
    }
    await this.repo.delete({ phone });
    return { data: { phone } };
  }
}

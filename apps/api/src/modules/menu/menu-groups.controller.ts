import {
  Body, ConflictException, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';
import { MenuGroup } from './entities/menu-group.entity.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OwnerGuard } from '../auth/guards/owner.guard.js';
import { toTitleCase } from '../../common/text.js';

class CreateGroupDto {
  @IsString() @MinLength(1) @MaxLength(16) code!: string;
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsIn(['cook', 'ready-made']) kitchen_type?: string;
  @IsOptional() @IsInt() sort_order?: number;
}

class UpdateGroupDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) name?: string;
  @IsOptional() @IsString() @MaxLength(8) icon?: string;
  @IsOptional() @IsIn(['cook', 'ready-made']) kitchen_type?: string;
  @IsOptional() @IsInt() sort_order?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@Controller('menu-groups')
export class MenuGroupsController {
  constructor(@InjectRepository(MenuGroup) private readonly repo: Repository<MenuGroup>) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list() {
    const items = await this.repo.find({
      where: { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
    return { data: { items } };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(OwnerGuard)
  async create(@Body() dto: CreateGroupDto) {
    const codeLower = dto.code.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!codeLower) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Mã nhóm chỉ chứa chữ thường + số + gạch' });
    }
    const exists = await this.repo.findOne({ where: { code: codeLower } });
    if (exists) throw new ConflictException({ code: 'CONFLICT', message: 'Mã nhóm đã tồn tại' });

    const g = this.repo.create({
      code: codeLower,
      name: toTitleCase(dto.name),
      icon: dto.icon ?? null,
      kitchen_type: dto.kitchen_type ?? 'cook',
      sort_order: dto.sort_order ?? 999,
      is_active: true,
    });
    await this.repo.save(g);
    return { data: g };
  }

  @Patch(':id')
  @UseGuards(OwnerGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateGroupDto) {
    const g = await this.repo.findOne({ where: { id } });
    if (!g) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nhóm không tồn tại' });
    const patched = dto.name !== undefined ? { ...dto, name: toTitleCase(dto.name) } : dto;
    Object.assign(g, patched);
    await this.repo.save(g);
    return { data: g };
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(OwnerGuard)
  async softDelete(@Param('id') id: string) {
    const g = await this.repo.findOne({ where: { id } });
    if (!g) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Nhóm không tồn tại' });
    g.is_active = false;
    await this.repo.save(g);
  }
}

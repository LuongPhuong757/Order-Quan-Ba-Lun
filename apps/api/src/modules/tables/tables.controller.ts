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
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RestaurantTable } from './entities/restaurant-table.entity.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OwnerGuard } from '../auth/guards/owner.guard.js';

class CreateTableDto {
  @IsString() @MinLength(1) @MaxLength(16) code!: string;
  @IsString() @MinLength(1) @MaxLength(64) name!: string;
  @IsIn(['dine-in', 'takeaway', 'delivery']) kind!: string;
  @IsOptional() @IsInt() x?: number;
  @IsOptional() @IsInt() y?: number;
}

class UpdateTableDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) name?: string;
  @IsOptional() @IsIn(['dine-in', 'takeaway', 'delivery']) kind?: string;
  @IsOptional() @IsInt() x?: number;
  @IsOptional() @IsInt() y?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

class BulkCreateTablesDto {
  @IsString() @MinLength(1) @MaxLength(16) start_code!: string;
  @IsString() @MinLength(1) @MaxLength(16) end_code!: string;
  @IsIn(['dine-in', 'takeaway', 'delivery']) kind!: string;
  @IsOptional() @IsString() @MaxLength(64) name_prefix?: string;
}

/** Parse code dạng "B01" → { prefix: "B", num: 1, width: 2 }.
 * Trả về null nếu không match pattern prefix + trailing digits. */
function parseCode(code: string): { prefix: string; num: number; width: number } | null {
  const m = code.match(/^(.*?)(\d+)$/);
  if (!m) return null;
  const [, prefix, numStr] = m;
  return { prefix, num: parseInt(numStr, 10), width: numStr.length };
}

@Controller('tables')
export class TablesController {
  constructor(@InjectRepository(RestaurantTable) private readonly repo: Repository<RestaurantTable>) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list() {
    const items = await this.repo.find({
      where: { is_active: true },
      order: { kind: 'ASC', y: 'ASC', x: 'ASC', code: 'ASC' },
    });
    return { data: { items } };
  }

  /** POST /tables/bulk — tạo range bàn từ start_code → end_code (vd B01 → B10).
   * Chỉ owner. Skip code đã tồn tại, trả về { created, skipped, codes }. */
  @Post('bulk')
  @HttpCode(201)
  @UseGuards(OwnerGuard)
  async bulkCreate(@Body() dto: BulkCreateTablesDto) {
    const start = parseCode(dto.start_code.trim().toUpperCase());
    const end = parseCode(dto.end_code.trim().toUpperCase());
    if (!start || !end) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: 'Mã bàn phải có dạng "prefix + số" (vd: B01, T05, SHIP-12)',
      });
    }
    if (start.prefix !== end.prefix) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Prefix khác nhau: "${start.prefix}" vs "${end.prefix}"`,
      });
    }
    if (end.num < start.num) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Mã kết thúc (${dto.end_code}) phải ≥ mã bắt đầu (${dto.start_code})`,
      });
    }
    const count = end.num - start.num + 1;
    if (count > 100) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Tối đa 100 bàn/lần (yêu cầu ${count})`,
      });
    }
    const width = Math.max(start.width, end.width);
    const codes: string[] = [];
    for (let n = start.num; n <= end.num; n++) {
      codes.push(`${start.prefix}${String(n).padStart(width, '0')}`);
    }
    const existing = await this.repo.find({ where: { code: In(codes) }, select: ['code'] });
    const existingSet = new Set(existing.map((e) => e.code));
    const toCreate = codes.filter((c) => !existingSet.has(c));
    const namePrefix = (dto.name_prefix || 'Bàn').trim();
    const entities = toCreate.map((code, idx) => {
      const numPart = code.slice(start.prefix.length);
      return this.repo.create({
        code,
        name: `${namePrefix} ${numPart}`,
        kind: dto.kind,
        x: 0,
        y: idx,
        is_active: true,
      });
    });
    if (entities.length > 0) await this.repo.save(entities);
    return {
      data: {
        created: entities.length,
        skipped: existingSet.size,
        skipped_codes: [...existingSet],
        created_codes: toCreate,
      },
    };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(OwnerGuard)
  async create(@Body() dto: CreateTableDto) {
    const exists = await this.repo.findOne({ where: { code: dto.code } });
    if (exists) throw new ConflictException({ code: 'CONFLICT', message: 'Mã bàn đã tồn tại' });
    const t = this.repo.create({
      code: dto.code,
      name: dto.name,
      kind: dto.kind,
      x: dto.x ?? 0,
      y: dto.y ?? 0,
      is_active: true,
    });
    await this.repo.save(t);
    return { data: t };
  }

  @Patch(':id')
  @UseGuards(OwnerGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });
    Object.assign(t, dto);
    await this.repo.save(t);
    return { data: t };
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(OwnerGuard)
  async softDelete(@Param('id') id: string) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });
    t.is_active = false;
    await this.repo.save(t);
  }
}

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
  @IsIn(['dine-in', 'takeaway', 'delivery']) kind!: string;
  /** Số bắt đầu (vd 1) */
  @IsInt() from_num!: number;
  /** Số kết thúc (vd 10) → tạo 10 bàn từ 1-10 */
  @IsInt() to_num!: number;
}

/** Mapping kind → format code + name.
 * - dine-in   → ban-01, ban-02, ... | "Bàn 01", "Bàn 02"
 * - takeaway  → mang-ve-01, ... | "Mang về 01", ...
 * - delivery  → ship-01, ... | "Ship 01", ...
 */
const KIND_FORMAT: Record<string, { codePrefix: string; namePrefix: string }> = {
  'dine-in':  { codePrefix: 'ban',     namePrefix: 'Bàn' },
  'takeaway': { codePrefix: 'mang-ve', namePrefix: 'Mang về' },
  'delivery': { codePrefix: 'ship',    namePrefix: 'Ship' },
};

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

  /** POST /tables/bulk — tạo range bàn theo kind + range số.
   *
   * Code + name tự derive theo kind:
   * - dine-in:  ban-01, ban-02, ... | "Bàn 01", "Bàn 02"
   * - takeaway: mang-ve-01, ... | "Mang về 01"
   * - delivery: ship-01, ... | "Ship 01"
   *
   * Skip code đã tồn tại. Max 100 bàn/lần.
   */
  @Post('bulk')
  @HttpCode(201)
  @UseGuards(OwnerGuard)
  async bulkCreate(@Body() dto: BulkCreateTablesDto) {
    const fmt = KIND_FORMAT[dto.kind];
    if (!fmt) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'kind không hợp lệ' });
    }
    if (!Number.isInteger(dto.from_num) || !Number.isInteger(dto.to_num)) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'from_num và to_num phải là số nguyên' });
    }
    if (dto.from_num < 1) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'from_num phải ≥ 1' });
    }
    if (dto.to_num < dto.from_num) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Số kết thúc (${dto.to_num}) phải ≥ số bắt đầu (${dto.from_num})`,
      });
    }
    const count = dto.to_num - dto.from_num + 1;
    if (count > 100) {
      throw new BadRequestException({
        code: 'BAD_REQUEST',
        message: `Tối đa 100 bàn/lần (yêu cầu ${count})`,
      });
    }

    // Width padding: nếu to_num ≤ 99 → padding 2; nếu > 99 → padding theo độ dài to_num
    const width = Math.max(2, String(dto.to_num).length);
    const codes: string[] = [];
    const names: string[] = [];
    for (let n = dto.from_num; n <= dto.to_num; n++) {
      const numStr = String(n).padStart(width, '0');
      codes.push(`${fmt.codePrefix}-${numStr}`);
      names.push(`${fmt.namePrefix} ${numStr}`);
    }

    const existing = await this.repo.find({ where: { code: In(codes) }, select: ['code'] });
    const existingSet = new Set(existing.map((e) => e.code));
    const toCreate = codes
      .map((code, i) => ({ code, name: names[i] }))
      .filter(({ code }) => !existingSet.has(code));

    const entities = toCreate.map(({ code, name }, idx) =>
      this.repo.create({
        code,
        name,
        kind: dto.kind,
        x: 0,
        y: idx,
        is_active: true,
      }),
    );
    if (entities.length > 0) await this.repo.save(entities);
    return {
      data: {
        created: entities.length,
        skipped: existingSet.size,
        skipped_codes: [...existingSet],
        created_codes: toCreate.map((t) => t.code),
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

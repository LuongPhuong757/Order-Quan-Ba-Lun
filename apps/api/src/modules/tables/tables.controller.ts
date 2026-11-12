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
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { KIND_FORMAT, planBulkTables, tableNumberOf } from './table-kind.js';

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

@Controller('tables')
export class TablesController {
  constructor(
    @InjectRepository(RestaurantTable) private readonly repo: Repository<RestaurantTable>,
  ) {}

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
  @UseGuards(AdminGuard)
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

    // So trùng theo SỐ bàn trong cùng loại (xem `planBulkTables`) — trước đây so chuỗi mã nên
    // 1–10 rồi 1–120 tạo thêm "Bàn 001"… trùng "Bàn 01"…
    const existing = await this.repo.find({
      where: { kind: dto.kind },
      select: ['id', 'code', 'kind', 'is_active'],
    });
    const plan = planBulkTables(dto.kind, dto.from_num, dto.to_num, existing);

    // y = số bàn: list sắp theo y nên bàn xếp đúng 01, 02, … 11 bất kể tạo ở lần nào (cũ: y
    // đếm lại từ 0 mỗi lần → "Bàn 01" đứng cạnh "Bàn 11").
    const entities = plan.create.map(({ num, code, name }) =>
      this.repo.create({ code, name, kind: dto.kind, x: 0, y: num, is_active: true }),
    );
    if (entities.length > 0) await this.repo.save(entities);
    if (plan.reopen.length > 0) {
      await this.repo.update({ id: In(plan.reopen.map((t) => t.id)) }, { is_active: true });
    }
    return {
      data: {
        created: entities.length,
        reopened: plan.reopen.length,
        skipped: plan.skippedNums.length,
        skipped_nums: plan.skippedNums,
        created_codes: entities.map((t) => t.code),
      },
    };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(AdminGuard)
  async create(@Body() dto: CreateTableDto) {
    const exists = await this.repo.findOne({ where: { code: dto.code } });
    if (exists) throw new ConflictException({ code: 'CONFLICT', message: 'Mã bàn đã tồn tại' });
    // Cùng loại + cùng SỐ với một bàn đang dùng ("B5" vs "ban-05") = trùng: khách gõ số bàn ở QR
    // sẽ không biết bàn nào. Mã 'TABLE_NUMBER_TAKEN' nằm ngoài FRIENDLY_VN để giữ câu có tên bàn.
    const num = tableNumberOf(dto.code);
    if (num !== null) {
      const sameKind = await this.repo.find({ where: { kind: dto.kind, is_active: true }, select: ['code', 'name'] });
      const dup = sameKind.find((t) => tableNumberOf(t.code) === num);
      if (dup) {
        throw new ConflictException({ code: 'TABLE_NUMBER_TAKEN', message: `Đã có ${dup.name} (cùng số ${num})` });
      }
    }
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
  @UseGuards(AdminGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });
    Object.assign(t, dto);
    await this.repo.save(t);
    return { data: t };
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async softDelete(@Param('id') id: string) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });
    t.is_active = false;
    await this.repo.save(t);
  }

  // `PATCH /tables/:id/lock` + `POST /tables/unlock-all` (khoá bàn cho KiotViet) ĐÃ BỎ 2026-11-09:
  // quán không dùng KiotViet song song nữa. Cột `kiotviet_locked` vẫn nằm trong DB (xem entity).
}

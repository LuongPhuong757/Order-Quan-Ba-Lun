import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SuppliersService } from './suppliers.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';

class CreateSupplierDto {
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

class UpdateSupplierDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) name?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

/** Nhà cung cấp (2026-09-05).
 *
 * ĐỌC: admin + order — nhân viên order là người nhận hàng và nhập phiếu, không xem được danh
 * sách NCC thì không nhập hộ được (M3.D-05), mà nhập hộ là đường mặc định của cả tính năng.
 * GHI: chỉ admin — thêm/xoá NCC là việc của chủ quán, và mỗi NCC là một nhánh công nợ.
 */
@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private readonly svc: SuppliersService) {}

  @Get()
  @UseGuards(RequireRoles('admin', 'order'))
  async list(@Query() q: Record<string, string>) {
    const items = await this.svc.list({
      from: q.from || undefined,
      to: q.to || undefined,
      include_inactive: q.include_inactive === '1',
    });
    return { data: { items } };
  }

  @Get(':id')
  @UseGuards(RequireRoles('admin', 'order'))
  async get(@Param('id') id: string) {
    return { data: await this.svc.get(id) };
  }

  /** Bảng giá mặt hàng NCC này hay giao (mục 3.2) — cũng là nguồn điền sẵn cho màn nhập phiếu. */
  @Get(':id/items')
  @UseGuards(RequireRoles('admin', 'order'))
  async items(@Param('id') id: string) {
    return { data: { items: await this.svc.items(id) } };
  }

  @Post()
  @HttpCode(201)
  @UseGuards(AdminGuard)
  async create(@Body() dto: CreateSupplierDto) {
    return { data: await this.svc.create(dto) };
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return { data: await this.svc.update(id, dto) };
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async remove(@Param('id') id: string) {
    await this.svc.remove(id);
    return { data: { ok: true } };
  }
}

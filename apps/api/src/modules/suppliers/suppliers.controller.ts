import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { SuppliersService } from './suppliers.service.js';
import type { Request } from 'express';
import { SupplierAuthService } from './supplier-auth.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { ReportGuard } from '../auth/guards/report.guard.js';

class CreateSupplierDto {
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;

  /** Số dư đầu kỳ nhập luôn lúc tạo — đó là lúc chủ quán đang cầm sổ đối chiếu với NCC. Ba
   * trường này CHỈ được ghi khi người tạo là chủ quán (M3.D-40); admin thường gửi lên cũng bị
   * service bỏ qua. */
  @IsOptional() @IsInt() @Min(0) opening_balance?: number;
  @IsOptional() @IsString() @MaxLength(10) opening_balance_date?: string | null;
  @IsOptional() @IsString() @MaxLength(255) opening_balance_note?: string | null;
}

class IssueAccountDto {
  @IsString() @MinLength(9) @MaxLength(32) phone!: string;
}

class UpdateSupplierDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) name?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

/** Nhà cung cấp (2026-09-05).
 *
 * ĐỌC và GHI: chỉ admin (chủ quán chốt 2026-09-07, thay M3.D-31). Trước đây role `order` đọc
 * được danh sách để nhập phiếu hộ, nhưng bảng giá NCC là GIÁ MUA — nhìn được giá mua là nhìn
 * được lãi của quán, nên nhân viên không được vào. Nhập hộ giờ là việc của admin.
 */
@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(
    private readonly svc: SuppliersService,
    private readonly auth: SupplierAuthService,
  ) {}

  @Get()
  @UseGuards(ReportGuard)
  async list(@Query() q: Record<string, string>) {
    const items = await this.svc.list({
      from: q.from || undefined,
      to: q.to || undefined,
      include_inactive: q.include_inactive === '1',
    });
    return { data: { items } };
  }

  @Get(':id')
  @UseGuards(ReportGuard)
  async get(@Param('id') id: string) {
    return { data: await this.svc.get(id) };
  }

  /** Bảng giá mặt hàng NCC này hay giao (mục 3.2) — cũng là nguồn điền sẵn cho màn nhập phiếu. */
  @Get(':id/items')
  @UseGuards(ReportGuard)
  async items(@Param('id') id: string) {
    return { data: { items: await this.svc.items(id) } };
  }

  /** Nợ cũ (`opening_*`) ghi được bởi MỌI admin từ 2026-09-07 — không truyền `is_owner` nữa. */
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

  /** Trạng thái tài khoản đăng nhập của NCC. KHÔNG bao giờ trả PIN. */
  @Get(':id/account')
  @UseGuards(ReportGuard)
  async account(@Param('id') id: string) {
    return { data: await this.auth.accountStatus(id, Date.now()) };
  }

  /** Cấp hoặc ĐẶT LẠI PIN (M3.D-01, 03).
   *
   * Trả PIN dạng chữ, và đây là lần DUY NHẤT đọc được nó — chủ quán đọc cho NCC qua điện thoại
   * rồi thôi. Cố ý không có đường xem lại: xem lại được nghĩa là ai vào được màn admin cũng đăng
   * nhập được thay NCC.
   */
  @Put(':id/account')
  @UseGuards(AdminGuard)
  async issueAccount(@Param('id') id: string, @Body() dto: IssueAccountDto) {
    return { data: await this.auth.issueAccount(id, dto.phone, Date.now()) };
  }

  @Delete(':id/account')
  @UseGuards(AdminGuard)
  async disableAccount(@Param('id') id: string) {
    await this.auth.disable(id, Date.now());
    return { data: { ok: true } };
  }
}

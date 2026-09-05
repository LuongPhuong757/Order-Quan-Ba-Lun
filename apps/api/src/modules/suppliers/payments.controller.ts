import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { PaymentsService } from './payments.service.js';
import { DeliveriesService } from './deliveries.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { OwnerGuard } from '../auth/guards/owner.guard.js';

class CreatePaymentDto {
  /** 'YYYY-MM-DD'. Bỏ trống = hôm nay theo giờ VN. Sửa được để ghi bù lần trả hôm qua. */
  @IsOptional() @IsString() @MaxLength(10) paid_on?: string;
  @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

class OpeningBalanceDto {
  @IsInt() @Min(0) opening_balance!: number;
  @IsOptional() @IsString() @MaxLength(10) opening_balance_date?: string | null;
}

/** Công nợ nhà cung cấp (bước 3).
 *
 * ĐỌC + ghi thanh toán: admin. Không mở cho role `order` như màn nhập phiếu — nhập hàng là việc
 * hằng ngày của nhân viên, còn trả tiền cho NCC thì không.
 * ĐẶT SỐ DƯ ĐẦU KỲ: chỉ owner (M3.D-40).
 */
@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  /** Công nợ mọi NCC — một lượt cho cả danh sách, để màn hình không phải gọi 30 lần. */
  @Get('balances/all')
  @UseGuards(AdminGuard)
  async balances() {
    const map = await this.svc.balances();
    return { data: { items: [...map.values()] } };
  }

  @Get(':id/balance')
  @UseGuards(AdminGuard)
  async balance(@Param('id') id: string) {
    return { data: await this.svc.balanceOf(id) };
  }

  @Get(':id/payments')
  @UseGuards(AdminGuard)
  async list(@Param('id') id: string) {
    return { data: { items: await this.svc.list(id) } };
  }

  @Post(':id/payments')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  async create(@Param('id') id: string, @Body() dto: CreatePaymentDto, @Req() req: Request) {
    const payment = await this.svc.create(
      { supplier_id: id, ...dto },
      { id: req.user!.sub, full_name: req.user!.full_name, is_owner: req.user!.is_owner },
      DeliveriesService.today(),
    );
    return { data: payment };
  }

  @Delete('payments/:paymentId')
  @UseGuards(AdminGuard)
  async remove(@Param('paymentId') paymentId: string) {
    await this.svc.remove(paymentId);
    return { data: { ok: true } };
  }

  /** M3.D-40 — `OwnerGuard`, không phải `AdminGuard`. Service chặn lần nữa; xem docblock ở đó. */
  @Put(':id/opening-balance')
  @UseGuards(OwnerGuard)
  async setOpeningBalance(
    @Param('id') id: string,
    @Body() dto: OpeningBalanceDto,
    @Req() req: Request,
  ) {
    const s = await this.svc.setOpeningBalance(
      id,
      {
        opening_balance: dto.opening_balance,
        opening_balance_date: dto.opening_balance_date ?? null,
      },
      { id: req.user!.sub, full_name: req.user!.full_name, is_owner: req.user!.is_owner },
    );
    return { data: s };
  }
}

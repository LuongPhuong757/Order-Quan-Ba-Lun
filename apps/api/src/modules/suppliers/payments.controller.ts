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
import { ReportGuard } from '../auth/guards/report.guard.js';

class CreatePaymentDto {
  /** 'YYYY-MM-DD'. Bỏ trống = hôm nay theo giờ VN. Sửa được để ghi bù lần trả hôm qua. */
  @IsOptional() @IsString() @MaxLength(10) paid_on?: string;
  @IsInt() @Min(1) amount!: number;
  @IsOptional() @IsIn(['CASH', 'TRANSFER']) method?: 'CASH' | 'TRANSFER';
  /** `payment_qr_accounts.id` — bắt buộc khi chuyển khoản (2026-10-15), xem `paid-from.ts`. */
  @IsOptional() @IsString() @MaxLength(36) paid_from_account_id?: string | null;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

/** Sửa một lần trả — gửi ĐỦ mọi trường, không vá từng phần: màn sửa luôn có sẵn cả dòng, và
 *  một PUT trọn vẹn thì không có ca "đổi hình thức sang tiền mặt nhưng quên gửi tài khoản". */
class UpdatePaymentDto {
  @IsString() @MaxLength(36) supplier_id!: string;
  @IsString() @MaxLength(10) paid_on!: string;
  @IsInt() @Min(1) amount!: number;
  @IsIn(['CASH', 'TRANSFER']) method!: 'CASH' | 'TRANSFER';
  @IsOptional() @IsString() @MaxLength(36) paid_from_account_id?: string | null;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

class OpeningBalanceDto {
  @IsInt() @Min(0) opening_balance!: number;
  @IsOptional() @IsString() @MaxLength(10) opening_balance_date?: string | null;
  /** Số dư này GỒM NHỮNG GÌ — xem docblock cột `opening_balance_note`. */
  @IsOptional() @IsString() @MaxLength(255) opening_balance_note?: string | null;
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
  @UseGuards(ReportGuard)
  async balances() {
    const map = await this.svc.balances();
    return { data: { items: [...map.values()] } };
  }

  @Get(':id/balance')
  @UseGuards(ReportGuard)
  async balance(@Param('id') id: string) {
    return { data: await this.svc.balanceOf(id) };
  }

  @Get(':id/payments')
  @UseGuards(ReportGuard)
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

  /** Sửa một lần trả (2026-10-15). Cùng quyền với ghi/xoá; audit ghi `supplier.payment_updated`.
   *
   * Cùng hai đoạn với `PUT /suppliers/:id/opening-balance`, `:id/account`, `:id/invoice-template`
   * nhưng không đụng nhau: các đường kia kết thúc bằng một chữ CỐ ĐỊNH, còn ở đây đoạn đầu cố
   * định là `payments` và đoạn sau là uuid — không id nào trùng mấy chữ đó. */
  @Put('payments/:paymentId')
  @UseGuards(AdminGuard)
  async update(@Param('paymentId') paymentId: string, @Body() dto: UpdatePaymentDto) {
    return { data: await this.svc.update(paymentId, dto, DeliveriesService.today()) };
  }

  @Delete('payments/:paymentId')
  @UseGuards(AdminGuard)
  async remove(@Param('paymentId') paymentId: string) {
    await this.svc.remove(paymentId);
    return { data: { ok: true } };
  }

  /** M3.D-40, nới cho admin 2026-09-07 theo yêu cầu chủ quán (trước đó là `OwnerGuard`).
   *
   * Lớp bảo vệ còn lại là NHẬT KÝ: `audit.interceptor` ghi mọi lần gọi thành
   * `supplier.opening_balance_set` kèm người sửa, xem được ở /admin/audit. Con số này vẫn là con
   * số duy nhất hệ thống không tự kiểm chứng được, nên nếu bỏ luôn nhật ký thì không còn gì.
   */
  @Put(':id/opening-balance')
  @UseGuards(AdminGuard)
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
        opening_balance_note: dto.opening_balance_note,
      },
      { id: req.user!.sub, full_name: req.user!.full_name, is_owner: req.user!.is_owner },
    );
    return { data: s };
  }
}

// Cổng nhà cung cấp (bước 4) — endpoint NCC tự dùng, tách hẳn khỏi mọi đường nội bộ.
//
// Mọi thứ ở đây đều bị giới hạn trong đúng một NCC: `supplier_id` LUÔN lấy từ phiên
// (`req.supplier`), không bao giờ từ body hay query. Nhận từ client là mở đường cho một NCC xem
// và ghi dữ liệu của NCC khác chỉ bằng cách sửa một tham số.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { SupplierAuthService } from './supplier-auth.service.js';
import { SupplierSessionGuard } from './supplier-session.guard.js';
import { SuppliersService } from './suppliers.service.js';
import { DeliveriesService } from './deliveries.service.js';

class LoginDto {
  @IsString() @MaxLength(32) phone!: string;
  @IsString() @Length(4, 12) pin!: string;
}

class PortalLineDto {
  @IsOptional() @IsUUID() ingredient_id?: string | null;
  @IsOptional() @IsString() @MaxLength(128) ingredient_name?: string | null;
  @IsOptional() @IsString() @MaxLength(16) base_unit?: string | null;
  @IsString() @MaxLength(32) purchase_unit!: string;
  @IsNumber() @Min(0.001) qty_base_per_unit!: number;
  @IsNumber() @Min(0.001) qty_purchase!: number;
  @IsNumber() @Min(0) unit_price!: number;
}

class PortalDeliveryDto {
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PortalLineDto)
  lines!: PortalLineDto[];
}

@Controller('supplier-portal')
export class SupplierPortalController {
  constructor(
    private readonly auth: SupplierAuthService,
    private readonly suppliers: SuppliersService,
    private readonly deliveries: DeliveriesService,
  ) {}

  /** Đăng nhập bằng SĐT + PIN (M3.D-01).
   *
   * Siết nhịp mạnh hơn mức chung: PIN 6 số chỉ có một triệu tổ hợp, và khoá theo tài khoản
   * (M3.D-04) không chặn được kẻ dò LẦN LƯỢT nhiều số điện thoại từ cùng một máy.
   */
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  async login(@Body() dto: LoginDto) {
    const { token, supplier_name } = await this.auth.login(dto.phone, dto.pin, Date.now());
    return { data: { token, supplier_name } };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SupplierSessionGuard)
  async logout(@Req() req: Request) {
    await this.auth.logout(req.supplier!.session_token, Date.now());
    return { data: { ok: true } };
  }

  @Get('me')
  @UseGuards(SupplierSessionGuard)
  async me(@Req() req: Request) {
    return {
      data: { supplier_id: req.supplier!.supplier_id, supplier_name: req.supplier!.supplier_name },
    };
  }

  /** Mặt hàng NCC này hay giao + giá lần trước — để màn nhập điền sẵn (M3.D-18, 20). */
  @Get('items')
  @UseGuards(SupplierSessionGuard)
  async items(@Req() req: Request) {
    return { data: { items: await this.suppliers.items(req.supplier!.supplier_id) } };
  }

  /** Phiếu của CHÍNH NCC này, kể cả phiếu quán nhập hộ (M3.D-09).
   *
   * Cho họ thấy phiếu quán nhập hộ là cố ý: minh bạch hai chiều, và đó là thứ khiến họ dần muốn
   * tự nhập thay vì đọc điện thoại cho nhân viên ghi.
   */
  @Get('deliveries')
  @UseGuards(SupplierSessionGuard)
  async list(@Req() req: Request) {
    const items = await this.deliveries.list({ supplier_id: req.supplier!.supplier_id, limit: 50 });
    // NCC không cần biết ai bên quán nhập — chỉ cần biết phiếu đó do quán ghi giúp hay mình gửi.
    return {
      data: {
        items: items.map((d) => ({
          id: d.id,
          delivery_date: d.delivery_date,
          status: d.status,
          source: d.source,
          total_amount: d.total_amount,
          note: d.note,
        })),
      },
    };
  }

  @Post('deliveries')
  @HttpCode(201)
  @UseGuards(SupplierSessionGuard)
  async submit(@Body() dto: PortalDeliveryDto, @Req() req: Request) {
    const { delivery } = await this.deliveries.submitBySupplier(req.supplier!.supplier_id, dto);
    return {
      data: {
        id: delivery.id,
        status: delivery.status,
        total_amount: delivery.total_amount,
        delivery_date: delivery.delivery_date,
      },
    };
  }
}

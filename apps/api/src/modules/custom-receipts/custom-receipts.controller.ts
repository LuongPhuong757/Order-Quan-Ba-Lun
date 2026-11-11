import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';
import { CustomReceiptsService } from './custom-receipts.service.js';
import { shortCode } from '../printing/receipt-model.js';

class CustomItemDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsInt() @Min(1) @Max(99) qty!: number;
  /** Cho phép 0: món tặng kèm vẫn phải nằm trên tờ giấy đưa khách. */
  @IsInt() @Min(0) @Max(99_999_999) unit_price!: number;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

class CreateCustomReceiptDto {
  @IsOptional() @IsString() @MaxLength(64) header_note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CustomItemDto)
  items!: CustomItemDto[];

  @IsOptional() @IsInt() @Min(0) @Max(99_999_999) ship_fee?: number;
  @IsOptional() @IsInt() @Min(0) @Max(999_999_999) transfer_amount?: number;

  /** Người dùng đã thấy câu hỏi "giống hệt phiếu vừa in" và chọn "Tạo phiếu mới". */
  @IsOptional() @IsBoolean() allow_duplicate?: boolean;
}

/**
 * HOÁ ĐƠN TỰ DO (M6) — in ra một tờ giấy giống hệt hoá đơn thật mà KHÔNG tạo đơn nào.
 *
 * Ranh giới của cả module, và là lý do nó tồn tại tách khỏi `OrdersController`: ở đây không có
 * `orders`, `order_items`, kho, doanh thu, nhật ký bàn hay MISA/CukCuk. Chỉ có giấy. Đặt chung
 * với đơn hàng thì sớm muộn sẽ có người "tiện tay" cho nó cộng vào một con số nào đó.
 *
 * Tạo và in mở cho admin·order·kitchen (chủ quán chốt: ai cũng in được). Đọc lại lịch sử thì chỉ
 * admin — đó là chỗ đối chiếu, không phải chỗ làm việc.
 */
@Controller('custom-receipts')
@UseGuards(JwtAuthGuard)
export class CustomReceiptsController {
  constructor(private readonly svc: CustomReceiptsService) {}

  @Post()
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  async create(@Body() dto: CreateCustomReceiptDto, @Req() req: Request) {
    const { receipt, queued, duplicate } = await this.svc.create(
      {
        header_note: (dto.header_note ?? '').trim(),
        items: dto.items.map((it) => ({
          name: it.name.trim(),
          qty: it.qty,
          unit_price: it.unit_price,
          note: it.note?.trim() || null,
        })),
        ship_fee: dto.ship_fee ?? 0,
        transfer_amount: dto.transfer_amount ?? 0,
      },
      { id: req.user!.sub, full_name: req.user!.full_name ?? null },
      { allowDuplicate: dto.allow_duplicate === true },
    );
    if (duplicate) {
      // KHÔNG tạo mã mới: trả phiếu giống hệt vừa in (≤ 1 phút) để màn hình hỏi "In thêm bản sao?"
      // (chủ quán 2026-11-10 — hai mã cho cùng một tờ làm đối chiếu giấy với hệ thống bị nhầm).
      return {
        data: {
          duplicate_of: { id: receipt.id, code: shortCode(receipt.id), created_at: receipt.created_at },
        },
      };
    }
    // `queued: false` = công tắc in đang tắt hoặc chưa khai máy in. Trả 200 kèm cờ thay vì ném
    // lỗi, theo đúng lệ của `/orders/:id/print`: đó là chuyện cấu hình của quán, không phải lỗi
    // của thao tác vừa bấm — và bản ghi đã lưu rồi, bật lên là in lại được.
    return { data: { id: receipt.id, code: shortCode(receipt.id), total: receipt.total, queued } };
  }

  /**
   * Xem trước tờ phiếu (2026-11-10): nhận ĐÚNG payload của `POST /custom-receipts`, trả ảnh PNG
   * (data URL) của tấm bitmap máy in sẽ in. Không lưu, không in. Cùng quyền với In — ai được in
   * thì được xem trước tờ mình sắp in.
   */
  @Post('preview')
  @HttpCode(200)
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  async preview(@Body() dto: CreateCustomReceiptDto, @Req() req: Request) {
    const png = await this.svc.preview(
      {
        header_note: (dto.header_note ?? '').trim(),
        items: dto.items.map((it) => ({
          name: it.name.trim(),
          qty: it.qty,
          unit_price: it.unit_price,
          note: it.note?.trim() || null,
        })),
        ship_fee: dto.ship_fee ?? 0,
        transfer_amount: dto.transfer_amount ?? 0,
      },
      { id: req.user!.sub, full_name: req.user!.full_name ?? null },
    );
    return { data: { image: `data:image/png;base64,${png.toString('base64')}` } };
  }

  @Post(':id/print')
  @HttpCode(200)
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  async reprint(@Param('id') id: string, @Req() req: Request) {
    const { queued } = await this.svc.reprint(id, {
      id: req.user!.sub,
      full_name: req.user!.full_name ?? null,
    });
    return { data: { queued } };
  }

  @Get()
  @UseGuards(AdminGuard)
  async list(@Query('limit') limit?: string, @Query('q') q?: string, @Query('from') from?: string) {
    const items = await this.svc.list({
      limit: Number(limit) || 50,
      q: typeof q === 'string' ? q.slice(0, 64) : undefined,
      fromMs: Number(from) > 0 ? Number(from) : undefined,
    });
    return { data: { items: items.map((r) => ({ ...r, code: shortCode(r.id) })) } };
  }

  /** Ảnh tờ đã in (đúng mã, đúng giờ) — chi tiết ở màn "Phiếu đã in". Chỉ admin, như danh sách. */
  @Get(':id/image')
  @UseGuards(AdminGuard)
  async image(@Param('id') id: string) {
    const png = await this.svc.image(id);
    return { data: { image: `data:image/png;base64,${png.toString('base64')}` } };
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  async detail(@Param('id') id: string) {
    const receipt = await this.svc.findOne(id);
    return { data: { ...receipt, code: shortCode(receipt.id) } };
  }
}

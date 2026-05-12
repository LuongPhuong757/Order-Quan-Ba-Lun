import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrdersService } from './orders.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

class AddItemDto {
  @IsUUID() menu_item_id!: string;
  @IsInt() @Min(1) @Max(99) qty!: number;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
}

class BulkAddItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AddItemDto)
  items!: AddItemDto[];

  @IsOptional() @IsBoolean() send_to_kitchen?: boolean;
}

class ChangeStateDto {
  @IsIn(['PENDING', 'KITCHEN', 'COOKING', 'READY', 'SERVED', 'CANCELLED']) to!: string;
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

class TransferTableDto {
  @IsUUID() dest_table_id!: string;
}

class UpdateCustomerInfoDto {
  @IsString() @MinLength(1) @MaxLength(128) name!: string;
  @IsString() @MinLength(5) @MaxLength(255) address!: string;
  @IsString() @Matches(/^0\d{9}$/, { message: 'Số điện thoại phải có 10 số, bắt đầu bằng 0' }) phone!: string;
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly svc: OrdersService) {}

  /** GET /orders — all open orders (one per active table) */
  @Get()
  async listOpen() {
    const orders = await this.svc.listOpenOrders();
    return { data: { items: orders } };
  }

  /** GET /orders/by-table/:tableId — get or create the open order for a table */
  @Get('by-table/:tableId')
  async byTable(@Param('tableId') tableId: string, @Req() req: Request) {
    const order = await this.svc.getOrCreateOpenOrder(tableId, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    const full = await this.svc.getOrderWithItems(order.id);
    return { data: full };
  }

  /** POST /orders/:id/items — add menu item to order */
  @Post(':id/items')
  @HttpCode(201)
  async addItem(@Param('id') id: string, @Body() dto: AddItemDto, @Req() req: Request) {
    const item = await this.svc.addItem(id, dto.menu_item_id, dto.qty, dto.note ?? null, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    return { data: item };
  }

  /** POST /orders/:id/items-bulk — add nhiều items 1 lần, option auto-báo-bếp */
  @Post(':id/items-bulk')
  @HttpCode(201)
  async addItemsBulk(@Param('id') id: string, @Body() dto: BulkAddItemsDto, @Req() req: Request) {
    const result = await this.svc.addItemsBulk(
      id,
      dto.items.map((i) => ({ menu_item_id: i.menu_item_id, qty: i.qty, note: i.note })),
      dto.send_to_kitchen ?? false,
      { id: req.user!.sub, full_name: req.user!.full_name },
    );
    return { data: result };
  }

  /** POST /orders/:id/send-to-kitchen — bulk transition PENDING → KITCHEN */
  @Post(':id/send-to-kitchen')
  async sendToKitchen(@Param('id') id: string) {
    const result = await this.svc.sendPendingToKitchen(id);
    return { data: result };
  }

  /** PATCH /orders/items/:itemId/state — single item state transition */
  @Patch('items/:itemId/state')
  async changeItemState(@Param('itemId') itemId: string, @Body() dto: ChangeStateDto) {
    const item = await this.svc.changeItemState(itemId, dto.to, dto.reason);
    return { data: item };
  }

  /** POST /orders/:id/checkout — thanh toán + đóng order */
  @Post(':id/checkout')
  async checkout(@Param('id') id: string, @Req() req: Request) {
    const result = await this.svc.checkout(id, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    return { data: result };
  }

  /** GET /orders/history — lịch sử closed orders, filter table_id/date range */
  @Get('history')
  async history(@Query() q: Record<string, string>) {
    const result = await this.svc.listHistory({
      table_id: q.table_id || undefined,
      start_ms: q.start_ms ? Number(q.start_ms) : undefined,
      end_ms: q.end_ms ? Number(q.end_ms) : undefined,
      page: q.page ? Number(q.page) : 1,
      page_size: q.page_size ? Number(q.page_size) : 20,
    });
    return { data: result };
  }

  /** POST /orders/:id/transfer — chuyển bàn (REQ-B) */
  @Post(':id/transfer')
  async transfer(@Param('id') id: string, @Body() dto: TransferTableDto) {
    const dest = await this.svc.transferTable(id, dto.dest_table_id);
    return { data: dest };
  }

  /** PATCH /orders/:id/customer-info — cập nhật tên/địa chỉ/SĐT khách (chỉ dùng bàn ship) */
  @Patch(':id/customer-info')
  async updateCustomerInfo(@Param('id') id: string, @Body() dto: UpdateCustomerInfoDto) {
    const order = await this.svc.updateCustomerInfo(id, dto);
    return { data: order };
  }
}

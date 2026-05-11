import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
  Max,
  MaxLength,
  Min,
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
  async byTable(@Param('tableId') tableId: string) {
    const order = await this.svc.getOrCreateOpenOrder(tableId);
    const full = await this.svc.getOrderWithItems(order.id);
    return { data: full };
  }

  /** POST /orders/:id/items — add menu item to order */
  @Post(':id/items')
  @HttpCode(201)
  async addItem(@Param('id') id: string, @Body() dto: AddItemDto) {
    const item = await this.svc.addItem(id, dto.menu_item_id, dto.qty, dto.note ?? null);
    return { data: item };
  }

  /** POST /orders/:id/items-bulk — add nhiều items 1 lần, option auto-báo-bếp */
  @Post(':id/items-bulk')
  @HttpCode(201)
  async addItemsBulk(@Param('id') id: string, @Body() dto: BulkAddItemsDto) {
    const result = await this.svc.addItemsBulk(
      id,
      dto.items.map((i) => ({ menu_item_id: i.menu_item_id, qty: i.qty, note: i.note })),
      dto.send_to_kitchen ?? false,
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
  async checkout(@Param('id') id: string) {
    const result = await this.svc.checkout(id);
    return { data: result };
  }

  /** POST /orders/:id/transfer — chuyển bàn (REQ-B) */
  @Post(':id/transfer')
  async transfer(@Param('id') id: string, @Body() dto: TransferTableDto) {
    const dest = await this.svc.transferTable(id, dto.dest_table_id);
    return { data: dest };
  }
}

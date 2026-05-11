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
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OrdersService } from './orders.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

class AddItemDto {
  @IsUUID() menu_item_id!: string;
  @IsInt() @Min(1) @Max(99) qty!: number;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
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

  /** POST /orders/:id/transfer — chuyển bàn (REQ-B) */
  @Post(':id/transfer')
  async transfer(@Param('id') id: string, @Body() dto: TransferTableDto) {
    const dest = await this.svc.transferTable(id, dto.dest_table_id);
    return { data: dest };
  }
}

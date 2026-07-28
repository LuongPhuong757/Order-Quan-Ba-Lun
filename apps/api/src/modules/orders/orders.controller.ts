import {
  Body,
  Controller,
  ForbiddenException,
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
import { AdminGuard } from '../auth/guards/admin.guard.js';

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

class SetPriorityDto {
  @IsBoolean() priority!: boolean;
}

/** Ghi chú cho bếp. `text` giới hạn 128 ký tự vì lưu vào cột menu_item_name
 * varchar(128) — ghi chú dùng chung dòng item với món thật. */
class AddNoteDto {
  @IsString() @MinLength(1) @MaxLength(128) text!: string;
  @IsOptional() @IsBoolean() send_to_kitchen?: boolean;
}

/** Bớt số lượng món — nhiều phần 1 lần. `reason` optional cho món PENDING/SERVED
 * (BE tự ghi lý do mặc định) để không phải gõ lặp lại từng phần; BẮT BUỘC với món
 * đã vào bếp (KITCHEN/COOKING/READY). */
class RemoveItemUnitsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  item_ids!: string[];

  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

/** Huỷ cả bàn — lý do optional (BE tự ghi "Huỷ cả bàn — khách không dùng nữa"). */
class CancelOrderDto {
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

/** Cửa sổ thời gian nhân viên (không phải admin) được soi lịch sử/nhật ký bàn. */
const STAFF_HISTORY_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Trả về giới hạn tuổi đơn cho user hiện tại: `undefined` = không giới hạn (admin),
 * số ms = chỉ xem được trong khoảng đó (order/bếp).
 *
 * Đặt ở controller vì đây là quyết định QUYỀN, không phải nghiệp vụ đơn hàng —
 * service chỉ nhận số và thực thi. */
function staffHistoryWindowMs(req: Request): number | undefined {
  const role = req.user!.role ?? (req.user!.is_owner ? 'admin' : null);
  return role === 'admin' ? undefined : STAFF_HISTORY_WINDOW_MS;
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

  /** POST /orders/:id/notes — thêm ghi chú cho bếp ("lấy bát cho khách", "nước
   * mắm"...). Lưu như 1 dòng item giá 0 nên bếp thấy trên KDS và tick được như món
   * thường. Mọi nhân viên đều thêm được. */
  @Post(':id/notes')
  @HttpCode(201)
  async addNote(@Param('id') id: string, @Body() dto: AddNoteDto, @Req() req: Request) {
    const item = await this.svc.addServiceNote(id, dto.text, dto.send_to_kitchen ?? true, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
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
  async changeItemState(@Param('itemId') itemId: string, @Body() dto: ChangeStateDto, @Req() req: Request) {
    const item = await this.svc.changeItemState(itemId, dto.to, dto.reason, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    return { data: item };
  }

  /** POST /orders/items/remove — bớt N phần của 1 món khỏi đơn. Dùng cho MỌI
   * trạng thái trước khi thanh toán (kể cả món đã giao — khách không dùng hết).
   * Nhận nhiều item_ids → 1 dòng nhật ký duy nhất.
   * Mọi nhân viên đều được dùng; truy vết qua nhật ký bàn (ai + lý do). */
  @Post('items/remove')
  async removeItemUnits(@Body() dto: RemoveItemUnitsDto, @Req() req: Request) {
    const result = await this.svc.removeItemUnits(dto.item_ids, dto.reason, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    return { data: result };
  }

  /** PATCH /orders/items/:itemId/priority — Order + Admin set/unset cờ ưu tiên.
   * Bếp chỉ xem, không sửa được. Kitchen tự auto-clear khi state → COOKING. */
  @Patch('items/:itemId/priority')
  async setItemPriority(@Param('itemId') itemId: string, @Body() dto: SetPriorityDto, @Req() req: Request) {
    const role = req.user!.role ?? (req.user!.is_owner ? 'admin' : null);
    if (role !== 'order' && role !== 'admin') {
      throw new ForbiddenException({
        code: 'PRIORITY_ROLE_DENIED',
        message: 'Chỉ Order/Admin được đánh dấu ưu tiên.',
      });
    }
    const item = await this.svc.setItemPriority(itemId, dto.priority);
    return { data: item };
  }

  /** POST /orders/:id/cancel-all — HUỶ CẢ BÀN. Khách vào gọi đồ rồi không dùng
   * nữa: huỷ sạch mọi món (kể cả đã giao), bàn về trống, tiền bàn = 0.
   * Ghi 1 dòng nhật ký `order_cancelled`. Lý do optional. */
  @Post(':id/cancel-all')
  async cancelAll(@Param('id') id: string, @Body() dto: CancelOrderDto, @Req() req: Request) {
    const result = await this.svc.cancelWholeOrder(id, dto?.reason, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    return { data: result };
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

  /** GET /orders/history — lịch sử order, filter table/date/cashier/status.
   * Nhân viên order chỉ thấy đơn trong 48h gần nhất (xem staffHistoryWindowMs). */
  @Get('history')
  async history(@Query() q: Record<string, string>, @Req() req: Request) {
    const status =
      q.status === 'paid' || q.status === 'unpaid' || q.status === 'cancelled' ? q.status : 'all';
    const result = await this.svc.listHistory({
      table_id: q.table_id || undefined,
      start_ms: q.start_ms ? Number(q.start_ms) : undefined,
      end_ms: q.end_ms ? Number(q.end_ms) : undefined,
      cashier_user_id: q.cashier_user_id || undefined,
      status,
      page: q.page ? Number(q.page) : 1,
      page_size: q.page_size ? Number(q.page_size) : 20,
      max_age_ms: staffHistoryWindowMs(req),
    });
    return { data: result };
  }

  /** GET /orders/stats — số liệu tổng hợp cho biểu đồ (Admin). Cùng filter với
   * history (trừ status — biểu đồ luôn phản ánh đủ trong phạm vi ngày/bàn/thu ngân). */
  @Get('stats')
  @UseGuards(AdminGuard)
  async stats(@Query() q: Record<string, string>) {
    const data = await this.svc.stats({
      table_id: q.table_id || undefined,
      cashier_user_id: q.cashier_user_id || undefined,
      start_ms: q.start_ms ? Number(q.start_ms) : undefined,
      end_ms: q.end_ms ? Number(q.end_ms) : undefined,
    });
    return { data };
  }

  /** GET /orders/cashiers — DISTINCT cashier list cho filter dropdown */
  @Get('cashiers')
  async cashiers() {
    const items = await this.svc.listCashiers();
    return { data: { items } };
  }

  /** GET /orders/:id/activity — nhật ký hoạt động của 1 đơn.
   *
   * Admin: xem mọi đơn, không giới hạn thời gian.
   * Order: xem được nhật ký bàn nhưng CHỈ trong 48h gần nhất — đủ để tự đối chiếu
   *   ca làm của mình, không thành công cụ soi lại toàn bộ quá khứ.
   * Bếp: không được (không liên quan nghiệp vụ bàn/tiền). */
  @Get(':id/activity')
  async activity(@Param('id') id: string, @Req() req: Request) {
    const items = await this.svc.listOrderActivity(id, staffHistoryWindowMs(req));
    return { data: { items } };
  }

  /** POST /orders/:id/transfer — chuyển bàn (REQ-B) */
  @Post(':id/transfer')
  async transfer(@Param('id') id: string, @Body() dto: TransferTableDto, @Req() req: Request) {
    const dest = await this.svc.transferTable(id, dto.dest_table_id, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    });
    return { data: dest };
  }

  /** PATCH /orders/:id/customer-info — cập nhật tên/địa chỉ/SĐT khách (chỉ dùng bàn ship) */
  @Patch(':id/customer-info')
  async updateCustomerInfo(@Param('id') id: string, @Body() dto: UpdateCustomerInfoDto) {
    const order = await this.svc.updateCustomerInfo(id, dto);
    return { data: order };
  }
}

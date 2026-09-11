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
import { DineInStaffService } from './dine-in-staff.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { ReportGuard } from '../auth/guards/report.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';

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

/** Thanh toán. Body OPTIONAL toàn phần — client cũ post rỗng vẫn chạy như trước. */
class CheckoutDto {
  /** Thu ngân tick "đã gõ sang MISA" ngay trong hộp thoại thu tiền (2026-09-05). */
  @IsOptional() @IsBoolean() misa_copied?: boolean;
}

/** Đánh dấu / bỏ đánh dấu đã sao chép sang AMIS MISA. */
class SetMisaDto {
  @IsBoolean() copied!: boolean;
  /** Số chứng từ MISA, tuỳ chọn. Cùng độ dài với cột `orders.misa_ref`. */
  @IsOptional() @IsString() @MaxLength(64) misa_ref?: string | null;
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

  /** Số PHẦN cần bớt trong nhóm. Bỏ trống = huỷ trọn các dòng được chọn. Có giá trị
   * khi bớt lẻ (bớt 2 trong dòng qty=5) — BE tách dòng CANCELLED cho phần bị bớt. */
  @IsOptional() @IsInt() @Min(1) @Max(9999) units?: number;

  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

/** Huỷ cả bàn — lý do optional (BE tự ghi "Huỷ cả bàn — khách không dùng nữa"). */
class CancelOrderDto {
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

class TransferTableDto {
  @IsUUID() dest_table_id!: string;
}

/** Cả 3 field đều optional — bàn ship KHÔNG bắt buộc có thông tin khách mới nhận
 * order được. Chỉ ràng buộc định dạng SĐT khi có gửi lên (chuỗi rỗng = xoá). */
class UpdateCustomerInfoDto {
  @IsOptional() @IsString() @MaxLength(128) name?: string;
  @IsOptional() @IsString() @MaxLength(255) address?: string;
  @IsOptional() @IsString() @Matches(/^(0\d{9})?$/, { message: 'Số điện thoại phải có 10 số, bắt đầu bằng 0' }) phone?: string;
}

/** Cửa sổ thời gian nhân viên (không phải admin) được soi lịch sử/nhật ký bàn. */
const STAFF_HISTORY_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Trả về giới hạn tuổi đơn cho user hiện tại: `undefined` = không giới hạn (admin + report),
 * số ms = chỉ xem được trong khoảng đó (order + bếp).
 *
 * `report` xem đầy đủ như admin (chốt 2026-09-09): role đó sinh ra để ĐỌC báo cáo, mà báo cáo
 * doanh thu theo tháng đứng cạnh một nhật ký bàn cụt 48h thì không đối chiếu được số nào.
 * Cắt 48h là để nhân viên ca trực không soi lại quá khứ — `report` không phải ca trực.
 *
 * Đặt ở controller vì đây là quyết định QUYỀN, không phải nghiệp vụ đơn hàng —
 * service chỉ nhận số và thực thi. */
function staffHistoryWindowMs(req: Request): number | undefined {
  const role = req.user!.role ?? (req.user!.is_owner ? 'admin' : null);
  return role === 'admin' || role === 'report' ? undefined : STAFF_HISTORY_WINDOW_MS;
}

/** Body của `POST /orders/:id/dine-in-carts/:code/apply` — các dòng nhân viên chủ động bỏ ở
 * preview. Món đã hết hàng thì BE tự bỏ dù có nằm trong danh sách này hay không (không tin FE
 * về chuyện món còn bán được — preview trên tay nhân viên có thể đã cũ vài phút). */
class ApplyDineInCartDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  skip_menu_item_ids?: string[];
}

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(
    private readonly svc: OrdersService,
    private readonly dineIn: DineInStaffService,
  ) {}

  /** GET /orders — all open orders (one per active table) */
  @Get()
  async listOpen() {
    const orders = await this.svc.listOpenOrders();
    return { data: { items: orders } };
  }

  /** GET /orders/open-count — chỉ số bàn đang mở, cho badge nav dưới.
   *
   * PHẢI khai TRƯỚC các route có tham số động để Nest không hiểu 'open-count' là id.
   * Mọi role đăng nhập đều gọi được: cả 3 role đều có nút "Order" ở nav dưới. */
  @Get('open-count')
  async openCount() {
    return { data: { count: await this.svc.countOpenOrders() } };
  }

  /** GET /orders/kitchen-count — số món đang chờ bếp làm (cột "Đã order"), cho badge nav dưới.
   *
   * Cũng phải khai TRƯỚC route có tham số động, cùng lý do với 'open-count'.
   * Mọi role đăng nhập đều gọi được: nút "Bếp" có ở nav của admin lẫn role kitchen, và FE tự
   * quyết định bật badge cho role nào. */
  @Get('kitchen-count')
  async kitchenCount() {
    return { data: { count: await this.svc.countKitchenPendingItems() } };
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
    const result = await this.svc.removeItemUnits(
      dto.item_ids,
      dto.reason,
      { id: req.user!.sub, full_name: req.user!.full_name },
      dto.units,
    );
    return { data: result };
  }

  /** PATCH /orders/items/:itemId/priority — MỌI role đều set/unset được cờ ưu tiên.
   *
   * Bỏ chặn "chỉ Order/Admin" ngày 2026-09-08 (chủ quán: "bếp cũng có thể đi order mà"). Ở quán
   * này không có ranh giới người-bếp / người-order như giả định ban đầu: cùng một nhân viên lúc
   * đứng bếp, lúc chạy bàn ghi món, và tài khoản thì chỉ có một. Chặn theo role vì thế không bảo
   * vệ được gì mà chỉ làm nút biến mất đúng lúc người ta cần bấm.
   *
   * Chặn theo TRẠNG THÁI thì GIỮ (`PRIORITY_INVALID_STATE` ở service): ưu tiên chỉ có nghĩa với
   * món bếp chưa làm xong — đó là giới hạn về ý nghĩa, không phải về quyền.
   * Kitchen tự auto-clear cờ khi state → COOKING. */
  @Patch('items/:itemId/priority')
  async setItemPriority(@Param('itemId') itemId: string, @Body() dto: SetPriorityDto) {
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
  async checkout(@Param('id') id: string, @Body() body: CheckoutDto, @Req() req: Request) {
    const result = await this.svc.checkout(
      id,
      { id: req.user!.sub, full_name: req.user!.full_name },
      body?.misa_copied,
    );
    return { data: result };
  }

  /** PATCH /orders/:id/misa — đánh dấu bù "đã sao chép sang MISA" sau khi đã thu tiền.
   *
   * Cùng quyền với /orders/history: ai đối soát được cuối ca thì tick được. Đây là cờ ghi
   * chép nội bộ, không đụng tiền hay trạng thái đơn nên không cần AdminGuard. */
  @Patch(':id/misa')
  @UseGuards(RequireRoles('admin', 'order'))
  async setMisa(@Param('id') id: string, @Body() body: SetMisaDto, @Req() req: Request) {
    const order = await this.svc.setMisaCopied(id, body.copied, {
      id: req.user!.sub,
      full_name: req.user!.full_name,
    }, body.misa_ref);
    return {
      data: {
        id: order.id,
        misa_copied_at: order.misa_copied_at,
        misa_copied_by_full_name: order.misa_copied_by_full_name,
        misa_ref: order.misa_ref,
      },
    };
  }

  /** GET /orders/history — lịch sử order, filter table/date/cashier/status.
   *
   * Admin + report: đầy đủ, không giới hạn thời gian.
   * Order + bếp: 48h gần nhất (xem staffHistoryWindowMs), thấy giá món / tổng bill /
   *   thông tin thanh toán như nhau. Thứ DUY NHẤT chỉ admin có là số tổng doanh thu
   *   nhiều bàn cộng lại — nằm ở /orders/stats, đã có AdminGuard riêng. */
  @Get('history')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen', 'report'))
  async history(@Query() q: Record<string, string>, @Req() req: Request) {
    const status =
      q.status === 'paid' || q.status === 'unpaid' || q.status === 'cancelled' ? q.status : 'all';
    const misa = q.misa === 'pending' || q.misa === 'copied' ? q.misa : undefined;
    // Giá trị lạ → về mặc định 'opened', không báo lỗi: sort chỉ đổi THỨ TỰ hiển thị, không
    // đổi tập đơn trả về, nên gõ sai query string không đáng ném 400 vào mặt người dùng.
    const sort = q.sort === 'paid' ? 'paid' : 'opened';
    const result = await this.svc.listHistory({
      table_id: q.table_id || undefined,
      start_ms: q.start_ms ? Number(q.start_ms) : undefined,
      end_ms: q.end_ms ? Number(q.end_ms) : undefined,
      cashier_user_id: q.cashier_user_id || undefined,
      status,
      misa,
      sort,
      page: q.page ? Number(q.page) : 1,
      page_size: q.page_size ? Number(q.page_size) : 20,
      max_age_ms: staffHistoryWindowMs(req),
    });
    return { data: result };
  }

  /** GET /orders/stats — số liệu tổng hợp cho biểu đồ (admin + report).
   *
   * CÙNG bộ filter với history, kể cả `status`/`misa` (2026-09-05): tab ở màn Lịch sử đổi thì
   * cả bảng số bên dưới đổi theo, không chỉ danh sách đơn. */
  @Get('stats')
  @UseGuards(ReportGuard)
  async stats(@Query() q: Record<string, string>) {
    const data = await this.svc.stats({
      table_id: q.table_id || undefined,
      cashier_user_id: q.cashier_user_id || undefined,
      start_ms: q.start_ms ? Number(q.start_ms) : undefined,
      end_ms: q.end_ms ? Number(q.end_ms) : undefined,
      status:
        q.status === 'paid' || q.status === 'unpaid' || q.status === 'cancelled' ? q.status : 'all',
      misa: q.misa === 'pending' || q.misa === 'copied' ? q.misa : undefined,
    });
    return { data };
  }

  /** GET /orders/cashiers — DISTINCT cashier list cho filter dropdown.
   * Chỉ màn Lịch sử/Nhật ký dùng → cùng quyền với /orders/history. */
  @Get('cashiers')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen', 'report'))
  async cashiers() {
    const items = await this.svc.listCashiers();
    return { data: { items } };
  }

  /** GET /orders/:id/activity — nhật ký hoạt động của 1 đơn.
   *
   * Admin + report: xem mọi đơn, không giới hạn thời gian.
   * Order: xem được nhật ký bàn nhưng CHỈ trong 48h gần nhất — đủ để tự đối chiếu
   *   ca làm của mình, không thành công cụ soi lại toàn bộ quá khứ.
   * Bếp: giống nhân viên order — cũng 48h, cũng thấy đủ (kể cả câu log có số tiền). */
  @Get(':id/activity')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen', 'report'))
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

  /**
   * GET /orders/dine-in-carts/:code — PREVIEW giỏ khách tự chọn qua QR (M4.D-17).
   *
   * CỐ Ý không tiêu mã (xem docblock `DineInStaffService.preview`). Route này là ĐỌC nên nó
   * không nằm dưới `:id` nào: nhân viên gõ mã trước khi hệ thống biết sẽ đổ vào bàn nào, và
   * preview phải hiện ra được để họ đối chiếu TRƯỚC khi quyết định.
   */
  @Get('dine-in-carts/:code')
  @UseGuards(RequireRoles('admin', 'order'))
  async previewDineInCart(@Param('code') code: string) {
    const preview = await this.dineIn.preview(code, Date.now());
    return { data: preview };
  }

  /**
   * POST /orders/:id/dine-in-carts/:code/apply — đổ giỏ QR vào đơn của bàn (M4.D-18).
   *
   * Món vào ở state `PENDING`: đây là bước XÁC NHẬN, KHÔNG phải báo bếp. Báo bếp vẫn là
   * `POST /orders/:id/send-to-kitchen` như mọi món khác — đúng yêu cầu "xem xong rồi mới báo
   * bếp" của chủ quán, và không cần state máy mới nào.
   */
  @Post(':id/dine-in-carts/:code/apply')
  @HttpCode(201)
  @UseGuards(RequireRoles('admin', 'order'))
  async applyDineInCart(
    @Param('id') id: string,
    @Param('code') code: string,
    @Body() dto: ApplyDineInCartDto,
    @Req() req: Request,
  ) {
    const result = await this.dineIn.apply(
      id,
      code,
      dto.skip_menu_item_ids ?? [],
      { id: req.user!.sub, full_name: req.user!.full_name },
      Date.now(),
    );
    return { data: result };
  }
}

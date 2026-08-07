// 4 endpoint duyệt đơn online: GET hàng chờ · POST confirm · POST reject · GET stream (SSE).
//
// 4 điều bắt buộc phải nhớ khi sửa file này:
//
// 1. Prefix route KHÔNG có `/api` (OD-08). Spec §5.2 ghi đường dẫn có thêm tiền tố đó ở trước
//    `admin/online-orders` là SAI với repo này — `admin/users`, `admin/audit`,
//    `admin/settings` đều không có tiền tố đó, và
//    `apps/web/src/lib/api.ts` gọi thẳng `/admin/...`. `apiPrefixes` của SPA fallback trong
//    `main.ts` đã phủ `/admin`, `pathRequiresCheck()` của CSRF guard cũng đã phủ
//    `path.startsWith('/admin/')` — KHÔNG cần sửa 2 chỗ đó.
//
// 2. D-02 GHI ĐÈ M2.D-33. Spec + ROADMAP criterion 1 hiện ghi role `order` chỉ được XEM hàng
//    chờ; chủ dự án đã đổi ngày 2026-07-31 thành **cả 3 role admin/order/kitchen đều duyệt và
//    từ chối được**, vì không muốn chủ quán thành nút thắt giờ cao điểm. Lớp chặn role thứ 2
//    không còn nữa, nên lớp bảo vệ thay thế là **audit log ghi rõ ai duyệt đơn nào**
//    (`deriveActionKind` có 2 nhánh `online_order.confirmed`/`online_order.rejected`).
//    AI GỠ AUDIT Ở ĐÂY LÀ GỠ LUÔN KIỂM SOÁT BÙ TRỪ của D-02 — không phải dọn code thừa.
//
// 3. Response của `reject` TUYỆT ĐỐI không echo lại ghi chú nội bộ của admin (D-09) — chỉ trả
//    `has_internal_note` dạng boolean. Nội dung ghi chú nằm ở cột `internal_reject_note` và
//    trong audit log, không đi ra HTTP.
//
// 4. Handler `stream()` KHÔNG được chạm DB (C-INFRA-01, D-20) — xem comment tại chỗ.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Request } from 'express';
import { Observable, defer, finalize, fromEvent, map, merge, takeUntil, timer } from 'rxjs';
import { z } from 'zod';
import { apiOk, type ApiOk } from '@order/utils';
import {
  AdminOnlineOrderHoursQuery,
  AdminOnlineOrderList,
  AdminOnlineOrderStatusFilter,
  ConfirmOnlineOrderBody,
  EditOnlineOrderItemsBody,
  OnlineOrderStreamEvent,
  RejectOnlineOrderBody,
  SwitchFulfillmentBody,
  type EditOnlineOrderItemsResult,
  type RejectReasonCode,
  type SwitchFulfillmentResult,
} from '@order/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';
import {
  AdminOnlineOrdersService,
  type ConfirmResult,
  type FulfillmentResult,
  type ReviewBlacklistOutcome,
} from './admin-online-orders.service.js';
import { resolveOnlineWindow } from './online-window.js';

const UuidParam = z.string().uuid();

/** Role hiệu lực của phiên. `is_owner` không có `role` riêng nhưng là admin — bỏ nhánh này là
 * chủ quán bị cắt xuống cửa sổ 14h của nhân viên. Cùng cách suy như `staffHistoryWindowMs`. */
function roleOf(req: Request): 'admin' | 'order' | 'kitchen' | null {
  const role = req.user!.role ?? (req.user!.is_owner ? 'admin' : null);
  return role as 'admin' | 'order' | 'kitchen' | null;
}

/** 3 trạng thái, mặc định `WAITING` (OD-11 — chủ dự án chỉ đạo 2026-08-01).
 *
 * Bản đầu chỉ nhận `z.literal('WAITING')` với lý do "tránh trang tra cứu lịch sử mọc ra ở đây".
 * Chủ dự án quyết ngược lại: nhân viên cần xem lại đơn vừa duyệt/từ chối NGAY tại màn đang làm,
 * không phải đi sang trang khác. Đổi thành enum thay vì bỏ hẳn validate — `CANCELLED_BY_CUSTOMER`
 * vẫn KHÔNG mở, vì khách tự huỷ thì nhân viên không phải làm gì.
 *
 * Đơn đã xử lý vẫn đi qua ĐÚNG whitelist của `list()` — mở filter không mở thêm field nào;
 * `internal_reject_note` vẫn không ra HTTP (D-09). */
const StatusQuery = AdminOnlineOrderStatusFilter;

/** Nhịp heartbeat SSE. FE đo khoảng lặng giữa 2 heartbeat để biết kết nối đã chết (D-07 —
 * proxy/mạng đứt IM LẶNG, không có event `error` nào). Ngưỡng "coi là đứt" ở FE (~10s) phải
 * LỚN HƠN... nhỏ hơn nhịp này thì báo đứt oan, nên FE dùng ~2 lần nhịp. */
const HEARTBEAT_MS = 15_000;

/** Ngưỡng log cảnh báo rò listener (RESEARCH § Security). Quán có ~3-5 máy, vượt 20 subscriber
 * là dấu hiệu tab không được dọn hoặc `takeUntil(close$)` đã bị gỡ. */
const SUBSCRIBER_WARN_THRESHOLD = 20;

@Controller('admin/online-orders')
@UseGuards(JwtAuthGuard)
export class AdminOnlineOrdersController {
  private readonly logger = new Logger(AdminOnlineOrdersController.name);

  /** Số subscriber SSE đang mở — chỉ để quan sát/cảnh báo, KHÔNG dùng làm logic nghiệp vụ. */
  private subscribers = 0;

  constructor(
    private readonly svc: AdminOnlineOrdersService,
    private readonly emitter: EventEmitter2,
  ) {}

  @Get()
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  // Hàng chờ duyệt không được cache: khoảng cách giữa "đơn tới" và "admin thấy" phải bằng 0.
  @Header('Cache-Control', 'no-store')
  async list(
    @Req() req: Request,
    @Query('status') status?: string,
    @Query('hours') hours?: string,
  ): Promise<ApiOk<AdminOnlineOrderList>> {
    const parsed = StatusQuery.safeParse(status ?? 'WAITING');
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Trạng thái không xem được ở màn này.',
        field_errors: [
          { field: 'status', message: 'Chỉ nhận WAITING, CONFIRMED hoặc REJECTED' },
        ],
      });
    }

    let requestedHours: number | undefined;
    if (hours !== undefined && hours !== '') {
      const h = AdminOnlineOrderHoursQuery.safeParse(hours);
      if (!h.success) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Khoảng thời gian không hợp lệ.',
          field_errors: [{ field: 'hours', message: 'Phải là số giờ từ 1 đến 8784' }],
        });
      }
      requestedHours = h.data;
    }

    // Cửa sổ chốt ở đây, KHÔNG ở service: đây là quyết định quyền (order/bếp 14h — chỉ đạo
    // 2026-08-06), cùng khuôn với `staffHistoryWindowMs` của nhật ký bàn.
    const window = resolveOnlineWindow(roleOf(req), requestedHours);
    return apiOk(await this.svc.list(parsed.data, window));
  }

  @Post(':id/confirm')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  @HttpCode(200)
  async confirm(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ApiOk<ConfirmResult>> {
    const requestId = this.parseId(id);
    const parsed = ConfirmOnlineOrderBody.safeParse(body ?? {});
    if (!parsed.success) {
      throw this.validationFailed(parsed.error, 'Dữ liệu xác nhận đơn không hợp lệ.');
    }
    // Danh tính người duyệt lấy TỪ PHIÊN, không bao giờ từ body — đây là nền của kiểm soát bù
    // trừ D-02 (xem điểm 2 đầu file).
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    return apiOk(await this.svc.confirm(requestId, actor, parsed.data));
  }

  @Post(':id/reject')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ApiOk<{ ok: true; reason_code: RejectReasonCode; has_internal_note: boolean } & ReviewBlacklistOutcome>> {
    const requestId = this.parseId(id);
    const parsed = RejectOnlineOrderBody.safeParse(body);
    if (!parsed.success) {
      throw this.validationFailed(parsed.error, 'Dữ liệu từ chối đơn không hợp lệ.');
    }
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    const outcome = await this.svc.reject(requestId, actor, parsed.data);
    // `after_json` của AuditInterceptor lấy từ response body này, nên nó phải đủ để truy vết
    // (mã lý do + CÓ hay KHÔNG ghi chú nội bộ) mà vẫn không chứa nội dung ghi chú (D-09).
    return apiOk({
      ok: true as const,
      reason_code: parsed.data.reason_code,
      has_internal_note: Boolean(parsed.data.internal_note?.trim()),
      ...outcome,
    });
  }

  /** Huỷ đơn ĐÃ XÁC NHẬN — khách có vấn đề giữa chừng (2026-08-04). Body dùng CHUNG khuôn
   * reject (5 lý do soạn sẵn + ghi chú nội bộ, D-08/D-09). Cả 3 role (D-02) — kiểm soát bù
   * trừ là audit log `online_order.cancelled_by_staff`. Đơn đã thu tiền nhận 409. */
  @Post(':id/cancel')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  @HttpCode(200)
  async cancelConfirmed(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ApiOk<{ ok: true; reason_code: RejectReasonCode; has_internal_note: boolean } & ReviewBlacklistOutcome>> {
    const requestId = this.parseId(id);
    const parsed = RejectOnlineOrderBody.safeParse(body);
    if (!parsed.success) {
      throw this.validationFailed(parsed.error, 'Dữ liệu huỷ đơn không hợp lệ.');
    }
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    const outcome = await this.svc.cancelConfirmed(requestId, actor, parsed.data);
    // Cùng khuôn response reject: đủ để audit truy vết, không chứa nội dung ghi chú (D-09).
    return apiOk({
      ok: true as const,
      reason_code: parsed.data.reason_code,
      has_internal_note: Boolean(parsed.data.internal_note?.trim()),
      ...outcome,
    });
  }

  /** Sửa món của đơn ĐANG CHỜ DUYỆT — đổi số lượng / bỏ món để chốt lại với khách trước khi
   * Xác nhận (Task.md, chốt 2026-08-04). Body là danh sách THAY THẾ (món vắng mặt = bỏ).
   *
   * Cả 3 role sửa được, cùng lý lẽ D-02 — kiểm soát bù trừ là audit log
   * `online_order.items_edited` (xem `deriveActionKind`). Đơn đã xử lý nhận 409. */
  @Patch(':id/items')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  async editItems(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApiOk<EditOnlineOrderItemsResult>> {
    const requestId = this.parseId(id);
    const parsed = EditOnlineOrderItemsBody.safeParse(body);
    if (!parsed.success) {
      throw this.validationFailed(parsed.error, 'Dữ liệu sửa đơn không hợp lệ.');
    }
    return apiOk(await this.svc.editItems(requestId, parsed.data));
  }

  /** Đổi hình thức nhận hàng: Giao tận nơi ⇄ Đến lấy tại quán (chốt 2026-08-06).
   *
   * Cả 3 role bấm được — chủ dự án chốt nguyên văn "order, bếp và admin". Cùng lý lẽ D-02:
   * không có lớp chặn role thứ 2, kiểm soát bù trừ là audit log
   * `online_order.fulfillment_switched` (đã có nhánh riêng ở `deriveActionKind`) + nhật ký bàn.
   *
   * Đổi được cả TRƯỚC và SAU khi duyệt, chốt chặn duy nhất là đơn chưa rời quán — mọi guard
   * nằm ở `decideSwitchFulfillment`, không ở đây. */
  @Post(':id/fulfillment')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  @HttpCode(200)
  async switchFulfillment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<ApiOk<SwitchFulfillmentResult>> {
    const requestId = this.parseId(id);
    const parsed = SwitchFulfillmentBody.safeParse(body);
    if (!parsed.success) {
      throw this.validationFailed(parsed.error, 'Dữ liệu đổi hình thức nhận hàng không hợp lệ.');
    }
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    return apiOk(await this.svc.switchFulfillment(requestId, actor, parsed.data));
  }

  /** Shipper đã rời quán. Chỉ DELIVERY; đơn PICKUP gọi vào đây nhận 400.
   *
   * Cả 3 role bấm được, cùng lý lẽ D-02 với confirm/reject — giờ cao điểm ai đang ở máy thì bấm.
   * Kiểm soát bù trừ vẫn là audit log (`online_order.shipped`, xem `deriveActionKind`). */
  @Post(':id/ship')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  @HttpCode(200)
  async ship(@Param('id') id: string, @Req() req: Request): Promise<ApiOk<FulfillmentResult>> {
    const requestId = this.parseId(id);
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    return apiOk(await this.svc.markShipped(requestId, actor));
  }

  /** Khách đã cầm hàng: DELIVERY = đã nhận, PICKUP = đã tới lấy.
   *
   * ⚠ KHÔNG đóng đơn và KHÔNG đánh dấu đã thu tiền — chủ dự án chốt 2026-08-04 là bàn giữ tới
   * khi thu tiền, nên `closed_at`/`is_paid` vẫn thuộc luồng checkout. Với COD 2 mốc lệch nhau. */
  @Post(':id/receive')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  @HttpCode(200)
  async receive(@Param('id') id: string, @Req() req: Request): Promise<ApiOk<FulfillmentResult>> {
    const requestId = this.parseId(id);
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    return apiOk(await this.svc.markReceived(requestId, actor));
  }

  /** Cặp route cho DRAWER màn bàn (2026-08-04: bàn online chỉ còn 2 hành động — mốc giao và
   * thanh toán). Drawer cầm `order_id`, không cầm request_id → resolve rồi dùng CHUNG
   * markShipped/markReceived với cặp route theo :id, mọi ràng buộc (400 PICKUP, 409 chưa
   * ship, idempotent) giữ nguyên. */
  @Post('by-order/:orderId/ship')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  @HttpCode(200)
  async shipByOrder(
    @Param('orderId') orderId: string,
    @Req() req: Request,
  ): Promise<ApiOk<FulfillmentResult>> {
    const requestId = await this.svc.requestIdByOrderId(this.parseId(orderId));
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    return apiOk(await this.svc.markShipped(requestId, actor));
  }

  @Post('by-order/:orderId/receive')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  @HttpCode(200)
  async receiveByOrder(
    @Param('orderId') orderId: string,
    @Req() req: Request,
  ): Promise<ApiOk<FulfillmentResult>> {
    const requestId = await this.svc.requestIdByOrderId(this.parseId(orderId));
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    return apiOk(await this.svc.markReceived(requestId, actor));
  }

  /**
   * Kênh đẩy "có gì đó đổi ở hàng chờ" tới mọi tab admin đang mở.
   *
   * CẤM TUYỆT ĐỐI trong handler này (C-INFRA-01, D-20):
   * - KHÔNG query DB — không `this.svc.list()`, không repository, không `ds.`. Pool MySQL 50
   *   connection đang được size cho poller 2s của POS; "1 subscriber = 1 connection" đúng là
   *   thứ ràng buộc này cấm. Event chỉ là TÍN HIỆU; FE nhận được thì tự gọi lại
   *   `GET /admin/online-orders?status=WAITING` (D-06 — DB là nguồn sự thật duy nhất, đúng cả
   *   khi API restart hay dữ liệu bị sửa tay).
   * - KHÔNG replay theo id của event cuối, KHÔNG replay buffer — D-06 đã chốt ngược lại. Nối
   *   lại thì FE gọi lại GET list, không phát lại event cũ.
   *
   * Controller chỉ NGHE, không tự emit: `online_order.reviewed` do service phát sau commit
   * (plan 09-06), `online_order.new` do luồng submit phát (plan 09-09).
   */
  @Sse('stream')
  @UseGuards(RequireRoles('admin', 'order', 'kitchen'))
  stream(@Req() req: Request): Observable<MessageEvent> {
    // Client ngắt (đóng tab, mạng rớt) → hoàn tất Observable → rxjs tự gỡ listener khỏi
    // EventEmitter2. Gỡ luồng huỷ này là rò listener theo từng lần mở tab.
    const close$ = fromEvent(req, 'close');

    const events$ = merge(
      fromEvent(this.emitter, 'online_order.new').pipe(map((p) => toStreamEvent('new', p))),
      fromEvent(this.emitter, 'online_order.reviewed').pipe(map((p) => toStreamEvent('reviewed', p))),
    );

    // `timer(0, …)`: heartbeat đầu tiên đi NGAY khi mở stream để FE biết kết nối đã lên, thay vì
    // phải chờ trọn 15s mới dám tắt trạng thái "đang kết nối".
    const heartbeat$ = timer(0, HEARTBEAT_MS).pipe(map(() => toStreamEvent('heartbeat', null)));

    return defer(() => {
      this.subscribers += 1;
      if (this.subscribers > SUBSCRIBER_WARN_THRESHOLD) {
        this.logger.warn(
          `SSE online-orders: ${this.subscribers} subscriber đang mở (ngưỡng ${SUBSCRIBER_WARN_THRESHOLD}) — nghi rò listener`,
        );
      }
      return merge(events$, heartbeat$).pipe(takeUntil(close$));
    }).pipe(
      finalize(() => {
        this.subscribers = Math.max(0, this.subscribers - 1);
        this.logger.log(`SSE online-orders: subscriber đóng, còn ${this.subscribers}`);
      }),
    );
  }

  private parseId(id: string): string {
    const parsed = UuidParam.safeParse(id);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Mã đơn không hợp lệ.',
        field_errors: [{ field: 'id', message: 'Phải là UUID' }],
      });
    }
    return parsed.data;
  }

  private validationFailed(error: z.ZodError, message: string): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      message,
      field_errors: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}

/** Dựng payload SSE tối giản. `.strict().parse()` là chốt chặn để không lỡ tay đẩy cả object đơn
 * (PII khách) ra stream khi ai đó sửa publisher gửi kèm thêm field — T-09-35. */
function toStreamEvent(type: OnlineOrderStreamEvent['type'], payload: unknown): MessageEvent {
  const p = (payload ?? {}) as { request_id?: string | null; at_ms?: number };
  const data: OnlineOrderStreamEvent = OnlineOrderStreamEvent.strict().parse({
    type,
    request_id: p.request_id ?? null,
    at_ms: p.at_ms ?? Date.now(),
  });
  return { data };
}

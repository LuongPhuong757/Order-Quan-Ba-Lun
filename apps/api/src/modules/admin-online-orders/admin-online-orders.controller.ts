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
  AdminOnlineOrderList,
  ConfirmOnlineOrderBody,
  OnlineOrderStreamEvent,
  RejectOnlineOrderBody,
  type RejectReasonCode,
} from '@order/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RequireRoles } from '../auth/guards/roles.guard.js';
import { AdminOnlineOrdersService, type ConfirmResult } from './admin-online-orders.service.js';

const UuidParam = z.string().uuid();

/** Chỉ `WAITING` — hàng chờ duyệt là màn hình duy nhất dùng endpoint này (09-UI-SPEC Mặt A).
 * Không mở sẵn `CONFIRMED`/`REJECTED` để tránh trang tra cứu lịch sử đơn mọc ra ở đây thay vì
 * ở trang lịch sử đã có. */
const StatusQuery = z.literal('WAITING');

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
  async list(@Query('status') status?: string): Promise<ApiOk<AdminOnlineOrderList>> {
    const parsed = StatusQuery.safeParse(status ?? 'WAITING');
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Chỉ xem được hàng chờ duyệt (status=WAITING).',
        field_errors: [{ field: 'status', message: 'Chỉ nhận giá trị WAITING' }],
      });
    }
    return apiOk(await this.svc.list(parsed.data));
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
  ): Promise<ApiOk<{ ok: true; reason_code: RejectReasonCode; has_internal_note: boolean }>> {
    const requestId = this.parseId(id);
    const parsed = RejectOnlineOrderBody.safeParse(body);
    if (!parsed.success) {
      throw this.validationFailed(parsed.error, 'Dữ liệu từ chối đơn không hợp lệ.');
    }
    const actor = { id: req.user!.sub, full_name: req.user!.full_name };
    await this.svc.reject(requestId, actor, parsed.data);
    // `after_json` của AuditInterceptor lấy từ response body này, nên nó phải đủ để truy vết
    // (mã lý do + CÓ hay KHÔNG ghi chú nội bộ) mà vẫn không chứa nội dung ghi chú (D-09).
    return apiOk({
      ok: true as const,
      reason_code: parsed.data.reason_code,
      has_internal_note: Boolean(parsed.data.internal_note?.trim()),
    });
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

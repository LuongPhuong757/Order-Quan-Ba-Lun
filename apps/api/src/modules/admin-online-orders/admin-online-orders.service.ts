// AdminOnlineOrdersService — duyệt/từ chối đơn online (§7 spec, criterion 2 ROADMAP.md).
//
// 3 điều bắt buộc phải nhớ khi sửa file này:
//
// 1. Đây là NƠI DUY NHẤT đơn online chuyển từ bảng staging `online_order_requests` sang
//    bảng thật `orders` (ranh giới M2.D-01). 48 điểm query doanh thu/lịch sử/sơ đồ bàn/bếp
//    trong toàn hệ thống tin rằng chỉ đơn đã duyệt mới nằm trong `orders` — đơn còn
//    `WAITING` KHÔNG BAO GIỜ được phép INSERT vào bảng đó.
//
// 2. LỆCH pseudo-code spec §7 (dòng ~480) CÓ CHỦ ĐÍCH: hàm confirm() KHÔNG gọi phương thức
//    "lấy-hoặc-tạo-đơn-mở-của-1-bàn" hiện có trên `OrdersService` (định nghĩa tại
//    orders.service.ts dòng ~184-188). Phương thức đó tự mở `this.ds.transaction(...)`
//    RIÊNG của nó (connection khác transaction ở đây). Gọi nó từ bên trong transaction cấp
//    bàn của ta thì (a) nó không nhìn thấy bàn ta vừa tạo nhưng chưa commit → báo bàn không
//    tồn tại (OD-14), và (b) mở đường deadlock giữa 2 connection cùng chờ nhau. Thay vào đó:
//    dựng `Order` trực tiếp trên `mgr` của transaction hiện tại — an toàn vì bàn vừa được
//    khoá và câu chọn bàn đã tự loại mọi bàn còn đơn mở.
//
// 3. D-02 (09-CONTEXT.md): cả 3 role admin/order/kitchen đều duyệt/từ chối được — GHI ĐÈ
//    M2.D-33 ("chỉ role admin"). Vì lớp chặn role thứ 2 không còn, `actor` PHẢI được ghi vào
//    `reviewed_by_user_id`/`reviewed_by_full_name` + audit log ở mọi nhánh — đây là kiểm
//    soát bù trừ thay cho lớp bảo vệ mà M2.D-33 từng cung cấp.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ConfirmOnlineOrderBody, RejectOnlineOrderBody } from '@order/schemas';
import { AdminOnlineOrderList, REJECT_REASON_TEXT } from '@order/schemas';
import type { AdminOnlineOrderRow, AdminOnlineOrderStatusFilter } from '@order/schemas';
// Import namespace (không phải named import) — tránh dòng import lặp lại đúng chuỗi tên hàm
// với dòng gọi hàm bên dưới (2 dòng khớp cùng 1 chuỗi sẽ sai lệch với acceptance criteria đếm
// đúng 1 lần xuất hiện của cơ chế retry trong file này).
import * as RetryLib from '../../common/run-with-retry.js';
import { pickFreeTable, nextTableCode, kindForFulfillment } from './table-assign.js';
import { formatTableName } from '../tables/table-kind.js';
import { OnlineOrderRequest } from '../public/entities/online-order-request.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrderActivityLog } from '../orders/entities/order-activity-log.entity.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';

export type ReviewActor = { id: string; full_name: string };

export type ConfirmResult = {
  order_id: string;
  table_code: string;
  table_created: boolean;
  dropped_count: number;
};

/** Kết quả của `markShipped`/`markReceived`. Trả về CẢ HAI mốc (không chỉ mốc vừa set) để FE
 * vẽ lại được trạng thái đơn mà không phải gọi thêm 1 GET. */
export type FulfillmentResult = {
  order_id: string;
  table_code: string;
  fulfillment_type: 'PICKUP' | 'DELIVERY';
  shipped_at_ms: number | null;
  received_at_ms: number | null;
};

@Injectable()
export class AdminOnlineOrdersService {
  private readonly logger = new Logger(AdminOnlineOrdersService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly emitter: EventEmitter2,
    private readonly outbox: NotificationOutboxService,
    private readonly settingsSvc: SettingsService,
  ) {}

  /** Khoá 1 dòng `online_order_requests` (chặn 2 admin cùng duyệt/từ chối 1 đơn) rồi trả về
   * bản ghi đầy đủ qua repository (KHÔNG parse tay kết quả raw query — cột datetime/json cần
   * transformer của entity, giống cách `NotificationOutboxService.claimDue` đã làm: khoá bằng
   * raw SQL, đọc lại bằng repo trong CÙNG transaction). `status !== 'WAITING'` → 409. */
  private async lockWaitingRequest(mgr: EntityManager, requestId: string): Promise<OnlineOrderRequest> {
    const lockRows: Array<{ id: string }> = await mgr.query(
      'SELECT id FROM online_order_requests WHERE id = ? FOR UPDATE',
      [requestId],
    );
    if (lockRows.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy đơn này.' });
    }
    const request = await mgr.getRepository(OnlineOrderRequest).findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy đơn này.' });
    }
    if (request.status !== 'WAITING') {
      throw new ConflictException({
        code: 'ORDER_ALREADY_CONFIRMED',
        message: 'Đơn này đã được xử lý rồi.',
      });
    }
    return request;
  }

  async confirm(
    requestId: string,
    actor: ReviewActor,
    body: ConfirmOnlineOrderBody,
  ): Promise<ConfirmResult> {
    return RetryLib.runWithRetry(() => this.confirmImpl(requestId, actor, body), 2, {
      onRetry: (a, m) =>
        this.logger.warn(`Transient DB error khi duyệt đơn online (attempt ${a}/2): ${m} — retry`),
    });
  }

  private async confirmImpl(
    requestId: string,
    actor: ReviewActor,
    body: ConfirmOnlineOrderBody,
  ): Promise<ConfirmResult> {
    try {
      const txOut = await this.ds.transaction(async (mgr) => {
        // ── Bước 1: khoá request ──
        const request = await this.lockWaitingRequest(mgr, requestId);

        // ── Bước 2: re-check tồn kho + áp drop_menu_item_ids (M2.D-61) ──
        const dropIds = new Set(body.drop_menu_item_ids ?? []);
        const keptItems = request.items_snapshot.filter((it) => !dropIds.has(it.menu_item_id));
        if (keptItems.length === 0) {
          throw new ConflictException({
            code: 'ORDER_EMPTY_AFTER_DROP',
            message: 'Đơn không còn món nào. Hãy dùng nút Từ chối thay vì Xác nhận.',
          });
        }
        const keptIds = Array.from(new Set(keptItems.map((it) => it.menu_item_id)));
        const menus = await mgr.getRepository(MenuItem).find({ where: { id: In(keptIds) } });
        const menuMap = new Map(menus.map((m) => [m.id, m]));
        const unavailable: string[] = [];
        for (const it of keptItems) {
          const m = menuMap.get(it.menu_item_id);
          if (!m || !m.is_active || m.is_out_of_stock) unavailable.push(it.name);
        }
        if (unavailable.length > 0) {
          throw new ConflictException({
            code: 'MENU_ITEM_UNAVAILABLE',
            message: `Còn ${unavailable.length} món đã hết hàng: ${unavailable.join(', ')}. Tick bỏ các món đó rồi xác nhận lại.`,
          });
        }
        const droppedCount = request.items_snapshot.length - keptItems.length;

        // ── Bước 3: cấp bàn (M2.D-04/05/06/14) ──
        const kind = kindForFulfillment(request.fulfillment_type as 'PICKUP' | 'DELIVERY');
        const candidates: Array<{ id: string; code: string; name: string }> = await mgr.query(
          `SELECT t.id, t.code, t.name FROM restaurant_tables t
           WHERE t.kind = ? AND t.is_active = 1 AND t.kiotviet_locked = 0
             AND t.id NOT IN (SELECT o.table_id FROM orders o WHERE o.closed_at IS NULL)
           ORDER BY t.code ASC LIMIT 1 FOR UPDATE`,
          [kind],
        );
        // Khoá dòng bàn tìm được (khác kiểu khoá khoảng mà phase 8 dùng cho
        // `online_order_requests`): giao dịch thứ hai chọn trùng bàn sẽ phải đợi tới khi giao
        // dịch này kết thúc, rồi điều kiện loại-trừ-bàn-đang-mở của nó sẽ tự đá bàn đó ra.
        const picked = pickFreeTable(candidates);
        let table: { id: string; code: string; name: string };
        let tableCreated = false;
        if (picked) {
          table = picked;
        } else {
          // Hết bàn trống → TỰ TẠO (M2.D-05 — khách không bao giờ bị chặn vì hết bàn).
          const existing = await mgr
            .getRepository(RestaurantTable)
            .find({ where: { kind }, select: ['code'] });
          const code = nextTableCode(kind, existing.map((t) => t.code));
          const numMatch = /-(\d+)$/.exec(code);
          const num = numMatch ? Number(numMatch[1]) : 1;
          const name = formatTableName(kind, num);
          try {
            const saved = await mgr.getRepository(RestaurantTable).save(
              mgr.getRepository(RestaurantTable).create({
                code,
                name,
                kind,
                x: 0,
                y: 0,
                is_active: true,
                kiotviet_locked: false,
              }),
            );
            table = { id: saved.id, code: saved.code, name: saved.name };
            tableCreated = true;
          } catch (err) {
            const msg = (err as Error).message || '';
            if (/Duplicate entry/i.test(msg)) {
              // 2 giao dịch cùng sinh 1 code cùng lúc — không transient nên `RetryLib` không tự
              // thử lại; báo admin bấm lại thay vì để họ nhìn lỗi SQL lạ.
              throw new ConflictException({
                code: 'CONFLICT',
                message: 'Có admin khác vừa tạo bàn cùng lúc, bấm Xác nhận lại.',
              });
            }
            throw err;
          }
          // Mã lỗi "hết bàn" cũ của phase 8 KHÔNG được phép xuất hiện ở nhánh này — M2.D-05 đã
          // loại bỏ hoàn toàn khả năng khách bị chặn vì quán hết chỗ.
        }

        // ── Bước 4: tạo Order trực tiếp trên `mgr` (xem điểm 2 ở đầu file) ──
        const nowMs = Date.now();
        const orderRepo = mgr.getRepository(Order);
        const order = await orderRepo.save(
          orderRepo.create({
            table_id: table.id,
            table_code: table.code,
            // Items vào thẳng KITCHEN nên "lần đầu báo bếp" = ngay lúc duyệt.
            first_kitchen_at: nowMs,
            closed_at: null,
            is_paid: false,
            source: 'ONLINE',
            fulfillment_type: request.fulfillment_type,
            online_request_id: request.id,
            order_token: request.order_token,
            customer_name: request.customer_name,
            customer_phone: request.customer_phone,
            customer_address: request.customer_address,
            customer_lat: request.customer_lat,
            customer_lng: request.customer_lng,
            customer_map_link: request.customer_map_link,
            distance_km: request.distance_km,
            ship_fee: body.ship_fee ?? 0,
            payment_method: 'CASH',
            created_by_user_id: actor.id,
            created_by_full_name: actor.full_name,
          }),
        );

        // ── Bước 5: tạo order_items từ keptItems — bếp thấy ngay ──
        const itemRepo = mgr.getRepository(OrderItem);
        for (const it of keptItems) {
          await itemRepo.save(
            itemRepo.create({
              order_id: order.id,
              menu_item_id: it.menu_item_id,
              menu_item_name: it.name,
              // M2.D-42: giá LẤY TỪ SNAPSHOT (giá đã chốt lúc khách đặt), KHÔNG đọc lại giá menu
              // hiện tại — giá menu có thể đã đổi giữa lúc khách submit và lúc admin duyệt.
              menu_item_price: it.unit_price,
              is_note: false,
              qty: it.qty,
              state: 'KITCHEN',
              is_priority: false,
              note: it.note ?? null,
              created_by_user_id: actor.id,
              created_by_full_name: actor.full_name,
            }),
          );
        }

        // ── Bước 6: nhật ký hoạt động (append-only) ──
        // Lỗi ghi log KHÔNG được làm rollback cả giao dịch duyệt đơn — bọc try/catch riêng,
        // giống khuôn `writeActivity` của OrdersService.
        try {
          await mgr.getRepository(OrderActivityLog).insert({
            order_id: order.id,
            item_id: null,
            table_id: table.id,
            table_code: table.code,
            order_opened_at: order.opened_at,
            event_kind: 'order_created',
            message: `Duyệt đơn online — cấp bàn ${table.code}${tableCreated ? ' (bàn tự tạo)' : ''}`,
            actor_id: actor.id,
            actor_name: actor.full_name,
          });
        } catch (logErr) {
          this.logger.warn(`Ghi nhật ký "order_created" thất bại: ${(logErr as Error).message}`);
        }

        // ── Bước 7: cập nhật request + huỷ outbox L2 (SMS) còn PENDING ──
        // Huỷ outbox NGAY TRONG CÙNG transaction — không để khoảng hở "đã CONFIRMED nhưng SMS
        // vẫn bắn".
        request.status = 'CONFIRMED';
        request.order_id = order.id;
        request.reviewed_at = nowMs;
        request.reviewed_by_user_id = actor.id;
        request.reviewed_by_full_name = actor.full_name;
        await mgr.getRepository(OnlineOrderRequest).save(request);
        await this.outbox.cancelPendingForRequest(request.id, mgr);

        return { order, table, tableCreated, droppedCount, kind };
      });

      if (txOut.tableCreated) {
        this.emitter.emit('audit.write', {
          actor_id: actor.id,
          actor_name: actor.full_name,
          ip: 'system',
          ts_ms: Date.now(),
          action_kind: 'online_order.table_autocreated',
          target_kind: 'table',
          target_id: txOut.table.id,
          after_json: {
            code: txOut.table.code,
            kind: txOut.kind,
            reason: 'Hết bàn trống khi duyệt đơn online',
            request_id: requestId,
          },
        });
      }
      // SSE — plan 09-07 tiêu thụ event này để FE tải lại hàng chờ (D-06).
      this.emitter.emit('online_order.reviewed', { request_id: requestId, at_ms: Date.now() });

      return {
        order_id: txOut.order.id,
        table_code: txOut.table.code,
        table_created: txOut.tableCreated,
        dropped_count: txOut.droppedCount,
      };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ConflictException) {
        throw err;
      }
      this.logger.error(
        `confirm thất bại cho request=${requestId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  /** Từ chối đơn — không cần transaction phức tạp như confirm, nhưng vẫn khoá request để 2
   * admin không cùng từ chối 1 đơn (dùng chung `lockWaitingRequest`). */
  async reject(requestId: string, actor: ReviewActor, body: RejectOnlineOrderBody): Promise<void> {
    try {
      const outcome = await this.ds.transaction(async (mgr) => {
        const request = await this.lockWaitingRequest(mgr, requestId);

        // D-08 — câu khách đọc được NGUYÊN VĂN: chỉ 1 trong 5 lý do soạn sẵn, hoặc chữ admin gõ
        // riêng khi chọn "Khác".
        const rejectReason =
          body.reason_code === 'OTHER'
            ? body.reason_other_text!.trim()
            : REJECT_REASON_TEXT[body.reason_code];

        // Ghi chú riêng của admin — CHỈ lưu DB + audit log, TUYỆT ĐỐI không lộ ra bất kỳ response
        // công khai nào (D-09).
        const internalNote = body.internal_note?.trim() || null;

        request.status = 'REJECTED';
        request.reject_reason = rejectReason;
        request.internal_reject_note = internalNote;
        request.reviewed_at = Date.now();
        request.reviewed_by_user_id = actor.id;
        request.reviewed_by_full_name = actor.full_name;
        await mgr.getRepository(OnlineOrderRequest).save(request);

        await this.outbox.cancelPendingForRequest(request.id, mgr);

        return { reasonCode: body.reason_code, rejectReason, internalNote };
      });

      // D-10 — KHÔNG bắn SMS/thông báo gì cho khách ở nhánh này; khách chỉ biết qua /o/:token.
      this.emitter.emit('online_order.reviewed', { request_id: requestId, at_ms: Date.now() });
      // Audit `online_order.rejected` KHÔNG emit thủ công ở đây nữa (chốt tại plan 09-07):
      // `AuditInterceptor` đã có nhánh riêng cho `POST /admin/online-orders/:id/reject`, giữ cả
      // hai sẽ sinh 2 dòng audit cho 1 lần từ chối. Nhánh duy nhất còn emit thủ công là
      // `online_order.table_autocreated` trong confirm() — interceptor không có cách nào biết
      // chuyện tự tạo bàn.
      //
      // Đánh đổi đã biết: `after_json` do interceptor ghi lấy từ response body, nên nó có
      // `reason_code` + `has_internal_note` mà KHÔNG có `reject_reason` (câu gửi khách) lẫn nội
      // dung `internal_note`. Cả hai vẫn tra được ở `online_order_requests.reject_reason` /
      // `.internal_reject_note` của chính `target_id` — và nội dung ghi chú nội bộ cố tình
      // không đi qua HTTP (D-09).
      this.logger.log(
        `Từ chối đơn ${requestId} — lý do ${outcome.reasonCode}${outcome.internalNote ? ' (có ghi chú nội bộ)' : ''}`,
      );
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ConflictException) {
        throw err;
      }
      this.logger.error(
        `reject thất bại cho request=${requestId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  /** Danh sách đơn online theo trạng thái (OD-11). Re-check tồn kho 1 lần cho TOÀN BỘ món của
   * mọi đơn (1 query `In(...)`, không N+1 theo từng đơn).
   *
   * Thứ tự sắp KHÁC NHAU theo trạng thái, và đó là có chủ ý:
   *   - `WAITING`  → `submitted_at` **ASC**: FIFO, đơn chờ lâu nhất lên đầu (09-UI-SPEC Giả
   *     định #1). Đây là danh sách việc-phải-làm, ai chờ lâu nhất phục vụ trước.
   *   - đã xử lý → `reviewed_at` **DESC**: đây là danh sách tra cứu, việc vừa làm xong mới là
   *     việc người ta cần xem lại. Sắp ASC ở đây là bắt nhân viên cuộn xuống cuối mỗi lần mở tab. */
  async list(
    status: AdminOnlineOrderStatusFilter = 'WAITING',
  ): Promise<AdminOnlineOrderList> {
    const requests = await this.ds.getRepository(OnlineOrderRequest).find({
      where: { status },
      order:
        status === 'WAITING'
          ? { submitted_at: 'ASC' }
          : // `submitted_at` là mốc phụ cho trường hợp `reviewed_at` bằng nhau (2 đơn duyệt
            // trong cùng một milisecond) — không có nó thì thứ tự không xác định.
            { reviewed_at: 'DESC', submitted_at: 'DESC' },
    });

    const allMenuIds = Array.from(
      new Set(requests.flatMap((r) => r.items_snapshot.map((it) => it.menu_item_id))),
    );
    const menus =
      allMenuIds.length === 0
        ? []
        : await this.ds.getRepository(MenuItem).find({ where: { id: In(allMenuIds) } });
    const menuMap = new Map(menus.map((m) => [m.id, m]));
    const isOutOfStock = (menuItemId: string): boolean => {
      const m = menuMap.get(menuItemId);
      return !m || !m.is_active || m.is_out_of_stock;
    };

    const settings = await this.settingsSvc.readAll();
    const nowMs = Date.now();

    // ── Dữ liệu của Order THẬT: mã bàn + 2 mốc chặng giao + đếm món live ──
    // 2 query cho CẢ danh sách (không N+1 theo từng đơn), cùng khuôn với `menus` phía trên.
    // Đơn còn WAITING không có `order_id` nên không tham gia — map rỗng là đúng, không phải lỗi.
    const orderIds = requests.map((r) => r.order_id).filter((id): id is string => id !== null);

    const orders =
      orderIds.length === 0
        ? []
        : await this.ds.getRepository(Order).find({
            where: { id: In(orderIds) },
            select: ['id', 'table_code', 'shipped_at', 'received_at'],
          });
    const orderMap = new Map(orders.map((o) => [o.id, o]));

    // Đếm bằng GROUP BY thay vì tải hết `order_items` về rồi đếm trong JS: hàng chờ có thể chứa
    // vài chục đơn × chục món, và ta chỉ cần 6 con số mỗi đơn.
    // `is_note = false`: dòng ghi chú cho bếp ("ít cay") không phải món khách đặt — tính vào mẫu
    // số là hiện "4 món" cho đơn 3 món.
    type CountRow = { order_id: string; state: string; n: string | number };
    const countRows: CountRow[] =
      orderIds.length === 0
        ? []
        : await this.ds
            .getRepository(OrderItem)
            .createQueryBuilder('oi')
            .select('oi.order_id', 'order_id')
            .addSelect('oi.state', 'state')
            .addSelect('COUNT(*)', 'n')
            .where('oi.order_id IN (:...ids)', { ids: orderIds })
            .andWhere('oi.is_note = false')
            .groupBy('oi.order_id')
            .addGroupBy('oi.state')
            .getRawMany<CountRow>();

    const countsByOrder = new Map<string, AdminOnlineOrderRow['item_state_counts']>();
    for (const row of countRows) {
      const cur =
        countsByOrder.get(row.order_id) ??
        { total: 0, pending: 0, kitchen: 0, cooking: 0, ready: 0, served: 0, cancelled: 0 };
      const n = Number(row.n);
      cur.total += n;
      switch (row.state) {
        case 'PENDING':
          cur.pending += n;
          break;
        case 'KITCHEN':
          cur.kitchen += n;
          break;
        case 'COOKING':
          cur.cooking += n;
          break;
        case 'READY':
          cur.ready += n;
          break;
        case 'SERVED':
          cur.served += n;
          break;
        default:
          // CANCELLED + OUT_OF_STOCK gộp một cột: với nhân viên nhìn hàng chờ, cả hai đều nghĩa
          // là "món này không tới tay khách" — phân biệt lý do là việc của drawer chi tiết.
          cur.cancelled += n;
      }
      countsByOrder.set(row.order_id, cur);
    }

    // Whitelist tường minh — KHÔNG spread entity: hash IP, user-agent, ghi chú từ chối nội bộ,
    // hay `order_token` đầy đủ tuyệt đối không được lọt vào đây (T-09-31).
    const items: AdminOnlineOrderRow[] = requests.map((r) => ({
      id: r.id,
      order_token_masked: `${r.order_token.slice(0, 4).toUpperCase()}…`,
      status: r.status as AdminOnlineOrderRow['status'],
      fulfillment_type: r.fulfillment_type as AdminOnlineOrderRow['fulfillment_type'],
      customer_name: r.customer_name,
      customer_phone: r.customer_phone,
      customer_address: r.customer_address,
      customer_map_link: r.customer_map_link,
      distance_km: r.distance_km,
      customer_note: r.customer_note,
      items: r.items_snapshot.map((it) => ({
        menu_item_id: it.menu_item_id,
        code: it.code,
        name: it.name,
        unit_price: it.unit_price,
        qty: it.qty,
        note: it.note,
        is_out_of_stock: isOutOfStock(it.menu_item_id),
      })),
      subtotal: r.subtotal,
      submitted_at_ms: r.submitted_at,
      // Đơn đã xử lý: đóng băng đồng hồ tại lúc duyệt, KHÔNG đếm tiếp tới hiện tại. Để nó chạy
      // tiếp là màn tra cứu hiện "đã chờ 3 ngày" cho đơn đã duyệt xong từ hôm qua.
      waiting_seconds:
        r.reviewed_at === null
          ? Math.max(0, Math.floor((nowMs - r.submitted_at) / 1000))
          : Math.max(0, Math.floor((r.reviewed_at - r.submitted_at) / 1000)),
      out_of_stock_count: r.items_snapshot.filter((it) => isOutOfStock(it.menu_item_id)).length,
      reviewed_at_ms: r.reviewed_at,
      reviewed_by_full_name: r.reviewed_by_full_name,
      // `reject_reason` = câu ĐÃ GỬI KHÁCH. `internal_reject_note` không có mặt ở đây và không
      // được thêm vào — xem điểm 3 đầu controller (D-09).
      reject_reason: r.reject_reason,

      table_code: r.order_id ? (orderMap.get(r.order_id)?.table_code ?? null) : null,
      item_state_counts: r.order_id ? (countsByOrder.get(r.order_id) ?? null) : null,
      shipped_at_ms: r.order_id ? (orderMap.get(r.order_id)?.shipped_at ?? null) : null,
      received_at_ms: r.order_id ? (orderMap.get(r.order_id)?.received_at ?? null) : null,
    }));

    const payload: AdminOnlineOrderList = {
      items,
      escalate_sms_after_s: settings.escalate_sms_after_s,
    };
    return AdminOnlineOrderList.strict().parse(payload);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 2 chặng giao hàng (2026-08-04)
  //
  // Cả 2 chỉ SET MỘT MỐC THỜI GIAN, không đổi `online_order_requests.status` và KHÔNG đóng đơn.
  // `received_at` ≠ "đã thu tiền": chủ dự án chốt bàn giữ tới khi thu tiền, nên `closed_at` /
  // `is_paid` vẫn thuộc luồng checkout ở `OrdersService`. Với COD, khách nhận hàng và quán thu
  // được tiền lệch nhau vài tiếng là bình thường.
  //
  // Thứ tự bắt buộc: `ship` → `receive`. Guard ở đây là chốt chặn THẬT, không phải chỉ ẩn nút:
  // ẩn nút mà API vẫn mở thì gọi thẳng URL là set được `received_at` cho đơn chưa rời quán, và
  // 2 cột này sẽ vô nghĩa sau vài tháng.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  /** Khoá dòng `orders` của một request đã duyệt. Trả cả request để biết `fulfillment_type`.
   *
   * `FOR UPDATE` vì 2 nhân viên có thể bấm cùng lúc trên 2 máy — cùng khuôn với
   * `lockWaitingRequest`, chỉ khác là khoá `orders` thay vì `online_order_requests`. */
  private async lockConfirmedOrder(
    mgr: EntityManager,
    requestId: string,
  ): Promise<{ request: OnlineOrderRequest; order: Order }> {
    const request = await mgr.getRepository(OnlineOrderRequest).findOne({ where: { id: requestId } });
    if (!request) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy đơn này.' });
    }
    if (request.status !== 'CONFIRMED' || !request.order_id) {
      throw new ConflictException({
        code: 'ORDER_NOT_CONFIRMED',
        message: 'Đơn chưa được xác nhận nên chưa có gì để giao.',
      });
    }
    const lockRows: Array<{ id: string }> = await mgr.query(
      'SELECT id FROM orders WHERE id = ? FOR UPDATE',
      [request.order_id],
    );
    if (lockRows.length === 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy đơn ở bàn.' });
    }
    const order = await mgr.getRepository(Order).findOne({ where: { id: request.order_id } });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy đơn ở bàn.' });
    }
    return { request, order };
  }

  /** Đánh dấu shipper đã rời quán. CHỈ áp dụng cho DELIVERY. */
  async markShipped(requestId: string, actor: ReviewActor): Promise<FulfillmentResult> {
    return this.ds.transaction(async (mgr) => {
      const { request, order } = await this.lockConfirmedOrder(mgr, requestId);

      if (request.fulfillment_type !== 'DELIVERY') {
        throw new BadRequestException({
          code: 'NOT_A_DELIVERY_ORDER',
          message: 'Đơn khách tự tới lấy không có chặng giao hàng.',
        });
      }
      if (order.received_at !== null) {
        throw new ConflictException({
          code: 'ALREADY_RECEIVED',
          message: 'Khách đã nhận đơn này rồi.',
        });
      }
      // Bấm 2 lần không phải lỗi của nhân viên (mạng chậm, bấm lại) — nhưng KHÔNG ghi đè mốc cũ,
      // vì mốc đầu tiên mới là lúc shipper thật sự rời quán. Trả về mốc đang có, coi như xong.
      if (order.shipped_at !== null) {
        return this.fulfillmentResult(order, request);
      }

      order.shipped_at = Date.now();
      await mgr.getRepository(Order).save(order);
      await this.writeFulfillmentActivity(mgr, order, actor, 'Đã giao cho shipper — đơn rời quán');

      this.emitter.emit('online_order.reviewed', { request_id: requestId, at_ms: Date.now() });
      return this.fulfillmentResult(order, request);
    });
  }

  /** Đánh dấu khách đã cầm hàng. DELIVERY = khách nhận, PICKUP = khách tới lấy.
   *
   * Với PICKUP mốc này GHI ĐÈ M2.D-15 (xem `OVERRIDE-DEBT.md` OD-19). */
  async markReceived(requestId: string, actor: ReviewActor): Promise<FulfillmentResult> {
    return this.ds.transaction(async (mgr) => {
      const { request, order } = await this.lockConfirmedOrder(mgr, requestId);

      if (request.fulfillment_type === 'DELIVERY' && order.shipped_at === null) {
        throw new ConflictException({
          code: 'NOT_SHIPPED_YET',
          message: 'Đơn chưa rời quán — bấm "Đã đi ship" trước.',
        });
      }
      if (order.received_at !== null) {
        return this.fulfillmentResult(order, request);
      }

      order.received_at = Date.now();
      await mgr.getRepository(Order).save(order);
      await this.writeFulfillmentActivity(
        mgr,
        order,
        actor,
        request.fulfillment_type === 'PICKUP' ? 'Khách đã tới lấy hàng' : 'Khách đã nhận hàng',
      );

      this.emitter.emit('online_order.reviewed', { request_id: requestId, at_ms: Date.now() });
      return this.fulfillmentResult(order, request);
    });
  }

  private fulfillmentResult(order: Order, request: OnlineOrderRequest): FulfillmentResult {
    return {
      order_id: order.id,
      table_code: order.table_code,
      fulfillment_type: request.fulfillment_type as 'PICKUP' | 'DELIVERY',
      shipped_at_ms: order.shipped_at,
      received_at_ms: order.received_at,
    };
  }

  /** Ghi vào nhật ký hoạt động của BÀN (`order_activity_log`), song song với audit log của
   * `AuditInterceptor`. Hai chỗ phục vụ 2 người khác nhau: audit log để chủ quán soi "ai bấm",
   * nhật ký bàn để nhân viên mở drawer thấy "đơn này đã đi tới đâu".
   * Lỗi ghi log KHÔNG được làm rớt giao dịch — cùng cách `OrdersService.writeActivity` xử lý. */
  private async writeFulfillmentActivity(
    mgr: EntityManager,
    order: Order,
    actor: ReviewActor,
    message: string,
  ): Promise<void> {
    try {
      await mgr.getRepository(OrderActivityLog).save(
        mgr.getRepository(OrderActivityLog).create({
          order_id: order.id,
          table_id: order.table_id,
          table_code: order.table_code,
          order_opened_at: order.opened_at,
          event_kind: 'online_order_fulfillment',
          message,
          actor_id: actor.id,
          actor_name: actor.full_name,
        }),
      );
    } catch (err) {
      this.logger.warn(`writeFulfillmentActivity thất bại: ${(err as Error).message}`);
    }
  }
}

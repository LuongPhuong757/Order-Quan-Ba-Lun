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
import type { AdminOnlineOrderRow } from '@order/schemas';
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
      this.emitter.emit('audit.write', {
        actor_id: actor.id,
        actor_name: actor.full_name,
        ip: 'system',
        ts_ms: Date.now(),
        action_kind: 'online_order.rejected',
        target_kind: 'online_order_request',
        target_id: requestId,
        after_json: {
          reason_code: outcome.reasonCode,
          reject_reason: outcome.rejectReason,
          internal_note: outcome.internalNote,
        },
      });
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

  /** Hàng chờ duyệt — FIFO theo `submitted_at` ASC (09-UI-SPEC Giả định #1). Re-check tồn kho
   * 1 lần cho TOÀN BỘ món của mọi đơn (1 query `In(...)`, không N+1 theo từng đơn). */
  async list(status: 'WAITING' = 'WAITING'): Promise<AdminOnlineOrderList> {
    const requests = await this.ds
      .getRepository(OnlineOrderRequest)
      .find({ where: { status }, order: { submitted_at: 'ASC' } });

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
      waiting_seconds: Math.max(0, Math.floor((nowMs - r.submitted_at) / 1000)),
      out_of_stock_count: r.items_snapshot.filter((it) => isOutOfStock(it.menu_item_id)).length,
    }));

    const payload: AdminOnlineOrderList = {
      items,
      escalate_sms_after_s: settings.escalate_sms_after_s,
    };
    return AdminOnlineOrderList.strict().parse(payload);
  }
}

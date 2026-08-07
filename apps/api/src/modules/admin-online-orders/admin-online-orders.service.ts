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
import { DataSource, EntityManager, In, MoreThanOrEqual } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  ConfirmOnlineOrderBody,
  EditOnlineOrderItemsBody,
  RejectOnlineOrderBody,
  SwitchFulfillmentBody,
} from '@order/schemas';
import {
  AdminOnlineOrderList,
  EditOnlineOrderItemsResult,
  REJECT_REASON_LABEL,
  REJECT_REASON_TEXT,
  SwitchFulfillmentResult,
  // Quy tắc phí ship dùng CHUNG với trang khách — xem docblock `@order/schemas/ship-fee.ts` về
  // vì sao tuyệt đối không được có bản sao thứ hai của công thức này.
  computeShipFee,
  normalizeShipFeeTiers,
} from '@order/schemas';
import type {
  AdminOnlineOrderRow,
  AdminOnlineOrderStatusFilter,
  FulfillmentResult,
} from '@order/schemas';
// Import namespace (không phải named import) — tránh dòng import lặp lại đúng chuỗi tên hàm
// với dòng gọi hàm bên dưới (2 dòng khớp cùng 1 chuỗi sẽ sai lệch với acceptance criteria đếm
// đúng 1 lần xuất hiện của cơ chế retry trong file này).
import * as RetryLib from '../../common/run-with-retry.js';
import { pickFreeTable, nextTableCode, kindForFulfillment } from './table-assign.js';
import {
  decideSwitchFulfillment,
  resolveSwitchAddress,
  FULFILLMENT_LABEL,
  type FulfillmentType,
} from './switch-fulfillment.js';
import type { OnlineWindow } from './online-window.js';
import { formatTableName } from '../tables/table-kind.js';
import { OnlineOrderRequest } from '../public/entities/online-order-request.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrderActivityLog } from '../orders/entities/order-activity-log.entity.js';
import { PhoneBlacklist } from '../settings/entities/phone-blacklist.entity.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { SettingsService } from '../settings/settings.service.js';

export type ReviewActor = { id: string; full_name: string };

/** Kết quả phần "chặn SĐT" của một lượt từ chối / huỷ đơn (2026-08-06). Tách 2 field thay vì
 * một boolean vì FE phải nói được 2 câu KHÁC NHAU: "đã chặn số 09xx" và "số này vốn đã bị chặn
 * từ trước" — câu thứ hai là thông tin nhân viên cần biết, không phải lỗi. */
export type ReviewBlacklistOutcome = {
  /** Số vừa bị chặn TRONG lượt bấm này. `null` = không tick, hoặc số đã nằm sẵn trong danh sách. */
  blacklisted_phone: string | null;
  blacklist_already: boolean;
};

export type ConfirmResult = {
  order_id: string;
  table_code: string;
  /** Tên bàn đầy đủ ("Ship 03") — toast FE hiện tên này, không hiện mã (chỉ đạo 2026-08-04). */
  table_name: string;
  table_created: boolean;
  dropped_count: number;
};

// Kết quả của `markShipped`/`markReceived` nay là hợp đồng chung `FulfillmentResult` bên
// `@order/schemas` — FE (nút "Đã đi ship"/"Khách đã nhận") đọc cùng một định nghĩa.
// Re-export để controller giữ nguyên đường import cũ.
export type { FulfillmentResult };

@Injectable()
export class AdminOnlineOrdersService {
  private readonly logger = new Logger(AdminOnlineOrdersService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly emitter: EventEmitter2,
    private readonly outbox: NotificationOutboxService,
    private readonly settingsSvc: SettingsService,
  ) {}

  /** Khoá 1 dòng `online_order_requests` (chặn 2 nhân viên cùng thao tác 1 đơn) rồi trả về
   * bản ghi đầy đủ qua repository (KHÔNG parse tay kết quả raw query — cột datetime/json cần
   * transformer của entity, giống cách `NotificationOutboxService.claimDue` đã làm: khoá bằng
   * raw SQL, đọc lại bằng repo trong CÙNG transaction).
   *
   * KHÔNG kiểm tra `status` — nhánh nào cần trạng thái nào thì tự chốt sau khi có khoá.
   * `lockWaitingRequest` (duyệt/từ chối/sửa món) và `switchFulfillment` (đổi hình thức, chạy
   * được cả trước lẫn sau duyệt) dùng chung đúng một cách khoá này. */
  private async lockRequestRow(mgr: EntityManager, requestId: string): Promise<OnlineOrderRequest> {
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
    return request;
  }

  /** Như `lockRequestRow` nhưng chốt thêm `status === 'WAITING'` → 409 cho mọi trạng thái khác. */
  private async lockWaitingRequest(mgr: EntityManager, requestId: string): Promise<OnlineOrderRequest> {
    const request = await this.lockRequestRow(mgr, requestId);
    if (request.status !== 'WAITING') {
      throw new ConflictException({
        code: 'ORDER_ALREADY_CONFIRMED',
        message: 'Đơn này đã được xử lý rồi.',
      });
    }
    return request;
  }

  /** Cấp 1 bàn TRỐNG thuộc `kind`, tự tạo bàn mới khi hết (M2.D-04/05/06/14).
   *
   * Tách khỏi `confirm()` ngày 2026-08-06 để "đổi hình thức nhận hàng" dùng lại NGUYÊN cơ chế
   * này — chép lại một bản thứ hai là mở đường cho 2 luồng cấp bàn phân kỳ (một bên loại bàn
   * đang mở, một bên quên), tức là 2 đơn cùng ngồi một bàn.
   *
   * `actionLabel` chỉ đi vào câu báo lỗi đua-tạo-bàn, để nhân viên biết bấm lại NÚT NÀO.
   *
   * ⚠ Chỉ gọi TRONG transaction: `FOR UPDATE` ở câu chọn bàn chỉ có nghĩa khi việc ghi
   * `orders.table_id` phía sau nằm cùng transaction với nó. */
  private async allocateTable(
    mgr: EntityManager,
    kind: string,
    actionLabel: string,
  ): Promise<{ table: { id: string; code: string; name: string }; tableCreated: boolean }> {
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
    if (picked) return { table: picked, tableCreated: false };

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
      return { table: { id: saved.id, code: saved.code, name: saved.name }, tableCreated: true };
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/Duplicate entry/i.test(msg)) {
        // 2 giao dịch cùng sinh 1 code cùng lúc — không transient nên `RetryLib` không tự
        // thử lại; báo nhân viên bấm lại thay vì để họ nhìn lỗi SQL lạ.
        throw new ConflictException({
          code: 'CONFLICT',
          message: `Có máy khác vừa tạo bàn cùng lúc, bấm ${actionLabel} lại.`,
        });
      }
      throw err;
    }
    // Mã lỗi "hết bàn" cũ của phase 8 KHÔNG được phép xuất hiện ở nhánh này — M2.D-05 đã
    // loại bỏ hoàn toàn khả năng khách bị chặn vì quán hết chỗ.
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
        const { table, tableCreated } = await this.allocateTable(mgr, kind, 'Xác nhận');

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
        table_name: txOut.table.name,
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
   * admin không cùng từ chối 1 đơn (dùng chung `lockWaitingRequest`).
   *
   * `body.blacklist_phone` bật thì chặn luôn SĐT của đơn TRONG cùng transaction — xem
   * `blacklistPhoneForRequest`. */
  async reject(
    requestId: string,
    actor: ReviewActor,
    body: RejectOnlineOrderBody,
  ): Promise<ReviewBlacklistOutcome> {
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

        const blacklist = body.blacklist_phone
          ? await this.blacklistPhoneForRequest(
              mgr,
              request,
              this.blacklistReason(body, 'Từ chối đơn online'),
            )
          : null;

        return { reasonCode: body.reason_code, rejectReason, internalNote, blacklist };
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
      // Audit RIÊNG cho việc chặn số — xem docblock `emitBlacklistAudit`. Phát SAU commit, và
      // chỉ khi thật sự có dòng mới: tick lại một số đã chặn không phải là một lần chặn nữa.
      if (outcome.blacklist && !outcome.blacklist.alreadyThere) {
        this.emitBlacklistAudit(
          actor,
          outcome.blacklist.phone,
          this.blacklistReason(body, 'Từ chối đơn online'),
          requestId,
        );
      }
      this.logger.log(
        `Từ chối đơn ${requestId} — lý do ${outcome.reasonCode}${outcome.internalNote ? ' (có ghi chú nội bộ)' : ''}` +
          (outcome.blacklist ? ` · chặn SĐT ${outcome.blacklist.phone}` : ''),
      );
      return {
        blacklisted_phone:
          outcome.blacklist && !outcome.blacklist.alreadyThere ? outcome.blacklist.phone : null,
        blacklist_already: outcome.blacklist?.alreadyThere ?? false,
      };
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

  /** Huỷ đơn ĐÃ XÁC NHẬN — khách có vấn đề giữa chừng (chốt 2026-08-04, Task.md). Cả 3 role
   * (D-02); body dùng CHUNG khuôn reject: 1 trong 5 lý do soạn sẵn gửi khách + ghi chú nội bộ.
   *
   * Khác reject (đơn còn WAITING, chưa có gì để dọn), huỷ sau xác nhận phải dọn CẢ HAI phía
   * trong MỘT transaction:
   * - Order thật: huỷ mọi món còn sống + NIÊM đơn (`closed_at` set, `is_paid=false` — đúng
   *   khuôn "Đã huỷ" của `OrdersService.cancelWholeOrder`; niêm xong là bàn tự giải phóng).
   * - Request: `status='REJECTED'` + lý do — khách mở /o/:token thấy "đơn bị từ chối" kèm câu
   *   lý do, KHÔNG cần status mới (thêm 1 status là đụng public schema + progress + mọi tab).
   *   `reviewed_by_*` ghi đè sang NGƯỜI HUỶ — tab Đã từ chối phải trả lời "ai huỷ, lúc nào";
   *   ai duyệt ban đầu vẫn tra được ở audit log `online_order.confirmed`.
   *
   * Đơn đã thu tiền (`closed_at` có) → 409: đơn thành công không huỷ được nữa, muốn hoàn
   * tiền là nghiệp vụ khác. */
  async cancelConfirmed(
    requestId: string,
    actor: ReviewActor,
    body: RejectOnlineOrderBody,
  ): Promise<ReviewBlacklistOutcome> {
    const outcome = await this.ds.transaction(async (mgr) => {
      const { request, order } = await this.lockConfirmedOrder(mgr, requestId);

      if (order.closed_at !== null) {
        throw new ConflictException({
          code: 'ORDER_ALREADY_CLOSED',
          message: 'Đơn đã kết (thanh toán hoặc đã huỷ) — không huỷ được nữa.',
        });
      }

      const rejectReason =
        body.reason_code === 'OTHER'
          ? body.reason_other_text!.trim()
          : REJECT_REASON_TEXT[body.reason_code];
      const internalNote = body.internal_note?.trim() || null;

      // Huỷ món — mirror `cancelWholeOrder` (không gọi chéo service: nó tự mở transaction
      // riêng, gọi từ đây là 2 connection nhìn 2 bản dữ liệu khác nhau).
      const itemRepo = mgr.getRepository(OrderItem);
      const items = await itemRepo.find({ where: { order_id: order.id } });
      for (const it of items) {
        if (it.state === 'CANCELLED') continue;
        it.state = 'CANCELLED';
        it.cancelled_reason = `Quán huỷ đơn online: ${rejectReason}`;
        it.cancelled_by_user_id = actor.id;
        it.cancelled_by_full_name = actor.full_name;
        await itemRepo.save(it);
      }

      // Niêm đơn → bàn tự giải phóng (mọi câu chọn bàn đều loại bàn có đơn `closed_at IS NULL`).
      order.closed_at = Date.now();
      order.is_paid = false;
      await mgr.getRepository(Order).save(order);

      request.status = 'REJECTED';
      request.reject_reason = rejectReason;
      request.internal_reject_note = internalNote;
      request.reviewed_at = Date.now();
      request.reviewed_by_user_id = actor.id;
      request.reviewed_by_full_name = actor.full_name;
      await mgr.getRepository(OnlineOrderRequest).save(request);

      await this.outbox.cancelPendingForRequest(request.id, mgr);
      await this.writeFulfillmentActivity(mgr, order, actor, `Quán huỷ đơn online — ${rejectReason}`);

      const blacklist = body.blacklist_phone
        ? await this.blacklistPhoneForRequest(
            mgr,
            request,
            this.blacklistReason(body, 'Huỷ đơn online đã xác nhận'),
          )
        : null;

      return { reasonCode: body.reason_code, internalNote, blacklist };
    });

    this.emitter.emit('online_order.reviewed', { request_id: requestId, at_ms: Date.now() });
    if (outcome.blacklist && !outcome.blacklist.alreadyThere) {
      this.emitBlacklistAudit(
        actor,
        outcome.blacklist.phone,
        this.blacklistReason(body, 'Huỷ đơn online đã xác nhận'),
        requestId,
      );
    }
    this.logger.log(
      `Huỷ đơn đã xác nhận ${requestId} — lý do ${outcome.reasonCode}${outcome.internalNote ? ' (có ghi chú nội bộ)' : ''}` +
        (outcome.blacklist ? ` · chặn SĐT ${outcome.blacklist.phone}` : ''),
    );
    return {
      blacklisted_phone:
        outcome.blacklist && !outcome.blacklist.alreadyThere ? outcome.blacklist.phone : null,
      blacklist_already: outcome.blacklist?.alreadyThere ?? false,
    };
  }

  /** Danh sách đơn online theo trạng thái (OD-11). Re-check tồn kho 1 lần cho TOÀN BỘ món của
   * mọi đơn (1 query `In(...)`, không N+1 theo từng đơn).
   *
   * Thứ tự sắp KHÁC NHAU theo trạng thái, và đó là có chủ ý:
   *   - `WAITING`  → `submitted_at` **ASC**: FIFO, đơn chờ lâu nhất lên đầu (09-UI-SPEC Giả
   *     định #1). Đây là danh sách việc-phải-làm, ai chờ lâu nhất phục vụ trước.
   *   - đã xử lý → `reviewed_at` **DESC**: đây là danh sách tra cứu, việc vừa làm xong mới là
   *     việc người ta cần xem lại. Sắp ASC ở đây là bắt nhân viên cuộn xuống cuối mỗi lần mở tab.
   *
   * `window` = cửa sổ thời gian được xem (order/bếp 14h, admin tuỳ bộ lọc) — controller quyết,
   * service chỉ thực thi. Xem `online-window.ts`. */
  async list(
    status: AdminOnlineOrderStatusFilter = 'WAITING',
    window: OnlineWindow = { maxAgeMs: undefined, windowHours: null },
  ): Promise<AdminOnlineOrderList> {
    // Mốc cắt tính MỘT LẦN cho cả `find` lẫn câu đếm badge — 2 chỗ dùng 2 `Date.now()` khác
    // nhau thì một đơn nằm sát mép có thể được đếm mà không có trong danh sách.
    const cutoffMs = window.maxAgeMs === undefined ? null : Date.now() - window.maxAgeMs;

    const requests = await this.ds.getRepository(OnlineOrderRequest).find({
      // Tab "Thành công" không có status DB riêng: đơn vẫn là CONFIRMED trong
      // `online_order_requests`, "thành công" = Order của nó đã checkout. Query CONFIRMED
      // rồi chia đôi theo `orders.closed_at` ở dưới.
      //
      // Cửa sổ lọc theo `submitted_at` (LÚC KHÁCH ĐẶT), không theo `reviewed_at`: chỉ đạo là
      // "đơn được đặt trong vòng 14h". Lọc theo mốc duyệt thì một đơn đặt từ hôm kia mới duyệt
      // sáng nay vẫn hiện — không đúng câu đã chốt.
      where: {
        status: status === 'COMPLETED' ? 'CONFIRMED' : status,
        ...(cutoffMs === null ? {} : { submitted_at: MoreThanOrEqual(cutoffMs) }),
      },
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
    // Chuẩn hoá MỘT LẦN cho cả danh sách thay vì mỗi đơn một lần — bảng bậc là cấu hình chung.
    const shipFeeTiers = normalizeShipFeeTiers(settings.ship_fee_tiers);
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
            select: [
              'id',
              'table_id',
              'table_code',
              'shipped_at',
              'received_at',
              'closed_at',
              'is_paid',
              // M2.D-62 — không SELECT thì màn quản lý đơn không có đường nào biết phí ship,
              // và nó hiện tổng lệch với màn bàn mà không ai giải thích được (2026-08-06).
              'ship_fee',
            ],
          });
    const orderMap = new Map(orders.map((o) => [o.id, o]));

    // ── Chia đôi CONFIRMED theo mốc thu tiền: chưa checkout ở tab "Đã xác nhận", đã checkout
    // sang tab "Thành công". Lọc SAU khi có orderMap vì `closed_at` sống ở bảng `orders`.
    // ⚠ "Thành công" = closed_at CÓ **và** is_paid=1. Chỉ xét closed_at là dính bug đơn bị
    // HUỶ giữa chừng (niêm đơn: closed_at set, is_paid=0) hiện pill "Thành công". ──
    const isPaid = (r: OnlineOrderRequest): boolean => {
      if (r.order_id === null) return false;
      const o = orderMap.get(r.order_id);
      return o != null && o.closed_at != null && o.is_paid;
    };
    const visible =
      status === 'CONFIRMED'
        ? requests.filter((r) => !isPaid(r))
        : status === 'COMPLETED'
          ? requests.filter((r) => isPaid(r))
          : requests;

    // Tên bàn đầy đủ ("Ship 03", "Mang về 02") — thứ hiện ra màn hình thay cho mã `ship-03`
    // (chỉ đạo 2026-08-04). Đọc từ `restaurant_tables.name` chứ không format lại từ code:
    // bàn có thể được đổi tên tay, tên trong DB mới là sự thật.
    const tableIds = Array.from(new Set(orders.map((o) => o.table_id)));
    const tables =
      tableIds.length === 0
        ? []
        : await this.ds.getRepository(RestaurantTable).find({
            where: { id: In(tableIds) },
            select: ['id', 'name'],
          });
    const tableNameById = new Map(tables.map((t) => [t.id, t.name]));

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
    const items: AdminOnlineOrderRow[] = visible.map((r) => ({
      id: r.id,
      order_token_masked: `${r.order_token.slice(0, 4).toUpperCase()}…`,
      status: r.status as AdminOnlineOrderRow['status'],
      fulfillment_type: r.fulfillment_type as AdminOnlineOrderRow['fulfillment_type'],
      customer_name: r.customer_name,
      customer_phone: r.customer_phone,
      customer_address: r.customer_address,
      customer_map_link: r.customer_map_link,
      // Toạ độ đi kèm để màn quản lý dựng được link bản đồ cho đơn khách bấm "Chia sẻ vị trí"
      // (không có `customer_map_link`). Đây là dữ liệu giao hàng, không phải dữ liệu nội bộ —
      // khác hẳn `ip_hash`/`user_agent` bị chặn ở whitelist này.
      customer_lat: r.customer_lat,
      customer_lng: r.customer_lng,
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
      ship_fee: r.order_id ? (orderMap.get(r.order_id)?.ship_fee ?? 0) : 0,
      // Gợi ý cho ô phí ship (2026-08-06) — CÙNG công thức với con số khách đã đọc ở checkout
      // (`POST /api/public/ship-quote`), nên nhân viên gọi lại không báo một giá khác. Đơn đến
      // lấy không có phí ship nên không có gợi ý; `computeShipFee` tự trả null khi thiếu toạ độ
      // hoặc chủ quán chưa đặt giá mỗi km.
      suggested_ship_fee:
        r.fulfillment_type === 'DELIVERY'
          ? computeShipFee({
              distanceKm: r.distance_km === null ? null : Number(r.distance_km),
              // Bậc phí theo TIỀN MÓN của chính đơn này (2026-08-07) — `r.subtotal` là số server
              // tự cộng từ giá trong DB lúc khách gửi đơn, không phải số client khai.
              subtotal: r.subtotal,
              tiers: shipFeeTiers,
            }).fee
          : null,
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
      table_name: r.order_id
        ? (tableNameById.get(orderMap.get(r.order_id)?.table_id ?? '') ?? null)
        : null,
      item_state_counts: r.order_id ? (countsByOrder.get(r.order_id) ?? null) : null,
      shipped_at_ms: r.order_id ? (orderMap.get(r.order_id)?.shipped_at ?? null) : null,
      received_at_ms: r.order_id ? (orderMap.get(r.order_id)?.received_at ?? null) : null,
      // `paid_at_ms` = mốc THU TIỀN thật — đơn bị huỷ (niêm không thu tiền) phải là null,
      // cùng định nghĩa với `isPaid` phía trên.
      paid_at_ms: isPaid(r) ? (orderMap.get(r.order_id!)?.closed_at ?? null) : null,
    }));

    // ── Badge số đơn từng tab — 1 câu GROUP BY, đếm trên TOÀN BỘ chứ không phải tab đang mở.
    // LEFT JOIN vì WAITING/REJECTED không có Order; CONFIRMED chia đôi theo closed_at đúng
    // như phép lọc `visible` phía trên — 2 chỗ này phải cùng một định nghĩa "thành công".
    type StatusCountRow = { status: string; open_cnt: string | number; paid_cnt: string | number };
    // Cửa sổ 14h (nếu có) phải vào CẢ câu này — badge và danh sách nói cùng một con số.
    const countByStatus: StatusCountRow[] = await this.ds.query(
      `SELECT r.status AS status,
              SUM(CASE WHEN o.closed_at IS NOT NULL AND o.is_paid = 1 THEN 0 ELSE 1 END) AS open_cnt,
              SUM(CASE WHEN o.closed_at IS NOT NULL AND o.is_paid = 1 THEN 1 ELSE 0 END) AS paid_cnt
         FROM online_order_requests r
         LEFT JOIN orders o ON o.id = r.order_id
        WHERE r.status IN ('WAITING', 'CONFIRMED', 'REJECTED')
          ${cutoffMs === null ? '' : 'AND r.submitted_at >= ?'}
        GROUP BY r.status`,
      // `new Date(...)` chứ KHÔNG phải số ms: `submitted_at` là DATETIME(6). Đẩy số vào đây thì
      // MySQL ép kiểu ngầm và điều kiện luôn ĐÚNG — badge đếm toàn bảng trong khi danh sách đã
      // bị cắt, không có lỗi nào nổ ra (bắt được lúc chạy integration test 2026-08-06).
      cutoffMs === null ? [] : [new Date(cutoffMs)],
    );
    const byStatus = new Map(countByStatus.map((c) => [c.status, c]));
    const n = (v: string | number | undefined): number => Number(v ?? 0);
    const status_counts = {
      WAITING: n(byStatus.get('WAITING')?.open_cnt) + n(byStatus.get('WAITING')?.paid_cnt),
      CONFIRMED: n(byStatus.get('CONFIRMED')?.open_cnt),
      COMPLETED: n(byStatus.get('CONFIRMED')?.paid_cnt),
      REJECTED: n(byStatus.get('REJECTED')?.open_cnt) + n(byStatus.get('REJECTED')?.paid_cnt),
    };

    const payload: AdminOnlineOrderList = {
      items,
      escalate_sms_after_s: settings.escalate_sms_after_s,
      window_hours: window.windowHours,
      status_counts,
    };
    return AdminOnlineOrderList.strict().parse(payload);
  }

  /** Sửa món của đơn ĐANG CHỜ DUYỆT (Task.md "cho phép sửa đơn rồi mới xác nhận", 2026-08-04).
   *
   * Ghi thẳng vào `items_snapshot` + `subtotal` của request — trang /o/:token của khách đọc
   * cùng snapshot nên khách mở link theo dõi là thấy đơn mới ("update ngược về đơn của khách"),
   * không cần cơ chế đồng bộ nào thêm. Vì snapshot là thứ confirm() dùng để dựng Order thật,
   * sửa xong rồi Xác nhận là đơn vào bếp đúng bản đã chốt miệng với khách.
   *
   * Món GỌI THÊM (id không có trong snapshot): lấy giá menu HIỆN TẠI + phải đang bán và còn
   * hàng — đơn giá của món thêm không được khách bấm chọn, nên chặn ở server chặt hơn món cũ.
   *
   * CHỈ cho đơn WAITING: sau confirm, món sống ở `order_items` (sửa ở màn bàn/bếp như đơn
   * thường); sửa snapshot lúc đó là sửa vào bản không ai đọc nữa. `lockWaitingRequest` chặn
   * đua với confirm/reject đang chạy song song (FOR UPDATE).
   *
   * Cả 3 role bấm được (D-02) — kiểm soát bù trừ là audit log `online_order.items_edited`
   * (AuditInterceptor tự ghi actor + response body). */
  async editItems(
    requestId: string,
    body: EditOnlineOrderItemsBody,
  ): Promise<EditOnlineOrderItemsResult> {
    const edited = await this.ds.transaction(async (mgr) => {
      const request = await this.lockWaitingRequest(mgr, requestId);

      const qtyById = new Map(body.items.map((i) => [i.menu_item_id, i.qty]));
      const snapIds = new Set(request.items_snapshot.map((it) => it.menu_item_id));

      // ── Món gọi thêm: id lạ so với snapshot → tra menu, chốt giá hiện tại ──
      const additions = body.items.filter((i) => !snapIds.has(i.menu_item_id));
      let addedSnapshot: typeof request.items_snapshot = [];
      if (additions.length > 0) {
        const menus = await mgr
          .getRepository(MenuItem)
          .find({ where: { id: In(additions.map((i) => i.menu_item_id)) } });
        const menuMap = new Map(menus.map((m) => [m.id, m]));
        const unavailable = additions.filter((i) => {
          const m = menuMap.get(i.menu_item_id);
          return !m || !m.is_active || m.is_out_of_stock;
        });
        if (unavailable.length > 0) {
          throw new ConflictException({
            code: 'MENU_ITEM_UNAVAILABLE',
            message:
              'Có món gọi thêm đã hết hàng hoặc ngừng bán — tải lại trang rồi chọn món khác.',
          });
        }
        addedSnapshot = additions.map((i) => {
          const m = menuMap.get(i.menu_item_id)!;
          return {
            menu_item_id: m.id,
            code: m.code,
            name: m.name,
            unit_price: m.price,
            qty: i.qty,
            note: i.note?.trim() ? i.note.trim() : null,
          };
        });
      }

      // Món sẵn có giữ nguyên giá + note đã chốt lúc khách đặt, chỉ nhận qty mới; món gọi
      // thêm nối vào CUỐI — khách mở /o/:token đối chiếu được "phần em đặt" với "phần gọi thêm".
      const nextSnapshot = request.items_snapshot
        .filter((it) => qtyById.has(it.menu_item_id))
        .map((it) => ({ ...it, qty: qtyById.get(it.menu_item_id)! }))
        .concat(addedSnapshot);
      if (nextSnapshot.length === 0) {
        // Schema đã `min(1)` nhưng giữ chốt chặn: mọi đường tới "đơn 0 món" đều phải bị chặn
        // ở server, cùng lý lẽ ORDER_EMPTY_AFTER_DROP của confirm().
        throw new ConflictException({
          code: 'ORDER_EMPTY_AFTER_EDIT',
          message: 'Đơn không còn món nào. Hãy dùng nút Từ chối thay vì sửa.',
        });
      }

      request.items_snapshot = nextSnapshot;
      request.subtotal = nextSnapshot.reduce((s, it) => s + it.unit_price * it.qty, 0);
      await mgr.getRepository(OnlineOrderRequest).save(request);
      return request;
    });

    // Cùng kênh SSE 'reviewed' như confirm/ship: với FE mọi event chỉ là tín hiệu "tải lại
    // hàng chờ" (D-06) — tab của nhân viên KHÁC đang mở cùng đơn sẽ thấy bản mới.
    this.emitter.emit('online_order.reviewed', { request_id: requestId, at_ms: Date.now() });

    // Re-check tồn kho như list() để FE vẽ lại được cảnh báo món hết ngay trên bản mới.
    const menuIds = Array.from(new Set(edited.items_snapshot.map((it) => it.menu_item_id)));
    const menus = await this.ds.getRepository(MenuItem).find({ where: { id: In(menuIds) } });
    const menuMap = new Map(menus.map((m) => [m.id, m]));
    return EditOnlineOrderItemsResult.strict().parse({
      items: edited.items_snapshot.map((it) => {
        const m = menuMap.get(it.menu_item_id);
        return {
          menu_item_id: it.menu_item_id,
          code: it.code,
          name: it.name,
          unit_price: it.unit_price,
          qty: it.qty,
          note: it.note,
          is_out_of_stock: !m || !m.is_active || m.is_out_of_stock,
        };
      }),
      subtotal: edited.subtotal,
    });
  }

  /**
   * Chặn SĐT của đơn ngay trong lượt từ chối / huỷ đơn (chỉ đạo chủ dự án 2026-08-06 — "khách cố
   * tình phá đám thì cho vào blacklist luôn, đỡ mất công vào màn blacklist").
   *
   * ── 3 điều bắt buộc phải nhớ ──
   *
   * 1. **Số lấy từ `request.customer_phone`, KHÔNG BAO GIỜ từ body.** Hai endpoint gọi vào đây
   *    mở cho cả 3 role; nhận số từ client là biến chúng thành đường chặn số bất kỳ mà không cần
   *    quyền admin. Cột `phone` đã chuẩn hoá từ lúc khách submit nên không cần chuẩn hoá lại.
   *
   * 2. **Số đã có trong danh sách = XONG, không phải lỗi.** Ném 409 ở đây là làm rớt cả lượt
   *    huỷ đơn chỉ vì một cái tick thừa — trong khi việc chính (huỷ đơn) đã thành công.
   *
   * 3. **Chạy TRONG transaction của lượt huỷ/từ chối.** Nhân viên được hứa 2 việc trong 1 lần
   *    bấm; "đơn đã huỷ nhưng số không bị chặn" là trạng thái không ai kiểm lại được bằng mắt.
   *
   * Quyền GỠ vẫn chỉ admin (`/admin/phone-blacklist` có `AdminGuard`) — mở quyền chặn cho 3 role
   * không đồng nghĩa mở quyền gỡ. Kiểm soát bù trừ là audit `phone_blacklist.added` phát ở dưới.
   */
  private async blacklistPhoneForRequest(
    mgr: EntityManager,
    request: OnlineOrderRequest,
    reason: string,
  ): Promise<{ phone: string; alreadyThere: boolean }> {
    const repo = mgr.getRepository(PhoneBlacklist);
    const phone = request.customer_phone;
    const exists = await repo.findOne({ where: { phone } });
    if (exists) return { phone, alreadyThere: true };
    await repo.save(
      repo.create({
        phone,
        // Cột `varchar(255)` — cắt ở đây chứ không để MySQL cắt ngầm (strict mode thì nó ném lỗi
        // và làm rollback cả lượt huỷ đơn).
        reason: reason.slice(0, 255),
        expires_at: null, // vĩnh viễn (M2.D-59) — không có cron nào tự gỡ
      }),
    );
    return { phone, alreadyThere: false };
  }

  /** Câu ghi vào cột `reason` của blacklist — thứ admin đọc ở màn danh sách chặn khi cần quyết
   * định có gỡ hay không.
   *
   * CỐ Ý KHÔNG chép `internal_note` vào đây: ghi chú nội bộ có chỗ sống riêng (cột
   * `internal_reject_note` + audit log, D-09), nhân bản nó sang bảng thứ ba là thêm một chỗ nữa
   * phải nhớ khi cần xoá. Với lý do "Khác" thì lấy chính câu đã gửi khách — câu đó không bí mật
   * và là thứ mô tả sự việc rõ nhất. */
  private blacklistReason(body: RejectOnlineOrderBody, context: string): string {
    const detail =
      body.reason_code === 'OTHER'
        ? (body.reason_other_text?.trim() ?? REJECT_REASON_LABEL.OTHER)
        : REJECT_REASON_LABEL[body.reason_code];
    return `${context} — ${detail}`;
  }

  /** Audit riêng cho việc chặn số. KHÔNG trùng vai với audit của chính lượt từ chối/huỷ đơn
   * (`AuditInterceptor` ghi): người đi soi "số này ai chặn, vì sao" lọc theo action kind
   * `phone_blacklist.added` — nếu việc chặn từ màn đơn online không phát event đó thì mọi số bị
   * chặn qua đường này trở nên vô hình với đúng câu hỏi đó. */
  private emitBlacklistAudit(
    actor: ReviewActor,
    phone: string,
    reason: string,
    requestId: string,
  ): void {
    this.emitter.emit('audit.write', {
      actor_id: actor.id,
      actor_name: actor.full_name,
      ip: 'system',
      ts_ms: Date.now(),
      action_kind: 'phone_blacklist.added',
      target_kind: 'phone_blacklist',
      target_id: phone,
      after_json: { phone, reason, from_online_order_request: requestId },
    });
  }

  /** Đổi hình thức nhận hàng: Giao tận nơi ⇄ Đến lấy tại quán (chốt 2026-08-06 — "order, bếp và
   * admin đều làm được, bất cứ lúc nào TRƯỚC khi mang đi ship").
   *
   * Luật ai-đổi-được nằm ở module thuần `switch-fulfillment.ts`; hàm này chỉ thực thi. 3 việc
   * phải xảy ra CÙNG MỘT transaction, không tách được:
   *
   * 1. `online_order_requests.fulfillment_type` — bản khách đang đọc ở /o/:token.
   * 2. `orders.fulfillment_type` + **BÀN** — đơn đã duyệt đang ngồi ở bàn SAI LOẠI (ship-03 cho
   *    đơn giờ là "tự tới lấy"). Sơ đồ bàn, màn bếp và mọi câu đếm bàn đều đọc `kind` của bàn,
   *    nên để nguyên bàn cũ là đơn hiện nhầm chỗ ở KHẮP NƠI. Đổi bàn bằng cách trỏ
   *    `orders.table_id` sang bàn mới — KHÔNG dùng `OrdersService.transferTable`: hàm đó tạo
   *    Order MỚI rồi XOÁ order cũ, mà `online_order_requests.order_id` đang trỏ vào đúng order
   *    đó (đứt liên kết = mất luôn 2 mốc giao hàng và đường về /o/:token).
   * 3. `ship_fee` — đổi sang PICKUP là về 0, không có ngoại lệ (M2.D-62; xem điểm 2 đầu
   *    `switch-fulfillment.ts`).
   *
   * Khoá theo ĐÚNG thứ tự của confirm() (request trước, orders sau) để 2 luồng chạy song song
   * không ôm khoá chéo nhau. */
  async switchFulfillment(
    requestId: string,
    actor: ReviewActor,
    body: SwitchFulfillmentBody,
  ): Promise<SwitchFulfillmentResult> {
    const target = body.fulfillment_type;

    const out = await this.ds.transaction(async (mgr) => {
      const request = await this.lockRequestRow(mgr, requestId);

      // Đơn đã duyệt: khoá luôn dòng `orders` — nhân viên khác có thể đang bấm "Đã đi ship" ở
      // đúng giây này, và mốc đó là thứ quyết định đơn còn đổi được hay không.
      let order: Order | null = null;
      if (request.status === 'CONFIRMED' && request.order_id) {
        const lockRows: Array<{ id: string }> = await mgr.query(
          'SELECT id FROM orders WHERE id = ? FOR UPDATE',
          [request.order_id],
        );
        if (lockRows.length > 0) {
          order = await mgr.getRepository(Order).findOne({ where: { id: request.order_id } });
        }
      }

      const decision = decideSwitchFulfillment(
        {
          status: request.status,
          fulfillment_type: request.fulfillment_type,
          order:
            order === null
              ? null
              : {
                  shipped_at: order.shipped_at,
                  received_at: order.received_at,
                  closed_at: order.closed_at,
                },
        },
        target,
      );
      if (decision.kind === 'CONFLICT') {
        throw new ConflictException({ code: decision.code, message: decision.message });
      }

      const addr = resolveSwitchAddress(target, request.customer_address, body.customer_address);
      if (addr.kind === 'ERROR') {
        throw new BadRequestException({ code: addr.code, message: addr.message });
      }

      const from = request.fulfillment_type as FulfillmentType;
      const previousTableCode = order?.table_code ?? null;

      // ── Chuyển bàn (chỉ đơn đã duyệt) ──
      let table: { id: string; code: string; name: string } | null = null;
      let tableCreated = false;
      if (decision.needsTableMove && order) {
        const allocated = await this.allocateTable(
          mgr,
          kindForFulfillment(target),
          'Đổi hình thức',
        );
        table = allocated.table;
        tableCreated = allocated.tableCreated;
      }

      // ── Ghi request (bản khách đọc) ──
      request.fulfillment_type = target;
      request.customer_address = addr.customer_address;
      if (addr.clearGeo) {
        // 3 field này mô tả địa chỉ CŨ. Giữ lại là để shipper mở bản đồ ra một cái nhà không còn
        // liên quan, và `distance_km` thành căn cứ tính phí ship của quãng đường không ai đi.
        request.customer_lat = null;
        request.customer_lng = null;
        request.customer_map_link = null;
        request.distance_km = null;
      }
      await mgr.getRepository(OnlineOrderRequest).save(request);

      // ── Ghi order thật (nếu có) ──
      if (order) {
        if (table) {
          order.table_id = table.id;
          order.table_code = table.code;
        }
        order.fulfillment_type = target;
        order.customer_address = request.customer_address;
        if (addr.clearGeo) {
          order.customer_lat = null;
          order.customer_lng = null;
          order.customer_map_link = null;
          order.distance_km = null;
        }
        // Đổi sang PICKUP: KHÔNG còn khoản thu hộ nào. Đổi sang DELIVERY: chỉ ghi khi nhân viên
        // thực sự nhập — không gửi gì thì giữ nguyên phí đang có (đổi qua đổi lại không được
        // âm thầm xoá con số đã chốt miệng với khách).
        if (target === 'PICKUP') {
          order.ship_fee = 0;
        } else if (body.ship_fee !== undefined) {
          order.ship_fee = body.ship_fee;
        }
        await mgr.getRepository(Order).save(order);

        await this.writeFulfillmentActivity(
          mgr,
          order,
          actor,
          `Đổi hình thức nhận hàng: ${FULFILLMENT_LABEL[from]} → ${FULFILLMENT_LABEL[target]}` +
            (table && previousTableCode
              ? ` · chuyển bàn ${previousTableCode} → ${table.code}${tableCreated ? ' (bàn tự tạo)' : ''}`
              : ''),
        );
      }

      return { request, order, table, tableCreated, from, previousTableCode };
    });

    if (out.tableCreated && out.table) {
      this.emitter.emit('audit.write', {
        actor_id: actor.id,
        actor_name: actor.full_name,
        ip: 'system',
        ts_ms: Date.now(),
        action_kind: 'online_order.table_autocreated',
        target_kind: 'table',
        target_id: out.table.id,
        after_json: {
          code: out.table.code,
          kind: kindForFulfillment(target),
          reason: 'Hết bàn trống khi đổi hình thức nhận hàng',
          request_id: requestId,
        },
      });
    }
    // Cùng kênh SSE với confirm/ship: mọi tab đang mở tự tải lại hàng chờ (D-06).
    this.emitter.emit('online_order.reviewed', { request_id: requestId, at_ms: Date.now() });
    this.logger.log(
      `Đổi hình thức đơn ${requestId}: ${out.from} → ${target}` +
        (out.table ? ` (bàn ${out.previousTableCode} → ${out.table.code})` : ' (đơn chưa duyệt)'),
    );

    const settings = await this.settingsSvc.readAll();

    return SwitchFulfillmentResult.strict().parse({
      request_id: requestId,
      from_fulfillment_type: out.from,
      fulfillment_type: target,
      customer_address: out.request.customer_address,
      distance_km: out.request.distance_km,
      table_code: out.table?.code ?? out.order?.table_code ?? null,
      table_name: out.table?.name ?? null,
      previous_table_code: out.previousTableCode,
      table_created: out.tableCreated,
      ship_fee: out.order?.ship_fee ?? 0,
      // Gợi ý phí ship phải đi cùng chuyến với `distance_km` mới: đổi sang địa chỉ khác (hoặc thôi
      // giao hẳn) mà FE giữ gợi ý cũ thì ô phí ship điền sẵn một con số của quãng đường không còn
      // liên quan — cùng loại lỗi mà `switch-fulfillment.ts` đã phải xoá toạ độ + link bản đồ để
      // tránh. Tính lại bằng ĐÚNG hàm dùng ở hàng chờ và ở trang khách.
      suggested_ship_fee:
        target === 'DELIVERY'
          ? computeShipFee({
              distanceKm:
                out.request.distance_km === null ? null : Number(out.request.distance_km),
              subtotal: out.request.subtotal,
              tiers: normalizeShipFeeTiers(settings.ship_fee_tiers),
            }).fee
          : null,
    });
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

  /** Tra `request_id` từ `order_id` — cho cặp route `by-order/:orderId/ship|receive` mà DRAWER
   * màn bàn gọi (2026-08-04): drawer chỉ cầm Order, còn 2 mốc giao sống theo request. */
  async requestIdByOrderId(orderId: string): Promise<string> {
    const rows: Array<{ id: string }> = await this.ds.query(
      'SELECT id FROM online_order_requests WHERE order_id = ? LIMIT 1',
      [orderId],
    );
    if (rows.length === 0) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Bàn này không phải đơn online.',
      });
    }
    return rows[0].id;
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

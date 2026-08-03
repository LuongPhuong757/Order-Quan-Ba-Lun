// Cài `SubmitDeps` thật lên `DataSource`/`EntityManager`, bọc `submit()` trong 1 transaction
// có gap lock `FOR UPDATE` (RESEARCH Pattern 3, threat T-08-50 HIGH). Toàn bộ quyết định +
// build dữ liệu nằm ở `submit-order.ts` (Task 1, test được bằng fake-repository) — file này
// CHỈ có nhiệm vụ nối dây DB thật, không tự phát minh lại logic guard/giá.
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { OnlineOrderSubmit } from '@order/schemas';
import { PublicOrderCancelResult, PublicOrderStatus } from '@order/schemas';
import { SettingsService } from '../settings/settings.service.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { PhoneBlacklist } from '../settings/entities/phone-blacklist.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { OnlineOrderRequest } from './entities/online-order-request.entity.js';
import { hashIp, resolveIpHashSalt } from './ip-hash.js';
import {
  EXCLUDED_ITEM_STATES,
  STAGE_LABEL_CANCELLED_BY_CUSTOMER,
  computeProgress,
  stageLabel,
} from './order-progress.js';
import { submitOrder, type MenuItemLookup, type SubmitDeps } from './submit-order.js';
import { cancelOrderByCustomer } from './cancel-order.js';

@Injectable()
export class PublicOrdersService {
  private readonly logger = new Logger(PublicOrdersService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(OnlineOrderRequest) private readonly requestRepo: Repository<OnlineOrderRequest>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    private readonly settingsSvc: SettingsService,
    private readonly outbox: NotificationOutboxService,
    private readonly emitter: EventEmitter2,
  ) {}

  /**
   * Bọc TOÀN BỘ validate + insert trong 1 transaction — gap lock `hasOpenOrderForPhoneLocked`
   * (`FOR UPDATE`) chỉ có hiệu lực chống race khi nằm CÙNG transaction với insert phía sau.
   *
   * Phase 9 (REQ-N) thêm 2 việc, thứ tự KHÔNG được đổi:
   *
   * 1. **Xếp hàng thông báo L1/L2/L3 BÊN TRONG transaction** — outbox pattern. Nếu enqueue nằm
   *    ngoài transaction thì có cửa sổ "đơn đã vào DB mà không ai được báo" (process chết giữa 2
   *    lệnh, hoặc enqueue lỗi) — đúng thứ REQ-N sinh ra để chống. Đơn và lịch SMS cùng commit
   *    hoặc cùng rollback.
   * 2. **Emit SSE SAU khi commit** — nếu emit trong transaction rồi transaction rollback thì mọi
   *    tab admin nhận tín hiệu về một "đơn ma" không tồn tại trong DB (T-09-51).
   */
  async submit(
    input: OnlineOrderSubmit,
    ctx: { ip: string; userAgent: string; nowMs: number },
  ): Promise<{ order_token: string; distance_km: string | null }> {
    const { result, requestId } = await this.ds.transaction(async (mgr) => {
      const txResult = await submitOrder(this.makeDeps(mgr), input, ctx);
      // `submitOrder` (module thuần phase 8) cố ý KHÔNG trả id — không đổi chữ ký của nó vì plan
      // 09-12 còn phải sửa file đó, tránh đụng độ. Đọc lại id trong CÙNG transaction.
      const rows: Array<{ id: string }> = await mgr.query(
        'SELECT id FROM online_order_requests WHERE order_token = ?',
        [txResult.order_token],
      );
      const id = rows[0]?.id;
      if (id) {
        await this.outbox.enqueueForNewRequest(id, ctx.nowMs, mgr);
      }
      return { result: txResult, requestId: id };
    });

    if (requestId) {
      // Fire-and-forget: emit lỗi KHÔNG được làm hỏng response 201 của khách (T-09-52, khuôn
      // `AuditEventHandler`). Payload phải khớp `OnlineOrderStreamEvent` vì controller SSE
      // (plan 09-07) `.strict().parse()` nó trước khi đẩy ra stream.
      try {
        this.emitter.emit('online_order.new', {
          type: 'new',
          request_id: requestId,
          at_ms: Date.now(),
        });
      } catch (err) {
        this.logger.warn(`Emit event đơn mới thất bại (đơn vẫn đã lưu): ${(err as Error).message}`);
      }
    }

    return result;
  }

  /**
   * `DELETE /api/public/orders/:token` — khách tự huỷ đơn còn `WAITING` (M2.D-44 nửa huỷ).
   *
   * Quyết định nằm ở `cancel-order.ts` (module thuần, test bằng fake-deps); file này CHỈ nối dây
   * DB thật. Row lock `FOR UPDATE` phải nằm CÙNG transaction với lệnh UPDATE phía sau — đó là
   * toàn bộ cách giải race với `AdminOnlineOrdersService.confirm()` (T-09-82).
   *
   * SSE emit SAU commit, và chỉ khi thực sự vừa đổi trạng thái: emit trong transaction rồi
   * rollback là báo cho mọi tab admin về một thay đổi không có thật (cùng lý do T-09-51 ở
   * `submit()`).
   */
  async cancelByToken(token: string): Promise<PublicOrderCancelResult> {
    const settings = await this.settingsSvc.readAll();

    const outcome = await this.ds.transaction(async (mgr) =>
      cancelOrderByCustomer(
        {
          lockRequestByToken: async (t) => {
            const rows: Array<{ id: string; status: string }> = await mgr.query(
              'SELECT id, status FROM online_order_requests WHERE order_token = ? FOR UPDATE',
              [t],
            );
            return rows[0] ?? null;
          },
          markCancelled: async (id, nowMs) => {
            await mgr.query(
              `UPDATE online_order_requests SET status = 'CANCELLED_BY_CUSTOMER', cancelled_at = ? WHERE id = ?`,
              [new Date(nowMs), id],
            );
          },
          cancelPendingNotifications: async (id) => {
            await this.outbox.cancelPendingForRequest(id, mgr);
          },
          storePhone: settings.store_phone,
        },
        token,
        Date.now(),
      ),
    );

    if (outcome.changed) {
      // Hàng chờ duyệt phải tự bớt đơn này đi — không thì nhân viên bấm Xác nhận một đơn ma rồi
      // nhận 409. Fire-and-forget: emit lỗi KHÔNG được biến một lần huỷ đã commit thành lỗi 500.
      try {
        this.emitter.emit('online_order.reviewed', {
          request_id: outcome.request_id,
          at_ms: Date.now(),
        });
      } catch (err) {
        this.logger.warn(`Emit event khách huỷ đơn thất bại (đơn vẫn đã huỷ): ${(err as Error).message}`);
      }
    }

    return PublicOrderCancelResult.strict().parse({
      order_token: outcome.order_token,
      status: outcome.status,
    });
  }

  private makeDeps(mgr: EntityManager): SubmitDeps {
    return {
      getOrderingStatus: (nowMs) => this.settingsSvc.getOrderingStatus(nowMs),

      readSettings: async () => {
        const s = await this.settingsSvc.readAll();
        return {
          store_phone: s.store_phone,
          store_lat: s.store_lat,
          store_lng: s.store_lng,
          distance_factor: s.distance_factor,
          free_ship_km: s.free_ship_km,
          online_ordering_off_reason: s.online_ordering_off_reason,
          pickup_enabled: s.pickup_enabled,
          delivery_enabled: s.delivery_enabled,
        };
      },

      // M2.D-59 — điều kiện `expires_at` viết sẵn cho tính năng chặn tạm thời sau này; hiện
      // cột luôn NULL (chỉ thêm/xoá tay), nhưng logic đọc đã đúng ngay từ đầu.
      isPhoneBlacklisted: async (phone) => {
        const count = await mgr
          .getRepository(PhoneBlacklist)
          .createQueryBuilder('b')
          .where('b.phone = :phone', { phone })
          .andWhere('(b.expires_at IS NULL OR b.expires_at > NOW())')
          .getCount();
        return count > 0;
      },

      // D-18 — đếm trong DB, KHÔNG throttler in-memory, KHÔNG Redis.
      countRecentByPhone: async (phone, sinceMs) => {
        const rows: Array<{ cnt: string | number }> = await mgr.query(
          'SELECT COUNT(*) AS cnt FROM online_order_requests WHERE customer_phone = ? AND submitted_at >= ?',
          [phone, new Date(sinceMs)],
        );
        return Number(rows[0]?.cnt ?? 0);
      },

      // T-08-50 (HIGH) — gap lock: `SELECT ... FOR UPDATE` trên khoảng index
      // `idx_oor_phone_status` trong CÙNG transaction với insert bên dưới. KHÔNG thay bằng
      // `findOne` thường (mất lock), KHÔNG dùng `GET_LOCK()` hay bảng lock phụ.
      hasOpenOrderForPhoneLocked: async (phone) => {
        const rows: Array<{ id: string }> = await mgr.query(
          `SELECT id FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`,
          [phone],
        );
        return rows.length > 0;
      },

      findMenuItemsByIds: async (ids): Promise<MenuItemLookup[]> => {
        if (ids.length === 0) return [];
        return mgr.getRepository(MenuItem).find({
          where: { id: In(ids) },
          select: ['id', 'code', 'name', 'price', 'unit', 'is_active', 'is_out_of_stock'],
        });
      },

      insertRequest: async (row) => {
        await mgr.getRepository(OnlineOrderRequest).insert({
          ...row,
          // decimal(10,7) → mysql2 nhận string; entity khai `string | null` (xem entity docblock).
          customer_lat: row.customer_lat !== null ? String(row.customer_lat) : null,
          customer_lng: row.customer_lng !== null ? String(row.customer_lng) : null,
        });
      },

      hashIpFn: (ip) => hashIp(ip, resolveIpHashSalt()),
    };
  }

  /**
   * Trang theo dõi đơn của khách (REQ-O). Whitelist TƯỜNG MINH + `.strict().parse()` — TUYỆT ĐỐI
   * không trả `ip_hash`/`user_agent`/`customer_*`/`reviewed_by_*`/trạng thái từng món.
   *
   * 3 ranh giới cứng của hàm này:
   *
   * - **M2.D-23 / G-1:** `item_states` chỉ dùng để TÍNH `percent`, không bao giờ đi ra response.
   *   Mỗi dòng `items` được map tay đúng 3 field (`name`/`qty`/`unit_price`) — KHÔNG spread entity
   *   `OrderItem`, vì spread là cách `state` lọt ra ngoài mà typecheck vẫn xanh.
   * - **D-09:** hàm này BỊ CẤM đọc cột ghi chú nội bộ của admin. Nội dung khách được đọc chỉ là
   *   `reject_reason` (câu soạn sẵn). Đừng thêm cột đó vào payload dù "để debug".
   * - **M2.D-47:** sau khi duyệt, `items` + `subtotal` lấy từ `order_items` THẬT, không phải
   *   `items_snapshot` — admin sửa món ở bàn thì khách phải thấy danh sách và tổng tiền mới.
   */
  async getByToken(token: string): Promise<PublicOrderStatus> {
    const request = await this.requestRepo.findOne({ where: { order_token: token } });
    if (!request) {
      throw new NotFoundException({ code: 'ORDER_TOKEN_NOT_FOUND', message: 'Không tìm thấy đơn này.' });
    }
    const settings = await this.settingsSvc.readAll();
    const fulfillment_type = request.fulfillment_type as PublicOrderStatus['fulfillment_type'];

    let updatedAtMs = request.submitted_at;
    let itemStates: string[] = [];
    let items: PublicOrderStatus['items'];

    if (request.order_id) {
      const order = await this.orderRepo.findOne({ where: { id: request.order_id } });
      const rows = await this.itemRepo.find({ where: { order_id: request.order_id } });
      // Dòng ghi chú (`is_note`) là lời nhắn cho bếp ("ít cay", "lấy thêm bát"), không phải món
      // khách đặt → không tính vào %, không hiện trong danh sách khách xem.
      const real = rows.filter((r) => !r.is_note);
      itemStates = real.map((r) => r.state);
      items = real
        .filter((r) => !(EXCLUDED_ITEM_STATES as readonly string[]).includes(r.state))
        .map((r) => ({ name: r.menu_item_name, qty: r.qty, unit_price: r.menu_item_price }));
      if (order) updatedAtMs = order.updated_at;
    } else {
      items = request.items_snapshot.map((it) => ({
        name: it.name,
        qty: it.qty,
        unit_price: it.unit_price,
      }));
    }

    const progress = computeProgress({
      request_status: request.status as 'WAITING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED_BY_CUSTOMER',
      fulfillment_type,
      item_states: itemStates,
      max_progress_shown: request.max_progress_shown,
    });

    // Đơn điệu (M2.D-19): CHỈ ghi khi % TĂNG. Đây là endpoint công khai bị khách poll mỗi 5-10s —
    // ghi vô điều kiện là 1 lệnh UPDATE mỗi lần gọi, mỗi khách đang mở trang (T-09-49).
    if (progress.percent > request.max_progress_shown) {
      await this.requestRepo.update({ id: request.id }, { max_progress_shown: progress.percent });
    }

    // M2.D-62 — `subtotal` là tiền MÓN. KHÔNG cộng `ship_fee` vào đây.
    const subtotal = request.order_id
      ? items.reduce((sum, it) => sum + it.unit_price * it.qty, 0)
      : request.subtotal;

    // Đơn đã kết thúc (từ chối/khách huỷ/hoàn tất) thì không còn "dự kiến còn bao lâu" nữa.
    const finished = progress.stage === 'REJECTED' || progress.stage === 'COMPLETED';
    const isPickup = fulfillment_type === 'PICKUP';
    const eta_min = finished ? null : isPickup ? settings.eta_pickup_min : settings.eta_delivery_min;
    const eta_max = finished ? null : isPickup ? settings.eta_pickup_max : settings.eta_delivery_max;

    const shaped = {
      order_token: request.order_token,
      status: request.status as PublicOrderStatus['status'],
      fulfillment_type,
      items,
      subtotal,
      submitted_at_ms: request.submitted_at,
      store_phone: settings.store_phone,
      reject_reason: request.reject_reason,
      stage: progress.stage,
      // Khách tự huỷ và quán từ chối cùng cho ra `stage = 'REJECTED'`, nhưng câu chữ phải khác —
      // nói "quán đã từ chối" với đơn do chính khách huỷ là sai sự thật.
      stage_label:
        request.status === 'CANCELLED_BY_CUSTOMER'
          ? STAGE_LABEL_CANCELLED_BY_CUSTOMER
          : stageLabel(progress.stage, fulfillment_type),
      percent: progress.percent,
      cancelled_count: progress.cancelled_count,
      cancelled_note: progress.cancelled_note,
      eta_min,
      eta_max,
      updated_at_ms: updatedAtMs,
    };
    return PublicOrderStatus.strict().parse(shaped);
  }
}

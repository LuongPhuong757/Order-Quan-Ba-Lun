// Cài `SubmitDeps` thật lên `DataSource`/`EntityManager`, bọc `submit()` trong 1 transaction
// có gap lock `FOR UPDATE` (RESEARCH Pattern 3, threat T-08-50 HIGH). Toàn bộ quyết định +
// build dữ liệu nằm ở `submit-order.ts` (Task 1, test được bằng fake-repository) — file này
// CHỈ có nhiệm vụ nối dây DB thật, không tự phát minh lại logic guard/giá.
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { OnlineOrderSubmit, PublicOrderEdit } from '@order/schemas';
import {
  PublicOrderCancelResult,
  PublicOrderEditResult,
  PublicOrderHistory,
  PublicOrderStatus,
  computeShipFee,
  normalizeShipFeeTiers,
} from '@order/schemas';
import { SettingsService } from '../settings/settings.service.js';
import type { StoreSettingsMap } from '../settings/settings.defaults.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { PhoneBlacklist } from '../settings/entities/phone-blacklist.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { OnlineOrderRequest } from './entities/online-order-request.entity.js';
import { auditIpValue, hashIp, resolveIpHashSalt } from './ip-hash.js';
import { evaluateOrderingStatus } from './store-status.js';
import {
  EXCLUDED_ITEM_STATES,
  STAGE_LABEL_CANCELLED_BY_CUSTOMER,
  computeProgress,
  etaLine,
  stageLabel,
} from './order-progress.js';
import { submitOrder, type MenuItemLookup, type SubmitDeps } from './submit-order.js';
import { cancelOrderByCustomer } from './cancel-order.js';
import { editOrderByCustomer, type EditableRequestRow } from './edit-order.js';
import { buildHistoryEntry, type HistoryRequestRow } from './order-history.js';
import { normalizePhone } from './phone.js';
import { PublicOtpService } from './public-otp.service.js';
import { expBackoffMs, runWithRetry } from '../../common/run-with-retry.js';

/** Số lần thử cho 3 luồng GHI công khai (đặt / huỷ / sửa đơn).
 *
 * Vì sao 5 chứ không phải 2 như luồng nội bộ: gap lock `FOR UPDATE` trên `idx_oor_phone_status`
 * sinh deadlock theo cấp số nhân với số khách bấm cùng lúc. Đo trên production 2026-08-07:
 * 100 đơn đồng thời, KHÔNG retry → 90 đơn mất trắng (HTTP 500). Nhân viên trong quán nhiều lắm
 * 3-4 người nên 2 lần là đủ; khách thì có thể 100 người cùng một giây sau một bài Facebook. */
const PUBLIC_WRITE_MAX_ATTEMPTS = 5;

@Injectable()
export class PublicOrdersService {
  private readonly logger = new Logger(PublicOrdersService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(OnlineOrderRequest) private readonly requestRepo: Repository<OnlineOrderRequest>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(MenuItem) private readonly menuItemRepo: Repository<MenuItem>,
    private readonly settingsSvc: SettingsService,
    private readonly outbox: NotificationOutboxService,
    private readonly emitter: EventEmitter2,
    private readonly otpSvc: PublicOtpService,
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
   *
   * ⚠ 2026-08-07 — RETRY DEADLOCK (`runWithRetry` bọc ngoài, xem `PUBLIC_WRITE_MAX_ATTEMPTS`).
   * Đo tải trên production: 100 khách bấm đặt trong cùng một giây → **90 đơn mất trắng** vì
   * `QueryFailedError: Deadlock found`. Gốc rễ là gap lock ở `hasOpenOrderForPhoneLocked`: khi
   * SĐT chưa có đơn WAITING nào thì InnoDB không có row để khoá nên nó khoá cả KHOẢNG TRỐNG trên
   * `idx_oor_phone_status`; các khoảng trống của những SĐT khác nhau chồng lấn, hai transaction
   * khoá chéo là MySQL giết một cái.
   *
   * Cái lock đó KHÔNG được gỡ — nó là chốt chống T-08-50. Cách đúng chính là điều MySQL ghi
   * trong thông báo lỗi: *try restarting transaction*. Retry an toàn ở đây vì deadlock rollback
   * TOÀN BỘ transaction (đã kiểm chứng: 90 lỗi để lại 0 dòng rác) và `submitImpl` không có side
   * effect nào nằm ngoài transaction — không ghi audit, không gửi SMS, `order_token` sinh lại
   * mỗi lần thử. Emit SSE nằm sau `await` nên chỉ chạy khi đã commit thật.
   *
   * ⚠⚠ QUY TẮC 1 CONNECTION — đọc trước khi thêm bất cứ thứ gì vào transaction này.
   *
   * **Không một dòng code nào chạy bên trong `ds.transaction()` được phép xin connection thứ hai
   * từ pool.** Cụ thể: cấm gọi `this.<service>.<method>()` hay `this.<xxx>Repo` bên trong — chúng
   * dùng connection RIÊNG. Mọi truy vấn phải đi qua `mgr` được transaction trao cho.
   *
   * Vi phạm quy tắc này KHÔNG gây lỗi lúc vắng khách, và đó chính là chỗ nguy hiểm. Nó chỉ nổ khi
   * số request đồng thời chạm `connectionLimit` (50, `data-source.ts`): cả 50 connection bị 50
   * transaction đang mở giữ, mỗi transaction lại đứng chờ connection thứ 51 không bao giờ có →
   * **treo vĩnh viễn**, không phải chậm. MySQL nhìn thấy 50 phiên `Sleep` mà `innodb_trx` vẫn báo
   * 50 transaction sống; không có timeout nào cứu, phải restart process.
   *
   * Đo được đúng cảnh này trên production 2026-08-07: 100 đơn đồng thời → 100% timeout, 0 đơn vào
   * DB, 50 transaction treo cứng tới khi `docker restart`. Thủ phạm là `readSettings` gọi
   * `settingsSvc.readAll()` từ trong transaction. Nay settings đọc TRƯỚC rồi truyền vào
   * `makeDeps`, và 2 dep phiên OTP nhận `mgr` (OD-21).
   */
  async submit(
    input: OnlineOrderSubmit,
    ctx: { ip: string; userAgent: string; nowMs: number },
  ): Promise<{ order_token: string; distance_km: string | null }> {
    return runWithRetry(() => this.submitImpl(input, ctx), PUBLIC_WRITE_MAX_ATTEMPTS, {
      backoffMs: expBackoffMs,
      onRetry: (a, m) =>
        this.logger.warn(
          `Transient DB error khi khách đặt đơn (attempt ${a}/${PUBLIC_WRITE_MAX_ATTEMPTS}): ${m} — retry`,
        ),
    });
  }

  private async submitImpl(
    input: OnlineOrderSubmit,
    ctx: { ip: string; userAgent: string; nowMs: number },
  ): Promise<{ order_token: string; distance_km: string | null }> {
    // ĐỌC SETTINGS TRƯỚC KHI MỞ TRANSACTION — bắt buộc, xem "quy tắc 1 connection" ở docblock
    // `submit()`. `cancelByToken`/`editByToken` vốn đã làm đúng như vậy.
    const settings = await this.settingsSvc.readAll();

    const { result, requestId } = await this.ds.transaction(async (mgr) => {
      const txResult = await submitOrder(this.makeDeps(mgr, settings), input, ctx);
      // `submitOrder` (module thuần phase 8) cố ý KHÔNG trả id — không đổi chữ ký của nó vì plan
      // 09-12 còn phải sửa file đó, tránh đụng độ. Đọc lại id trong CÙNG transaction.
      const rows: Array<{ id: string }> = await mgr.query(
        'SELECT id FROM online_order_requests WHERE order_token = ?',
        [txResult.order_token],
      );
      const id = rows[0]?.id;
      if (id) {
        // `settings` truyền vào — outbox mà tự gọi `readAll()` ở đây là xin connection thứ hai
        // giữa transaction (xem "QUY TẮC 1 CONNECTION" ở docblock trên).
        await this.outbox.enqueueForNewRequest(id, ctx.nowMs, mgr, settings);
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
  async cancelByToken(token: string, ctx?: { ip: string }): Promise<PublicOrderCancelResult> {
    return runWithRetry(() => this.cancelByTokenImpl(token, ctx), PUBLIC_WRITE_MAX_ATTEMPTS, {
      backoffMs: expBackoffMs,
      onRetry: (a, m) =>
        this.logger.warn(
          `Transient DB error khi khách huỷ đơn (attempt ${a}/${PUBLIC_WRITE_MAX_ATTEMPTS}): ${m} — retry`,
        ),
    });
  }

  private async cancelByTokenImpl(
    token: string,
    ctx?: { ip: string },
  ): Promise<PublicOrderCancelResult> {
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
      // CHỈ log lần huỷ THẬT: lần gọi lại trên đơn đã huỷ (idempotent) không phải một hành động
      // mới, ghi nữa là làm loãng đúng dòng log mà chủ quán cần đọc.
      this.auditPublic(ctx?.ip ?? '', {
        action_kind: 'public.order_cancelled',
        target_id: outcome.request_id,
      });
    }

    return PublicOrderCancelResult.strict().parse({
      order_token: outcome.order_token,
      status: outcome.status,
    });
  }

  /**
   * `PATCH /api/public/orders/:token` — khách tự sửa món/ghi chú khi đơn còn `WAITING`
   * (M2.D-44 nửa sửa, chốt 2026-08-06).
   *
   * Quyết định + dựng snapshot nằm ở `edit-order.ts` (module thuần, test bằng fake-deps); hàm này
   * CHỈ nối dây DB thật, đúng khuôn `cancelByToken`.
   *
   * 3 thứ phải giữ nguyên thứ tự:
   *
   * 1. **Lock + save trong CÙNG transaction** — đó là toàn bộ cách giải race với
   *    `AdminOnlineOrdersService.confirm()`. Xem điểm 1 đầu `edit-order.ts`.
   * 2. **SSE emit SAU commit** — emit rồi rollback là báo cho mọi tab admin về một bản sửa không
   *    tồn tại (cùng lý do T-09-51 ở `submit()`).
   * 3. **KHÔNG đụng hàng thông báo.** Đơn vẫn `WAITING`, lịch SMS leo thang L1/L2/L3 (REQ-N) vẫn
   *    đúng mục đích: nhắc quán duyệt một đơn đang chờ. Huỷ rồi xếp lại là đẩy lùi mốc leo thang
   *    mỗi lần khách bấm sửa — khách sửa 3 lần là quán không bao giờ nhận được SMS L2.
   */
  async editByToken(
    token: string,
    input: PublicOrderEdit,
    ctx?: { ip: string },
  ): Promise<PublicOrderEditResult> {
    return runWithRetry(() => this.editByTokenImpl(token, input, ctx), PUBLIC_WRITE_MAX_ATTEMPTS, {
      backoffMs: expBackoffMs,
      onRetry: (a, m) =>
        this.logger.warn(
          `Transient DB error khi khách sửa đơn (attempt ${a}/${PUBLIC_WRITE_MAX_ATTEMPTS}): ${m} — retry`,
        ),
    });
  }

  private async editByTokenImpl(
    token: string,
    input: PublicOrderEdit,
    ctx?: { ip: string },
  ): Promise<PublicOrderEditResult> {
    const settings = await this.settingsSvc.readAll();

    const outcome = await this.ds.transaction(async (mgr) =>
      editOrderByCustomer(
        {
          lockRequestByToken: async (t) => {
            // `SELECT ... FOR UPDATE` bằng query thô (không `findOne`) vì chỉ câu này mới giữ
            // được row lock — cùng hàng mà `lockWaitingRequest()` phía admin khoá.
            const rows: Array<{
              id: string;
              status: string;
              fulfillment_type: string;
              items_snapshot: unknown;
              customer_note: string | null;
              customer_address: string | null;
              customer_ward_code: string | null;
              customer_lat: string | null;
              customer_lng: string | null;
              customer_map_link: string | null;
              distance_km: string | null;
            }> = await mgr.query(
              `SELECT id, status, fulfillment_type, items_snapshot, customer_note,
                      customer_address, customer_ward_code, customer_lat, customer_lng,
                      customer_map_link, distance_km
                 FROM online_order_requests WHERE order_token = ? FOR UPDATE`,
              [t],
            );
            const row = rows[0];
            if (!row) return null;
            // mysql2 trả cột `json` đã parse sẵn thành object; bản cũ hơn (và một số cấu hình)
            // trả chuỗi. Không đoán — xử cả hai, vì đoán sai ở đây là `.map is not a function`
            // ngay giữa một transaction đang giữ lock.
            const snapshot =
              typeof row.items_snapshot === 'string'
                ? JSON.parse(row.items_snapshot)
                : row.items_snapshot;
            return { ...row, items_snapshot: snapshot ?? [] } as EditableRequestRow;
          },

          // Dùng lại ĐÚNG dep của luồng submit — món gọi thêm phải qua cùng bộ lọc "đang bán +
          // còn hàng + không ẩn online (kể cả ẩn cả nhóm)" như lúc đặt đơn lần đầu.
          findMenuItemsByIds: this.makeDeps(mgr, settings).findMenuItemsByIds,

          saveEdit: async (id, patch) => {
            // Ghi cả 6 cột vị trí trong MỘT lệnh: địa chỉ, mã xã, toạ độ và km phải cùng đổi hoặc
            // cùng giữ. `edit-order.ts` đã lo tính nhất quán, ở đây chỉ việc ghi đúng thứ nó đưa ra
            // — đừng thêm nhánh `if` nào tại đây, đó là cách hai chỗ bắt đầu nghĩ khác nhau.
            await mgr.query(
              `UPDATE online_order_requests
                  SET items_snapshot = ?, subtotal = ?, customer_note = ?,
                      customer_address = ?, customer_ward_code = ?, customer_lat = ?,
                      customer_lng = ?, customer_map_link = ?, distance_km = ?
                WHERE id = ?`,
              [
                JSON.stringify(patch.items_snapshot),
                patch.subtotal,
                patch.customer_note,
                patch.customer_address,
                patch.customer_ward_code,
                patch.customer_lat,
                patch.customer_lng,
                patch.customer_map_link,
                patch.distance_km,
                id,
              ],
            );
          },

          storePhone: settings.store_phone,
          storeGeo: {
            store_lat: settings.store_lat,
            store_lng: settings.store_lng,
            distance_factor: settings.distance_factor,
          },
        },
        token,
        input,
      ),
    );

    try {
      this.emitter.emit('online_order.reviewed', {
        request_id: outcome.request_id,
        at_ms: Date.now(),
      });
    } catch (err) {
      this.logger.warn(`Emit event khách sửa đơn thất bại (bản sửa vẫn đã lưu): ${(err as Error).message}`);
    }

    // Task.md: "mọi hành động ở phần online đều cần log". Ghi CẢ bản trước và bản sau — câu hỏi
    // thật của chủ quán không phải "đơn giờ có gì" (nhìn đơn là thấy) mà là "khách đã đổi gì so
    // với lúc gọi điện chốt miệng".
    this.auditPublic(ctx?.ip ?? '', {
      action_kind: 'public.order_edited',
      target_id: outcome.request_id,
      before: {
        items: outcome.before.items_snapshot,
        customer_note: outcome.before.customer_note,
        customer_address: outcome.before.customer_address,
      },
      after: {
        items: outcome.items_snapshot,
        customer_note: outcome.customer_note,
        customer_address: outcome.customer_address,
        subtotal: outcome.subtotal,
      },
    });

    return PublicOrderEditResult.strict().parse({
      order_token: token,
      items: outcome.items_snapshot.map((it) => ({
        menu_item_id: it.menu_item_id,
        name: it.name,
        qty: it.qty,
        unit_price: it.unit_price,
        note: it.note ?? null,
      })),
      subtotal: outcome.subtotal,
    });
  }

  /** Ghi audit cho hành động của KHÁCH (không đăng nhập) — khuôn `PublicOtpService.auditFn`:
   * actor null, IP đi dạng HASH (M2.D-56 — luồng public không bao giờ lưu IP thô).
   *
   * Fire-and-forget: một lần ghi log hỏng KHÔNG được biến thao tác đã commit thành lỗi 500. */
  private auditPublic(
    ip: string,
    ev: { action_kind: string; target_id: string; before?: unknown; after?: unknown },
  ): void {
    try {
      this.emitter.emit('audit.write', {
        actor_id: null,
        actor_name: null,
        // Dùng `auditIpValue` — KHÔNG tự ghép `hashed:` + hash đầy đủ ở đây: chuỗi đó dài 71 ký
        // tự, vượt `varchar(45)` của cột và làm cả dòng log rơi im lặng (xem docblock hàm đó).
        ip: auditIpValue(ip),
        ts_ms: Date.now(),
        action_kind: ev.action_kind,
        target_kind: 'online_order_request',
        target_id: ev.target_id,
        before_json: ev.before ?? null,
        after_json: ev.after ?? null,
      });
    } catch (err) {
      this.logger.warn(`Ghi audit ${ev.action_kind} thất bại: ${(err as Error).message}`);
    }
  }

  /** `settings` được truyền VÀO chứ không đọc trong này — `makeDeps` chỉ được gọi bên trong
   * `ds.transaction()`, và đọc settings ở đó là xin connection thứ hai giữa lúc đang giữ
   * transaction. Xem "quy tắc 1 connection" ở docblock `submit()`. */
  private makeDeps(mgr: EntityManager, settings: StoreSettingsMap): SubmitDeps {
    return {
      // 2026-08-16 — `getOrderingStatus` QUAY LẠI `SubmitDeps` (đảo ngược D-11/OD-13): quán đóng
      // thì submit bị chặn. Tính bằng pure function từ `settings` ĐÃ được truyền vào — không xin
      // connection thứ hai giữa transaction (quy tắc 1 connection, xem docblock `makeDeps`),
      // không round-trip DB thêm. KHÔNG gọi `SettingsService.getOrderingStatus()` ở đây vì nó
      // tự đọc DB.
      getOrderingStatus: async (nowMs) =>
        evaluateOrderingStatus(
          {
            online_ordering_enabled: settings.online_ordering_enabled,
            online_ordering_off_mode: settings.online_ordering_off_mode,
            online_ordering_off_reason: settings.online_ordering_off_reason,
            online_ordering_off_until_ms: settings.online_ordering_off_until_ms,
            open_hours: settings.open_hours,
          },
          nowMs,
        ),
      readSettings: async () => {
        const s = settings;
        return {
          store_phone: s.store_phone,
          store_lat: s.store_lat,
          store_lng: s.store_lng,
          distance_factor: s.distance_factor,
          max_delivery_km: s.max_delivery_km,
          online_ordering_off_reason: s.online_ordering_off_reason,
          pickup_enabled: s.pickup_enabled,
          delivery_enabled: s.delivery_enabled,
          otp_login_enabled: s.otp_login_enabled,
        };
      },

      // OTP đăng nhập (2026-08-04) — uỷ quyền cho PublicOtpService (đường đọc/ghi duy nhất
      // của `customer_sessions`).
      //
      // ⚠ 2026-08-07 — ĐẢO NGƯỢC chủ ý ban đầu "cố ý chạy NGOÀI transaction" (xem OD-21).
      // Chạy ngoài nghĩa là xin connection THỨ HAI giữa lúc đang giữ transaction, và đó là
      // nguyên nhân treo cứng toàn bộ luồng đặt đơn khi đông khách. Truyền `mgr` vào để dùng
      // đúng connection của transaction.
      //
      // Hệ quả đã cân nhắc: đơn fail thì lần gia hạn trượt này rollback theo. Khách KHÔNG bị
      // đăng xuất — phiên vẫn còn nguyên với `expires_at` cũ, chỉ là không được đẩy lùi thêm.
      // Trên TTL 90 ngày thì một lần không gia hạn là không đáng kể.
      findSessionPhone: (token, nowMs) => this.otpSvc.findSessionPhone(token, nowMs, mgr),
      touchSession: (token, nowMs) => this.otpSvc.touchSession(token, nowMs, mgr),

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
      //
      // Chính câu này sinh ra deadlock khi nhiều khách đặt cùng lúc (đo 2026-08-07: 100 đơn
      // đồng thời → 90% chết). Đó là CÁI GIÁ ĐÃ BIẾT của gap lock, không phải lỗi cần sửa ở
      // đây — `submit()` bọc `runWithRetry` để nuốt nó. Đừng "tối ưu" câu này thành khoá nhẹ
      // hơn: nhẹ hơn là mở lại T-08-50.
      hasOpenOrderForPhoneLocked: async (phone) => {
        const rows: Array<{ id: string }> = await mgr.query(
          `SELECT id FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`,
          [phone],
        );
        return rows.length > 0;
      },

      findMenuItemsByIds: async (ids): Promise<MenuItemLookup[]> => {
        if (ids.length === 0) return [];
        const items = await mgr.getRepository(MenuItem).find({
          where: { id: In(ids) },
          select: ['id', 'code', 'name', 'price', 'unit', 'group', 'is_active', 'is_out_of_stock', 'is_online_hidden'],
        });
        if (items.length === 0) return [];
        // `is_online_hidden` trả về submit-order là cờ HIỆU LỰC: món ẩn lẻ HOẶC nằm trong
        // nhóm bị ẩn cả nhóm (2026-08-04) — submit-order không cần biết khái niệm nhóm.
        const groupCodes = Array.from(new Set(items.map((m) => m.group)));
        const hiddenGroups = await mgr.getRepository(MenuGroup).find({
          where: { code: In(groupCodes), is_online_hidden: true },
          select: ['code'],
        });
        const hiddenGroupCodes = new Set(hiddenGroups.map((g) => g.code));
        return items.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          price: m.price,
          unit: m.unit,
          is_active: m.is_active,
          is_out_of_stock: m.is_out_of_stock,
          is_online_hidden: m.is_online_hidden || hiddenGroupCodes.has(m.group),
        }));
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
   *   Mỗi dòng `items` được map tay đúng 4 field (`name`/`qty`/`unit_price`/`image`) — KHÔNG
   *   spread entity `OrderItem`, vì spread là cách `state` lọt ra ngoài mà typecheck vẫn xanh.
   *   `image` là ảnh MENU tra live theo `menu_item_id`, không phải dữ liệu vận hành — không đụng
   *   tới G-1.
   * - **D-09:** hàm này BỊ CẤM đọc cột ghi chú nội bộ của admin. Nội dung khách được đọc chỉ là
   *   `reject_reason` (câu soạn sẵn). Đừng thêm cột đó vào payload dù "để debug".
   * - **M2.D-47:** sau khi duyệt, `items` + `subtotal` lấy từ `order_items` THẬT, không phải
   *   `items_snapshot` — admin sửa món ở bàn thì khách phải thấy danh sách và tổng tiền mới.
   */
  /** Ảnh món cho trang theo dõi đơn (2026-08-04) — tra live từ `menu_items` theo id, 1 query
   * cho cả đơn. Món đã xoá khỏi menu (id không còn) hoặc chưa có ảnh thì vắng mặt trong map →
   * caller tự về null, FE vẽ placeholder. Chỉ SELECT 2 cột — đừng kéo cả entity vào đây rồi
   * lỡ tay spread nó ra response (bài học G-1). */
  private async findImagesByMenuItemIds(
    ids: Array<string | null>,
  ): Promise<Map<string, string>> {
    const wanted = Array.from(new Set(ids.filter((id): id is string => id !== null)));
    if (wanted.length === 0) return new Map();
    const rows = await this.menuItemRepo.find({
      where: { id: In(wanted) },
      select: ['id', 'image_url'],
    });
    return new Map(
      rows.filter((r) => r.image_url !== null).map((r) => [r.id, r.image_url as string]),
    );
  }

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
    // 2 mốc chặng giao hàng (2026-08-04). Chỉ tồn tại khi đã có Order thật; đơn còn WAITING thì
    // luôn null và `computeProgress` cũng không xét tới chúng.
    let shippedAtMs: number | null = null;
    let receivedAtMs: number | null = null;
    // M2.D-62 — phí ship sống ở `orders.ship_fee`, admin nhập lúc duyệt. Đơn chưa duyệt thì chưa
    // có Order nào nên luôn 0; đó là sự thật chứ không phải giá trị mặc định tạm.
    let shipFee = 0;

    if (request.order_id) {
      const order = await this.orderRepo.findOne({ where: { id: request.order_id } });
      const rows = await this.itemRepo.find({ where: { order_id: request.order_id } });
      // Dòng ghi chú (`is_note`) là lời nhắn cho bếp ("ít cay", "lấy thêm bát"), không phải món
      // khách đặt → không tính vào %, không hiện trong danh sách khách xem.
      const real = rows.filter((r) => !r.is_note);
      itemStates = real.map((r) => r.state);
      const visible = real.filter(
        (r) => !(EXCLUDED_ITEM_STATES as readonly string[]).includes(r.state),
      );
      const imageByMenuItemId = await this.findImagesByMenuItemIds(
        visible.map((r) => r.menu_item_id),
      );
      items = visible.map((r) => ({
        // Món thêm tay ở bàn không có `menu_item_id` → null. Đơn ở nhánh này đã được duyệt nên
        // khách không sửa được nữa, FE chỉ dùng field này cho đơn còn WAITING (nhánh dưới).
        menu_item_id: r.menu_item_id ?? null,
        name: r.menu_item_name,
        qty: r.qty,
        unit_price: r.menu_item_price,
        image: (r.menu_item_id && imageByMenuItemId.get(r.menu_item_id)) || null,
        note: r.note ?? null,
      }));
      if (order) {
        updatedAtMs = order.updated_at;
        shippedAtMs = order.shipped_at;
        receivedAtMs = order.received_at;
        shipFee = order.ship_fee ?? 0;
      }
    } else {
      const imageByMenuItemId = await this.findImagesByMenuItemIds(
        request.items_snapshot.map((it) => it.menu_item_id),
      );
      items = request.items_snapshot.map((it) => ({
        menu_item_id: it.menu_item_id,
        name: it.name,
        qty: it.qty,
        unit_price: it.unit_price,
        image: imageByMenuItemId.get(it.menu_item_id) ?? null,
        // `?? null`: `items_snapshot` là JSON — đơn cũ lưu trước khi có ghi chú từng món
        // không có khoá `note`, đọc ra là `undefined` và `.strict().parse` sẽ throw.
        note: it.note ?? null,
      }));
    }

    const progress = computeProgress({
      request_status: request.status as 'WAITING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED_BY_CUSTOMER',
      fulfillment_type,
      item_states: itemStates,
      max_progress_shown: request.max_progress_shown,
      shipped_at: shippedAtMs,
      received_at: receivedAtMs,
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

    // Phí ship TẠM TÍNH cho đơn CHƯA duyệt (2026-08-07). Tính lại tại đây thay vì lưu lúc submit:
    // khách sửa đơn (`PATCH`) làm đổi cả `subtotal` lẫn `distance_km`, và một con số đóng băng từ
    // lúc đặt sẽ lệch với đúng thứ khách vừa nhìn thấy ở giỏ hàng.
    //
    // Đơn ĐÃ duyệt (`request.order_id`) trả `null`: `ship_fee` khi đó là số CHỐT, kể cả khi bằng 0
    // (quán miễn phí). Trả kèm số tạm tính ở đó là bày ra hai con số mâu thuẫn cho cùng một khoản.
    const shipFeeEstimated =
      request.order_id || fulfillment_type !== 'DELIVERY'
        ? null
        : computeShipFee({
            distanceKm: request.distance_km === null ? null : Number(request.distance_km),
            subtotal,
            tiers: normalizeShipFeeTiers(settings.ship_fee_tiers),
          }).fee;

    // Dòng phụ dưới nhãn mốc. Quyết định "mốc này nói gì" nằm TRỌN ở `etaLine()` cùng nhà với
    // `stageLabel()` — trước 2026-08-06 chỗ này tự chọn khi nào tắt ETA bằng một danh sách `noEta`
    // rời rạc, và FE tự ghép câu, nên không ai đọc được toàn cảnh "6 mốc hiện gì".
    const isPickup = fulfillment_type === 'PICKUP';
    const eta_text = etaLine(
      progress.stage,
      fulfillment_type,
      isPickup ? settings.eta_pickup_min : settings.eta_delivery_min,
      isPickup ? settings.eta_pickup_max : settings.eta_delivery_max,
    );

    const shaped = {
      order_token: request.order_token,
      status: request.status as PublicOrderStatus['status'],
      fulfillment_type,
      items,
      subtotal,
      ship_fee: shipFee,
      ship_fee_estimated: shipFeeEstimated,
      customer_note: request.customer_note,
      customer_address: request.customer_address,
      // `?? null` chứ không đọc thẳng: `PublicOrderStatus` là `.strict()`, nên một hàng thiếu cột
      // này sẽ làm parse THROW và khách mất luôn màn theo dõi đơn. Hàng thiếu cột là chuyện có
      // thật trong khoảnh khắc code mới chạy trước khi `synchronize` kịp thêm cột. Đổi một tiện
      // ích (lọc đơn theo xã) lấy việc khách không xem được đơn là đổi sai chiều.
      customer_ward_code: request.customer_ward_code ?? null,
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
      eta_text,
      updated_at_ms: updatedAtMs,
    };
    return PublicOrderStatus.strict().parse(shaped);
  }

  /**
   * `POST /api/public/orders/lookup` — lịch sử đơn theo SĐT (2026-08-04). Quyết định thuần
   * nằm ở `order-history.ts` (khuôn submit-order/cancel-order); hàm này chỉ query + gom nhóm.
   *
   * - Chuẩn hoá SĐT bằng ĐÚNG `normalizePhone` của luồng submit — cột `customer_phone` chỉ
   *   chứa dạng chuẩn hoá, so khớp bằng dạng khác là "không tìm thấy" giả.
   * - Đọc theo index `idx_oor_phone_submitted`, mới nhất trước. Toàn bộ lịch sử, không phân
   *   trang (chốt 2026-08-04).
   * - `order_items`/`orders` đọc GOM 1 lần bằng `In(...)` rồi chia nhóm trong RAM — N đơn đã
   *   duyệt mà query từng đơn là N+1 trên một endpoint public bị throttle lỏng hơn nhiều so
   *   với chi phí nó gây ra.
   * - KHÔNG ghi `max_progress_shown` ở đây (khác `getByToken`) — trang danh sách không hiện %.
   *
   * OTP đăng nhập (2026-08-04): công tắc `otp_login_enabled` bật thì SĐT trần KHÔNG còn là
   * credential — chỉ nhận `session_token`, SĐT tra cứu lấy TỪ PHIÊN (vá lỗ "ai biết SĐT là
   * xem được lịch sử người khác"). Công tắc tắt thì giữ nguyên ranh giới cũ đã chốt.
   */
  async lookupByPhone(input: { phone?: string; session_token?: string }): Promise<PublicOrderHistory> {
    const settings = await this.settingsSvc.readAll();
    let phone: string | null;

    if (settings.otp_login_enabled) {
      const nowMs = Date.now();
      const sessionPhone = input.session_token
        ? await this.otpSvc.findSessionPhone(input.session_token, nowMs)
        : null;
      if (sessionPhone === null) {
        throw new UnauthorizedException({
          code: 'OTP_SESSION_REQUIRED',
          message: 'Vui lòng xác minh số điện thoại bằng mã OTP để xem lịch sử đơn.',
        });
      }
      await this.otpSvc.touchSession(input.session_token!, nowMs);
      phone = sessionPhone;
    } else {
      phone = normalizePhone(input.phone ?? '');
      if (phone === null) {
        // Cùng code + câu chữ với nhánh SĐT hỏng của submit-order.ts — FE đã biết xử lý nó.
        throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Số điện thoại không hợp lệ' });
      }
    }

    const requests = await this.requestRepo.find({
      where: { customer_phone: phone },
      order: { submitted_at: 'DESC' },
    });

    const orderIds = requests
      .map((r) => r.order_id)
      .filter((id): id is string => id !== null);
    const [orders, orderItems] =
      orderIds.length > 0
        ? await Promise.all([
            this.orderRepo.find({ where: { id: In(orderIds) } }),
            this.itemRepo.find({ where: { order_id: In(orderIds) } }),
          ])
        : [[], []];

    const orderById = new Map(orders.map((o) => [o.id, o]));
    const itemsByOrderId = new Map<string, typeof orderItems>();
    for (const row of orderItems) {
      const bucket = itemsByOrderId.get(row.order_id);
      if (bucket) bucket.push(row);
      else itemsByOrderId.set(row.order_id, [row]);
    }

    const entries = requests.map((request) => {
      const order = request.order_id ? (orderById.get(request.order_id) ?? null) : null;
      return buildHistoryEntry(
        {
          order_token: request.order_token,
          status: request.status as HistoryRequestRow['status'],
          fulfillment_type: request.fulfillment_type as HistoryRequestRow['fulfillment_type'],
          submitted_at: request.submitted_at,
          max_progress_shown: request.max_progress_shown,
          subtotal: request.subtotal,
          items_snapshot: request.items_snapshot,
          order_id: request.order_id,
        },
        order ? { shipped_at: order.shipped_at, received_at: order.received_at } : null,
        request.order_id ? (itemsByOrderId.get(request.order_id) ?? []) : [],
      );
    });

    // `.strict()` là chốt an toàn cuối như mọi payload public khác — field lạ THROW thay vì leak.
    return PublicOrderHistory.strict().parse({ phone, orders: entries });
  }
}

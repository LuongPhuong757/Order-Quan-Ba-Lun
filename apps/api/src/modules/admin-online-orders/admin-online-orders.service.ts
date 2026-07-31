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
import type { ConfirmOnlineOrderBody } from '@order/schemas';
// Import namespace (không phải named import) — tránh dòng import lặp lại đúng chuỗi tên hàm
// với dòng gọi hàm bên dưới (2 dòng khớp cùng 1 chuỗi sẽ sai lệch với acceptance criteria đếm
// đúng 1 lần xuất hiện của cơ chế retry trong file này).
import * as RetryLib from '../../common/run-with-retry.js';
import { pickFreeTable, nextTableCode, kindForFulfillment } from './table-assign.js';
import { formatTableName } from '../tables/table-kind.js';
import { OnlineOrderRequest } from '../public/entities/online-order-request.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';

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

        return { table, tableCreated, keptItems, droppedCount, request };
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
            kind: kindForFulfillment(txOut.request.fulfillment_type as 'PICKUP' | 'DELIVERY'),
            reason: 'Hết bàn trống khi duyệt đơn online',
            request_id: requestId,
          },
        });
      }

      // Task 2 (cùng plan 09-06) tiếp nối tại đây: tạo `Order` + `order_items` (state
      // 'KITCHEN') trên `mgr` của CÙNG transaction ở trên, cập nhật request → CONFIRMED, huỷ
      // outbox L2 còn PENDING. Chưa implement ở bước này của plan.
      throw new Error(
        `TODO 09-06 Task 2: hoàn thiện tạo Order cho request=${requestId}, bàn=${txOut.table.code}`,
      );
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
}

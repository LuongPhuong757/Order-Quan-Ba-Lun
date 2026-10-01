import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import type { ApproveResult, PendingResult } from '@order/schemas';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { TableOrderRequest } from '../public/entities/table-order-request.entity.js';
import { TableOrderRequestItem } from '../public/entities/table-order-request-item.entity.js';
import { TableCall } from '../public/entities/table-call.entity.js';
import { Order } from './entities/order.entity.js';
import { OrdersService, type OrderCreator } from './orders.service.js';
import { splitAvailable } from './split-available-items.js';

/**
 * M7 — phía nhân viên: lượt khách gửi đang chờ duyệt + lượt gọi chuông.
 *
 * Nằm trong `OrdersModule` để dùng thẳng `OrdersService.addItemsBulk` thay vì viết lại logic
 * thêm món — hàm đó đã lo validate menu, dời mốc giờ-vào-bàn, `first_kitchen_at` (và từ M7 là
 * cả sinh mã bàn), nhật ký bàn `items_added`.
 */
@Injectable()
export class TableRequestsService {
  constructor(
    private readonly ds: DataSource,
    private readonly ordersSvc: OrdersService,
    @InjectRepository(TableOrderRequest) private readonly requests: Repository<TableOrderRequest>,
    @InjectRepository(TableOrderRequestItem) private readonly items: Repository<TableOrderRequestItem>,
    @InjectRepository(TableCall) private readonly calls: Repository<TableCall>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(MenuItem) private readonly menu: Repository<MenuItem>,
    @InjectRepository(RestaurantTable) private readonly tables: Repository<RestaurantTable>,
  ) {}

  /** Màn bếp gọi trong CHÍNH vòng poll 2 giây đã có — không thêm timer, không thêm kênh. */
  async pending(): Promise<PendingResult> {
    const reqs = await this.requests.find({ where: { status: 'WAITING' }, order: { created_at: 'ASC' } });
    const calls = await this.calls.find({ where: { acked_at: IsNull() }, order: { created_at: 'ASC' } });

    const tables = await this.tables.find();
    const nameByCode = new Map(tables.map((t) => [t.code, t.name]));

    if (reqs.length === 0) {
      return {
        requests: [],
        calls: calls.map((c) => ({
          id: c.id,
          table_code: c.table_code,
          table_name: nameByCode.get(c.table_code) ?? c.table_code,
          kind: c.kind as 'STAFF' | 'BILL',
          created_at: c.created_at,
        })),
      };
    }

    const lines = await this.items.find({ where: { request_id: In(reqs.map((r) => r.id)) } });
    const menuItems = await this.menu.find({ where: { id: In(lines.map((l) => l.menu_item_id)) } });
    const byId = new Map(menuItems.map((m) => [m.id, m]));

    return {
      requests: reqs.map((r) => {
        const mine = lines.filter((l) => l.request_id === r.id);
        const items = mine.map((l) => {
          const m = byId.get(l.menu_item_id);
          return {
            menu_item_id: l.menu_item_id,
            // Tên từ menu nếu còn tra được; không thì dùng snapshot lúc khách gọi.
            name: m?.name ?? l.menu_item_name,
            qty: l.qty,
            note: l.note,
            // Giá HIỆN TẠI (M7.D-11) — không phải giá lúc khách gửi.
            price_now: m?.price ?? 0,
            out_of_stock: !m || !m.is_active || m.is_out_of_stock,
          };
        });
        return {
          id: r.id,
          order_id: r.order_id,
          table_code: r.table_code,
          table_name: nameByCode.get(r.table_code) ?? r.table_code,
          created_at: r.created_at,
          items,
          // KHÔNG cộng dòng hết hàng — nhân viên phải thấy đúng số tiền sẽ vào bill.
          total_now: items.filter((i) => !i.out_of_stock).reduce((t, i) => t + i.price_now * i.qty, 0),
        };
      }),
      calls: calls.map((c) => ({
        id: c.id,
        table_code: c.table_code,
        table_name: nameByCode.get(c.table_code) ?? c.table_code,
        kind: c.kind as 'STAFF' | 'BILL',
        created_at: c.created_at,
      })),
    };
  }

  async approve(requestId: string, staff: OrderCreator): Promise<ApproveResult> {
    const req = await this.requests.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Không thấy lượt gọi này.' });

    const order = await this.orders.findOne({ where: { id: req.order_id } });
    if (!order || order.closed_at !== null) {
      throw new ConflictException({
        code: 'ORDER_CLOSED',
        message: 'Bàn đã thanh toán — lượt này không vào bill được.',
      });
    }

    const lines = await this.items.find({ where: { request_id: req.id } });
    const menuItems = await this.menu.find({ where: { id: In(lines.map((l) => l.menu_item_id)) } });
    const byId = new Map(menuItems.map((m) => [m.id, m]));

    // Phải tách TRƯỚC: `addItemsBulk` fail-fast, một món hết là hỏng cả lượt.
    const { ok, skipped } = splitAvailable(
      lines.map((l) => ({
        menu_item_id: l.menu_item_id,
        menu_item_name: l.menu_item_name,
        qty: l.qty,
        note: l.note,
      })),
      byId,
    );

    // Chống đua điểm 4 — hai nhân viên cùng bấm duyệt. UPDATE có điều kiện rồi kiểm
    // `affectedRows`, TUYỆT ĐỐI không SELECT rồi UPDATE.
    const claimed = await this.requests
      .createQueryBuilder()
      .update(TableOrderRequest)
      .set({
        status: ok.length > 0 ? 'APPROVED' : 'REJECTED',
        decided_at: Date.now(),
        decided_by_user_id: staff.id ?? null,
        decided_by_full_name: staff.full_name ?? null,
        decided_reason: ok.length > 0 ? null : 'Mọi món đều đã hết',
      })
      .where('id = :id AND status = :st', { id: req.id, st: 'WAITING' })
      .execute();

    if (!claimed.affected) {
      throw new ConflictException({
        code: 'ALREADY_DECIDED',
        message: 'Lượt này vừa được người khác xử lý rồi.',
      });
    }

    // `ok` rỗng thì KHÔNG gọi `addItemsBulk` — nó ném 'Giỏ hàng trống' với mảng rỗng, biến một
    // ca nghiệp vụ bình thường (cả lượt đều hết món) thành lỗi 500.
    if (ok.length === 0) {
      return { added: 0, skipped: skipped.map((s) => ({ name: s.menu_item_name, reason: s.reason })), order_id: order.id };
    }

    // M7.D-10 — duyệt là xuống bếp LUÔN, không phải hai bước.
    const res = await this.ordersSvc.addItemsBulk(
      order.id,
      ok.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty, note: l.note })),
      true,
      staff,
    );

    return {
      added: res.count,
      skipped: skipped.map((s) => ({ name: s.menu_item_name, reason: s.reason })),
      order_id: order.id,
    };
  }

  async reject(requestId: string, staff: OrderCreator, reason?: string): Promise<{ status: string }> {
    // Cùng luật chống đua như approve.
    const r = await this.requests
      .createQueryBuilder()
      .update(TableOrderRequest)
      .set({
        status: 'REJECTED',
        decided_at: Date.now(),
        decided_by_user_id: staff.id ?? null,
        decided_by_full_name: staff.full_name ?? null,
        decided_reason: reason ?? null,
      })
      .where('id = :id AND status = :st', { id: requestId, st: 'WAITING' })
      .execute();
    if (!r.affected) {
      throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'Lượt này vừa được người khác xử lý rồi.' });
    }
    return { status: 'REJECTED' };
  }

  async ackCall(callId: string, staff: OrderCreator): Promise<{ acked_at: number }> {
    const now = Date.now();
    const r = await this.calls
      .createQueryBuilder()
      .update(TableCall)
      .set({ acked_at: now, acked_by_user_id: staff.id ?? null, acked_by_full_name: staff.full_name ?? null })
      .where('id = :id AND acked_at IS NULL', { id: callId })
      .execute();
    if (!r.affected) {
      throw new ConflictException({ code: 'ALREADY_ACKED', message: 'Người khác đã nghe rồi.' });
    }
    return { acked_at: now };
  }
}

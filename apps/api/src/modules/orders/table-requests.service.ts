import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { pickAutoItem, type ApproveResult, type PendingResult } from '@order/schemas';
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

  /**
   * Khăn lạnh quán tự thêm — M7, cùng luật với màn gọi món của nhân viên (`@order/schemas`).
   *
   * Luồng của nhân viên bỏ sẵn khăn vào GIỎ để còn sửa trước khi báo bếp. Luồng QR không có
   * giỏ nào cả, chỉ có một nút "Duyệt cả lượt", nên khăn phải được thêm ở đây — đúng lúc duyệt.
   *
   * CHỈ LƯỢT ĐẦU của bàn: mốc là `orders.first_kitchen_at` còn NULL. Dùng đúng cột đã quyết
   * định mọi thứ khác của "bàn này đã có món thật chưa" (D-19) thay vì đếm lượt gọi — đếm lượt
   * thì bàn do nhân viên mở rồi khách gọi thêm bằng QR sẽ được khăn lần thứ hai.
   *
   * Trả `null` khi: bàn không phải ăn tại chỗ, bàn đã có món xuống bếp, không tìm thấy món
   * khăn nào còn hàng, hoặc chính khách đã gọi khăn trong lượt này (không nhân đôi).
   */
  private async autoItemFor(
    order: Order,
    alreadyPickedIds: readonly string[],
  ): Promise<{ id: string; name: string; price: number; qty: number } | null> {
    if (order.first_kitchen_at !== null) return null;
    const table = await this.tables.findOne({ where: { code: order.table_code } });
    if (!table) return null;
    const menu = await this.menu.find({
      where: { is_active: true },
      select: { id: true, name: true, price: true, is_out_of_stock: true },
    });
    const picked = pickAutoItem(table.kind, true, menu);
    if (!picked) return null;
    if (alreadyPickedIds.includes(picked.item.id)) return null;
    return { id: picked.item.id, name: picked.item.name, price: picked.item.price, qty: picked.qty };
  }

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
          note: c.note,
        })),
      };
    }

    const lines = await this.items.find({ where: { request_id: In(reqs.map((r) => r.id)) } });
    const menuItems = await this.menu.find({ where: { id: In(lines.map((l) => l.menu_item_id)) } });
    const byId = new Map(menuItems.map((m) => [m.id, m]));

    // Tính TRƯỚC cho từng lượt: thẻ duyệt phải in dòng khăn và cộng nó vào tạm tính, không thì
    // bấm Duyệt xong bill nhiều hơn con số vừa đọc trên thẻ.
    const orders = await this.orders.find({ where: { id: In(reqs.map((r) => r.order_id)) } });
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const autoByReq = new Map<string, { name: string; qty: number; price_now: number }[]>();
    for (const r of reqs) {
      const o = orderById.get(r.order_id);
      if (!o) continue;
      const mine = lines.filter((l) => l.request_id === r.id).map((l) => l.menu_item_id);
      const auto = await this.autoItemFor(o, mine);
      if (auto) autoByReq.set(r.id, [{ name: auto.name, qty: auto.qty, price_now: auto.price }]);
    }

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
        const auto = autoByReq.get(r.id) ?? [];
        return {
          id: r.id,
          order_id: r.order_id,
          table_code: r.table_code,
          table_name: nameByCode.get(r.table_code) ?? r.table_code,
          created_at: r.created_at,
          items,
          auto_items: auto,
          // KHÔNG cộng dòng hết hàng — nhân viên phải thấy đúng số tiền sẽ vào bill.
          total_now:
            items.filter((i) => !i.out_of_stock).reduce((t, i) => t + i.price_now * i.qty, 0) +
            auto.reduce((t, a) => t + a.price_now * a.qty, 0),
        };
      }),
      calls: calls.map((c) => ({
        id: c.id,
        table_code: c.table_code,
        table_name: nameByCode.get(c.table_code) ?? c.table_code,
        kind: c.kind as 'STAFF' | 'BILL',
        created_at: c.created_at,
        note: c.note,
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
      await this.ordersSvc.logOrderActivity({
        order,
        event_kind: 'guest_request_rejected',
        message: 'Bỏ lượt khách gọi qua QR — mọi món đều đã hết',
        actor: staff,
      });
      return { added: 0, skipped: skipped.map((s) => ({ name: s.menu_item_name, reason: s.reason })), order_id: order.id };
    }

    // Khăn lạnh: đọc TRƯỚC khi gọi `addItemsBulk`, vì chính hàm đó đặt `first_kitchen_at` —
    // hỏi sau thì mốc "bàn chưa có món nào" đã biến mất và khăn không bao giờ được thêm.
    const auto = await this.autoItemFor(order, ok.map((l) => l.menu_item_id));

    // M7.D-10 — duyệt là xuống bếp LUÔN, không phải hai bước.
    const res = await this.ordersSvc.addItemsBulk(
      order.id,
      [
        ...ok.map((l) => ({ menu_item_id: l.menu_item_id, qty: l.qty, note: l.note })),
        ...(auto ? [{ menu_item_id: auto.id, qty: auto.qty, note: null }] : []),
      ],
      true,
      staff,
    );

    /* AI DUYỆT — dòng nhật ký riêng, KHÔNG dựa vào dòng `items_added` mà `addItemsBulk` tự ghi.
     *
     * Dòng kia chỉ nói "đã thêm N món" và nhìn y hệt một lần nhân viên gọi món tay. Đi soát
     * một bàn về sau mà không phân biệt được món nào do khách tự gọi và ai là người gật đầu
     * cho nó vào bill thì nhật ký không trả lời được câu hỏi duy nhất người ta cần hỏi nó. */
    await this.ordersSvc.logOrderActivity({
      order,
      event_kind: 'guest_request_approved',
      message:
        `Duyệt lượt khách gọi qua QR — nhận ${res.count} món` +
        (auto ? `, kèm ${auto.qty} ${auto.name}` : '') +
        (skipped.length > 0 ? `, bỏ ${skipped.length} món đã hết` : ''),
      actor: staff,
    });

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

    // Bỏ một lượt là quyết định có hậu quả: khách đã gọi mà món không bao giờ tới. Phải có vết
    // tên người bỏ, nếu không bàn đó về sau chỉ còn là một khoảng trống không ai giải thích được.
    const req = await this.requests.findOne({ where: { id: requestId } });
    const order = req ? await this.orders.findOne({ where: { id: req.order_id } }) : null;
    if (order) {
      await this.ordersSvc.logOrderActivity({
        order,
        event_kind: 'guest_request_rejected',
        message: `Bỏ lượt khách gọi qua QR${reason ? ` — ${reason}` : ''}`,
        actor: staff,
      });
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

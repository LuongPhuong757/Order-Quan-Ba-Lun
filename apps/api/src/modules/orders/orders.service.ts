import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderActivityLog } from './entities/order-activity-log.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';

export type OrderCreator = { id: string; full_name: string };

// State machine — must match packages/schemas/orders.ts.
// 'SERVED' là shortcut: cho phép skip các bước bếp khi món có sẵn (drink, snack
// lấy ngay từ quầy giao luôn). Không cần đi qua KITCHEN→COOKING→READY.
//
// SERVED → CANCELLED = "TRẢ MÓN": mang ra bàn rồi nhưng khách không dùng / không
// dùng hết. Cần thiết vì tiền bill = tổng món SERVED (xem checkout) — không mở
// transition này thì không có cách nào bớt món khỏi bill. Bắt buộc kèm lý do,
// ghi nhật ký bàn với event riêng `item_returned` để phân biệt với huỷ thường.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING:   ['KITCHEN', 'SERVED', 'CANCELLED'],
  KITCHEN:   ['COOKING', 'SERVED', 'CANCELLED'],
  COOKING:   ['READY',   'SERVED', 'CANCELLED'],
  READY:     ['SERVED',  'CANCELLED'],
  SERVED:    ['CANCELLED'],
  CANCELLED: [],
};

/** Lý do mặc định khi nhân viên bớt món mà không nhập gì (theo state trước khi huỷ).
 *
 * Lý do KHÔNG bắt buộc ở bất kỳ trạng thái nào: bớt 5/6 phần mà phải gõ lý do là
 * phiền vô ích. Nhật ký bàn vẫn ghi đủ ai thao tác + món + số lượng để truy vết. */
const RETURN_DEFAULT_REASON = 'Khách không dùng đến';
const REMOVE_DEFAULT_REASON: Record<string, string> = {
  PENDING: 'Nhân viên bỏ món (chưa báo bếp)',
  KITCHEN: 'Nhân viên huỷ món',
  COOKING: 'Nhân viên huỷ món',
  READY: 'Nhân viên huỷ món',
  SERVED: RETURN_DEFAULT_REASON,
};

/** Lý do mặc định khi huỷ cả bàn mà nhân viên không nhập gì. */
const CANCEL_TABLE_DEFAULT_REASON = 'Huỷ cả bàn — khách không dùng nữa';

/** SQL: đơn còn ít nhất 1 món CHƯA bị huỷ → bàn đang thực sự được dùng.
 * Dùng cho "bàn đang mở" và đếm "chưa thanh toán". */
const HAS_ALIVE_ITEMS_SQL =
  "EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.state <> 'CANCELLED')";

/** SQL: đơn từng gọi ít nhất 1 món (kể cả đã huỷ hết).
 *
 * Đây là ranh giới của LỊCH SỬ, khác hẳn HAS_ALIVE_ITEMS_SQL:
 * - 0 món = bàn chỉ được tap mở drawer, chưa gọi gì → KHÔNG phải giao dịch, ẩn.
 * - Đã gọi rồi huỷ hết → PHẢI hiện với trạng thái "Đã huỷ". Đây là cơ chế chống
 *   gian lận: nhân viên huỷ cả bàn / huỷ từng món thay vì thu tiền sẽ để lại vết
 *   trong lịch sử, không được biến mất. */
const HAS_ANY_ITEM_SQL = 'EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)';

/** 3 trạng thái kết đơn. `closed_at` = đã kết đơn, `is_paid` = kết bằng cách nào.
 *
 * - Đã thanh toán: closed_at có + is_paid = 1  → tính doanh thu
 * - Đã HUỶ:        closed_at có + is_paid = 0  → KHÔNG tính doanh thu, vẫn hiện
 *                                                trong lịch sử để soi gian lận
 * - Đang dùng:     closed_at NULL
 *
 * Trước đây cả hệ thống dùng `closed_at IS NOT NULL` làm định nghĩa "đã thanh
 * toán" và `is_paid` chưa từng được query. Không cần migration: chỉ checkout mới
 * set closed_at và nó luôn set is_paid = true cùng lúc, nên không có dòng cũ nào
 * bị phân loại sai. */
const PAID_SQL = 'o.closed_at IS NOT NULL AND o.is_paid = 1';
const CANCELLED_SQL = 'o.closed_at IS NOT NULL AND o.is_paid = 0';

/** Niêm 1 đơn thành "Đã huỷ": kết đơn nhưng không phải thanh toán.
 *
 * Ghi luôn `checked_out_by_*` = người huỷ để lịch sử hiện được "ai kết đơn này" —
 * chủ quán soi cột đó là biết nhân viên nào hay huỷ bàn. */
async function sealAsCancelled(
  orderRepo: Repository<Order>,
  order: Order,
  actor?: OrderCreator,
): Promise<void> {
  order.closed_at = Date.now();
  order.is_paid = false;
  order.checked_out_by_user_id = actor?.id ?? null;
  order.checked_out_by_full_name = actor?.full_name ?? null;
  await orderRepo.save(order);
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(MenuItem) private readonly menuRepo: Repository<MenuItem>,
    @InjectRepository(RestaurantTable) private readonly tableRepo: Repository<RestaurantTable>,
    @InjectRepository(OrderActivityLog) private readonly activityRepo: Repository<OrderActivityLog>,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ─── Activity log ───────────────────────────────────────────────────────
  /** Ghi 1 dòng log hoạt động cho đơn. Append-only, KHÔNG để lỗi log làm hỏng
   * thao tác chính (nuốt lỗi, chỉ warn). Snapshot bàn + giờ mở đơn để unique. */
  private async writeActivity(params: {
    order: { id: string; table_id: string; table_code: string; opened_at: number };
    event_kind: string;
    message: string;
    actor?: OrderCreator;
    item_id?: string | null;
  }): Promise<void> {
    try {
      await this.activityRepo.insert({
        order_id: params.order.id,
        item_id: params.item_id ?? null,
        table_id: params.order.table_id,
        table_code: params.order.table_code,
        order_opened_at: params.order.opened_at,
        event_kind: params.event_kind,
        message: params.message,
        actor_id: params.actor?.id ?? null,
        actor_name: params.actor?.full_name ?? null,
      });
    } catch (err) {
      this.logger.warn(`writeActivity failed (${params.event_kind}): ${(err as Error).message}`);
    }
  }

  /** Đọc snapshot bàn/giờ mở của 1 đơn để gắn vào log. */
  private async orderSnapshot(
    order_id: string,
  ): Promise<{ id: string; table_id: string; table_code: string; opened_at: number } | null> {
    return this.orderRepo.findOne({
      where: { id: order_id },
      select: ['id', 'table_id', 'table_code', 'opened_at'],
    });
  }

  /** Đọc lịch sử hoạt động của 1 đơn (cũ → mới).
   *
   * @param max_age_ms — nếu truyền, CHẶN đọc đơn mở quá lâu (nhân viên order chỉ
   *   được soi 48h gần nhất). Chặn ở service chứ không chỉ ẩn ở UI: ẩn nút mà API
   *   vẫn mở thì gọi thẳng URL là xem được hết. */
  async listOrderActivity(order_id: string, max_age_ms?: number): Promise<OrderActivityLog[]> {
    if (max_age_ms != null) {
      const order = await this.orderRepo.findOne({
        where: { id: order_id },
        select: ['id', 'opened_at'],
      });
      if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
      if (Date.now() - order.opened_at > max_age_ms) {
        throw new ForbiddenException({
          code: 'ACTIVITY_TOO_OLD',
          message: `Chỉ xem được nhật ký của bàn trong ${Math.round(max_age_ms / 3_600_000)} giờ gần nhất. Nhờ admin nếu cần xem cũ hơn.`,
        });
      }
    }
    return this.activityRepo.find({ where: { order_id }, order: { created_at: 'ASC' } });
  }

  private static fmtVnd(v: number): string {
    return v.toLocaleString('vi-VN') + 'đ';
  }

  /** Get or create the open order for a table.
   *
   * 2 đường:
   * - FAST PATH (no-lock): nếu đã có đúng 1 open order → return ngay. Polling
   *   /by-table/:id mỗi 2s sẽ rơi vào case này 99% thời gian. Tránh hold lock
   *   quá nhiều → giảm 500 do innodb_lock_wait_timeout khi nhiều client poll.
   * - SLOW PATH (transaction + pessimistic_write): chỉ dùng khi cần CREATE
   *   (chưa có order) hoặc DEDUPE (>1 phantom orders). Lock ngăn race tạo trùng.
   *
   * @param creator — nhân viên đang mở. Lưu snapshot vào order.created_by_*
   *                  CHỈ khi tạo order mới (không update khi reuse). */
  async getOrCreateOpenOrder(table_id: string, creator?: OrderCreator): Promise<Order> {
    return this.runWithRetry(() => this.getOrCreateOpenOrderImpl(table_id, creator), 2);
  }

  /** Retry helper — chạy lại 1-2 lần khi gặp transient DB error (deadlock, lock
   * timeout). Sleep ngắn ngẫu nhiên giữa các lần để giảm collision. */
  private async runWithRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = (err as Error).message || '';
        const isTransient = /deadlock|lock wait timeout|ER_LOCK/i.test(msg);
        if (!isTransient || attempt === maxAttempts) throw err;
        this.logger.warn(`Transient DB error (attempt ${attempt}/${maxAttempts}): ${msg} — retry`);
        await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));
      }
    }
    throw lastErr;
  }

  private async getOrCreateOpenOrderImpl(table_id: string, creator?: OrderCreator): Promise<Order> {
    try {
      // 1) Validate table (no lock)
      const table = await this.tableRepo.findOne({ where: { id: table_id, is_active: true } });
      if (!table) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });

      // Bàn đang khoá KiotViet → chặn tạo/mở đơn để tránh 2 hệ thống cùng dùng.
      if (table.kiotviet_locked) {
        throw new ConflictException({
          code: 'TABLE_KIOTVIET_LOCKED',
          message: 'Bàn đang order bằng KiotViet — mở khoá trước khi gọi món ở đây',
        });
      }

      // 2) FAST PATH — read without lock. 1 SELECT.
      const existing = await this.orderRepo.find({
        where: { table_id, closed_at: IsNull() },
        order: { opened_at: 'ASC' },
      });
      if (existing.length === 1) {
        return existing[0];  // happy path: đã có order, không cần lock
      }

      // 3) SLOW PATH — cần lock cho create hoặc dedupe
      const { order: resultOrder, created } = await this.ds.transaction(async (mgr) => {
        const orderRepo = mgr.getRepository(Order);

        // Re-read với lock (có thể đã đổi giữa fast path và slow path)
        const lockedExisting = await orderRepo
          .createQueryBuilder('o')
          .where('o.table_id = :tid AND o.closed_at IS NULL', { tid: table_id })
          .orderBy('o.opened_at', 'ASC')
          .setLock('pessimistic_write')
          .getMany();

        if (lockedExisting.length > 0) {
          // Dedupe: chọn order có items, hoặc cái cũ nhất nếu tất cả đều rỗng
          const withItems: Order[] = [];
          for (const o of lockedExisting) {
            const cnt = await mgr.getRepository(OrderItem).count({ where: { order_id: o.id } });
            if (cnt > 0) withItems.push(o);
          }
          if (withItems.length > 0) return { order: withItems[0], created: false };
          const keep = lockedExisting[0];
          const toDelete = lockedExisting.slice(1).map((o) => o.id);
          if (toDelete.length > 0) await orderRepo.delete(toDelete);
          return { order: keep, created: false };
        }

        // Tạo mới
        const order = orderRepo.create({
          table_id,
          table_code: table.code,
          first_kitchen_at: null,
          closed_at: null,
          is_paid: false,
          created_by_user_id: creator?.id ?? null,
          created_by_full_name: creator?.full_name ?? null,
        });
        await orderRepo.save(order);
        return { order, created: true };
      });

      // Log "mở đơn" chỉ khi thực sự tạo mới (post-commit, không chặn flow).
      if (created) {
        await this.writeActivity({
          order: resultOrder,
          event_kind: 'order_created',
          message: 'Mở đơn mới',
          actor: creator,
        });
      }
      return resultOrder;
    } catch (err) {
      // Re-throw HttpException, log + wrap others
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ConflictException) throw err;
      this.logger.error(
        `getOrCreateOpenOrder failed for table=${table_id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  /** Set order.first_kitchen_at = now nếu chưa có. Idempotent. */
  private async markFirstKitchenIfNull(
    mgr: { getRepository: (e: typeof Order) => Repository<Order> },
    order_id: string,
  ): Promise<void> {
    const repo = mgr.getRepository(Order);
    const o = await repo.findOne({ where: { id: order_id } });
    if (!o) return;
    if (o.first_kitchen_at != null) return;
    o.first_kitchen_at = Date.now();
    await repo.save(o);
  }

  /** Slim list cho OrdersPage (sơ đồ bàn) + KitchenPage (KDS).
   *
   * Include CẢ CANCELLED items kèm cancelled_reason + updated_at để FE diff
   * detection phát hiện kitchen-cancel events (bếp báo hết món) — push
   * notification cho bồi bàn biết bàn nào.
   *
   * Bỏ fields KHÔNG dùng: menu_item_price, order_id, created_by_user_id.
   * Phantom orders (0 items) bị filter ở server.
   */
  async listOpenOrders() {
    const rows = await this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'i')
      .select([
        'o.id',
        'o.table_id',
        'o.table_code',
        'o.opened_at',
        'o.first_kitchen_at',
        'o.created_by_full_name',
        'o.customer_name',
        'o.customer_phone',
        'i.id',
        'i.menu_item_id',
        'i.menu_item_name',
        'i.qty',
        'i.state',
        'i.note',
        'i.cancelled_reason',
        'i.created_by_full_name',
        'i.served_by_full_name',
        'i.cancelled_by_full_name',
        'i.is_priority',
        'i.is_note',
        'i.created_at',
        'i.updated_at',
      ])
      .where('o.closed_at IS NULL')
      .orderBy('o.opened_at', 'DESC')
      .getMany();

    // Resolve table.name cho FE → notification dùng tên thân thiện ('Bàn 01')
    // thay vì code slug ('ban-01'). 1 query duy nhất batch lookup tất cả table_id.
    const tableIds = Array.from(new Set(rows.map((o) => o.table_id)));
    const tables = tableIds.length === 0
      ? []
      : await this.tableRepo.find({ where: { id: In(tableIds) }, select: ['id', 'name'] });
    const tableNameById = new Map(tables.map((t) => [t.id, t.name]));

    const ordersWithName = rows.map((o) => ({
      ...o,
      table_name: tableNameById.get(o.table_id) || o.table_code,
    }));

    // Phantom: order có 0 item HOẶC tất cả CANCELLED không phải nghiệp vụ
    return ordersWithName.filter((o) => (o.items || []).some((it) => it.state !== 'CANCELLED'));
  }

  async getOrderWithItems(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['items'] });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
    return order;
  }

  /** Bulk add nhiều items vào order trong 1 transaction.
   * Mặc định state='PENDING', nếu send_to_kitchen=true thì 'KITCHEN' luôn.
   * Validate tất cả menu items có tồn tại + còn nguyên liệu — fail-fast nếu có 1 món sai.
   */
  async addItemsBulk(
    order_id: string,
    items: Array<{ menu_item_id: string; qty: number; note?: string | null }>,
    send_to_kitchen = false,
    creator?: OrderCreator,
  ): Promise<{ items: OrderItem[]; count: number; state: string }> {
    if (items.length === 0) {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Giỏ hàng trống' });
    }
    const result = await this.ds.transaction(async (mgr) => {
      const orderRepo = mgr.getRepository(Order);
      const itemRepo = mgr.getRepository(OrderItem);
      const menuRepo = mgr.getRepository(MenuItem);

      const order = await orderRepo.findOne({ where: { id: order_id } });
      if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
      if (order.closed_at) throw new BadRequestException({ code: 'CONFLICT', message: 'Order đã đóng' });

      // Fetch all menu items in 1 query
      const ids = Array.from(new Set(items.map((i) => i.menu_item_id)));
      const menus = await menuRepo.findByIds(ids);
      const menuMap = new Map(menus.map((m) => [m.id, m]));

      // Validate
      const outOfStock: string[] = [];
      const notFound: string[] = [];
      for (const it of items) {
        const m = menuMap.get(it.menu_item_id);
        if (!m || !m.is_active) {
          notFound.push(it.menu_item_id);
        } else if (m.is_out_of_stock) {
          outOfStock.push(m.name);
        }
      }
      if (notFound.length > 0) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `${notFound.length} món không tồn tại hoặc đã bị ẩn`,
        });
      }
      if (outOfStock.length > 0) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: `Hết nguyên liệu: ${outOfStock.join(', ')}. Bỏ khỏi giỏ rồi thử lại.`,
        });
      }

      const state = send_to_kitchen ? 'KITCHEN' : 'PENDING';
      const created: OrderItem[] = [];
      // TÁCH TỪNG PHẦN: mỗi đơn vị số lượng = 1 dòng riêng để bếp nấu/đánh dấu
      // độc lập từng cái. Hiển thị ở drawer/lịch sử vẫn gộp lại "N× món".
      for (const it of items) {
        const m = menuMap.get(it.menu_item_id)!;
        for (let u = 0; u < it.qty; u++) {
          const entity = itemRepo.create({
            order_id,
            menu_item_id: m.id,
            menu_item_name: m.name,
            menu_item_price: m.price,
            qty: 1,
            state,
            note: it.note ?? null,
            cancelled_reason: null,
            created_by_user_id: creator?.id ?? null,
            created_by_full_name: creator?.full_name ?? null,
          });
          const saved = await itemRepo.save(entity);
          created.push(saved);
        }
      }
      if (send_to_kitchen) {
        await this.markFirstKitchenIfNull(mgr, order_id);
      }
      return { items: created, count: created.length, state };
    });

    // Log "gọi món" (post-commit, không chặn flow).
    const snap = await this.orderSnapshot(order_id);
    if (snap) {
      // Gộp lại theo tên món (items đã tách thành nhiều dòng qty=1)
      const counts = new Map<string, number>();
      for (const i of result.items) counts.set(i.menu_item_name, (counts.get(i.menu_item_name) || 0) + i.qty);
      const summary = Array.from(counts.entries()).map(([n, q]) => `${q}× ${n}`).join(', ');
      await this.writeActivity({
        order: snap,
        event_kind: 'items_added',
        message: `Gọi món: ${summary}${send_to_kitchen ? ' (báo bếp luôn)' : ''}`,
        actor: creator,
      });
    }
    return result;
  }

  async addItem(
    order_id: string,
    menu_item_id: string,
    qty: number,
    note?: string | null,
    creator?: OrderCreator,
  ) {
    const order = await this.orderRepo.findOne({ where: { id: order_id } });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
    if (order.closed_at) throw new BadRequestException({ code: 'CONFLICT', message: 'Order đã đóng' });
    const menu = await this.menuRepo.findOne({ where: { id: menu_item_id, is_active: true } });
    if (!menu) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });
    if (menu.is_out_of_stock) {
      throw new BadRequestException({ code: 'CONFLICT', message: `Món "${menu.name}" đang hết, không thể gọi mới` });
    }
    // TÁCH TỪNG PHẦN: mỗi đơn vị = 1 dòng qty=1 (bếp nấu từng cái)
    let first: OrderItem | null = null;
    for (let u = 0; u < qty; u++) {
      const item = this.itemRepo.create({
        order_id,
        menu_item_id,
        menu_item_name: menu.name,
        menu_item_price: menu.price,
        qty: 1,
        state: 'PENDING',
        note: note ?? null,
        cancelled_reason: null,
        created_by_user_id: creator?.id ?? null,
        created_by_full_name: creator?.full_name ?? null,
      });
      const saved = await this.itemRepo.save(item);
      if (!first) first = saved;
    }
    await this.writeActivity({
      order,
      event_kind: 'items_added',
      message: `Gọi món: ${qty}× ${menu.name}`,
      actor: creator,
      item_id: first?.id,
    });
    return first!;
  }

  /** State transition with validation + snapshot actor (cho notification) */
  async changeItemState(item_id: string, to: string, reason?: string, actor?: OrderCreator) {
    // State trước khi đổi — cần cho nhánh log post-commit (trả món vs huỷ thường).
    let fromState = '';
    const item = await this.ds.transaction(async (mgr) => {
      const itemRepo = mgr.getRepository(OrderItem);
      const item = await itemRepo.findOne({ where: { id: item_id } });
      if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item không tồn tại' });
      // Đã thanh toán = chốt sổ, khoá hẳn. Bắt buộc từ khi mở SERVED→CANCELLED:
      // không có chốt này thì món của đơn đã thu tiền vẫn huỷ được → sai doanh thu
      // lịch sử. Đơn còn mở thì sửa được hết.
      const parent = await mgr
        .getRepository(Order)
        .findOne({ where: { id: item.order_id }, select: ['id', 'closed_at'] });
      if (parent?.closed_at) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: 'Đơn đã thanh toán — không sửa được nữa',
        });
      }
      const allowed = ALLOWED_TRANSITIONS[item.state] || [];
      if (!allowed.includes(to)) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: `Không thể chuyển từ ${item.state} sang ${to}`,
        });
      }
      fromState = item.state;
      item.state = to;
      if (to === 'CANCELLED') {
        // Trả món đã giao: KHÔNG bắt nhập lý do. Trả 5/6 phần thì phải gõ lý do 5
        // lần là vô lý — mặc định ghi "Khách không dùng đến", ai cần chi tiết thì
        // vẫn truyền reason được.
        if (fromState === 'SERVED') {
          item.cancelled_reason = reason?.trim() || RETURN_DEFAULT_REASON;
        } else if (reason) {
          item.cancelled_reason = reason;
        }
        // Snapshot ai huỷ — phân biệt với 'Bếp báo hết' (auto từ toggleStock)
        item.cancelled_by_user_id = actor?.id ?? null;
        item.cancelled_by_full_name = actor?.full_name ?? null;
      }
      if (to === 'SERVED') {
        // Snapshot ai đánh dấu giao — bếp hoặc bồi bàn (qua OrderDrawer)
        item.served_by_user_id = actor?.id ?? null;
        item.served_by_full_name = actor?.full_name ?? null;
      }
      // Auto-clear priority khi bếp bắt đầu nấu — cờ đã hoàn thành nhiệm vụ
      if (to === 'COOKING' && item.is_priority) {
        item.is_priority = false;
      }
      await itemRepo.save(item);
      if (to === 'KITCHEN') {
        await this.markFirstKitchenIfNull(mgr, item.order_id);
      }
      return item;
    });

    // Log "huỷ món" + "giao món" (post-commit). Các state trung gian không log để tránh nhiễu.
    if (to === 'CANCELLED') {
      const snap = await this.orderSnapshot(item.order_id);
      if (snap) {
        // Trả món (đã mang ra bàn) tách riêng khỏi huỷ thường: chủ quán cần thấy
        // ngay trong nhật ký bàn là món này đã tốn nguyên liệu + đã bớt khỏi bill.
        const isReturn = fromState === 'SERVED';
        await this.writeActivity({
          order: snap,
          event_kind: isReturn ? 'item_returned' : 'item_cancelled',
          message: isReturn
            ? `Trả món đã giao: ${item.qty}× ${item.menu_item_name} — ${item.cancelled_reason}` +
              ` (bớt ${OrdersService.fmtVnd(item.menu_item_price * item.qty)} khỏi bill)`
            : `Huỷ món: ${item.qty}× ${item.menu_item_name}${reason ? ` — lý do: ${reason}` : ''}`,
          actor,
          item_id: item.id,
        });
      }
    }
    if (to === 'SERVED') {
      const snap = await this.orderSnapshot(item.order_id);
      if (snap) {
        await this.writeActivity({
          order: snap,
          event_kind: 'item_served',
          message: `Giao món: ${item.qty}× ${item.menu_item_name}`,
          actor,
          item_id: item.id,
        });
      }
    }
    return item;
  }

  /** BỚT SỐ LƯỢNG MÓN (bulk) — huỷ N phần của 1 món khỏi đơn.
   *
   * Dùng cho MỌI trạng thái trước khi thanh toán (PENDING / KITCHEN / COOKING /
   * READY / SERVED). Ranh giới duy nhất là `order.closed_at`: đã thanh toán thì
   * khoá, trước đó sửa được hết.
   *
   * Vì mỗi phần là 1 dòng qty=1, bớt 5/6 phần = 5 dòng. Gọi endpoint này 1 lần
   * thay vì PATCH 5 lần để: (a) atomic, (b) nhật ký bàn chỉ 1 dòng "5× món" thay
   * vì 5 dòng rời rạc, (c) không phải nhập lý do lặp lại cho từng phần.
   *
   * Lý do OPTIONAL ở mọi trạng thái — BE tự ghi mặc định theo state cũ. */
  async removeItemUnits(
    item_ids: string[],
    reason?: string,
    actor?: OrderCreator,
  ): Promise<{ removed: number; refunded: number; order_id: string }> {
    const given = reason?.trim() || '';
    const result = await this.ds.transaction(async (mgr) => {
      const itemRepo = mgr.getRepository(OrderItem);
      const items = await itemRepo.find({ where: { id: In(item_ids) } });
      if (items.length === 0) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Không tìm thấy món cần bớt' });
      }
      // Món đã huỷ rồi thì bỏ qua yêu cầu (client đang xem data cũ).
      const alreadyCancelled = items.filter((i) => i.state === 'CANCELLED');
      if (alreadyCancelled.length > 0) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: `${alreadyCancelled.length} món đã huỷ trước đó. Tải lại và thử lại.`,
        });
      }
      // Chặn bớt xuyên đơn — 1 lần gọi chỉ tác động 1 đơn (nhật ký gắn vào 1 đơn).
      const orderIds = Array.from(new Set(items.map((i) => i.order_id)));
      if (orderIds.length > 1) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: 'Không thể bớt món của nhiều đơn trong 1 lần',
        });
      }
      const order = await mgr.getRepository(Order).findOne({ where: { id: orderIds[0] } });
      if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
      if (order.closed_at) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: 'Đơn đã thanh toán — không sửa được nữa',
        });
      }

      // Chỉ món đã SERVED mới đang được tính tiền → chỉ nó làm bill giảm.
      const allServed = items.every((i) => i.state === 'SERVED');
      let refunded = 0;
      for (const it of items) {
        const prevState = it.state; // phải đọc TRƯỚC khi ghi đè, lý do mặc định phụ thuộc state cũ
        if (prevState === 'SERVED') refunded += it.menu_item_price * it.qty;
        it.state = 'CANCELLED';
        it.cancelled_reason = given || REMOVE_DEFAULT_REASON[prevState] || 'Nhân viên bỏ món';
        it.cancelled_by_user_id = actor?.id ?? null;
        it.cancelled_by_full_name = actor?.full_name ?? null;
        await itemRepo.save(it);
      }

      // Huỷ tới món cuối cùng = bàn tàn, đối xử y như "huỷ cả bàn". Nếu không niêm
      // ở đây thì nhân viên chỉ cần huỷ từng món một là lách được — đơn ở lại mở,
      // khách sau dùng lại chính đơn đó và vết huỷ bị trộn lẫn, mất dấu.
      const aliveLeft = await itemRepo.count({ where: { order_id: order.id, state: Not('CANCELLED') } });
      const emptied = aliveLeft === 0;
      if (emptied) await sealAsCancelled(mgr.getRepository(Order), order, actor);

      return { items, refunded, order_id: order.id, allServed, emptied };
    });

    // 1 dòng nhật ký duy nhất, gộp theo tên món.
    const snap = await this.orderSnapshot(result.order_id);
    if (snap) {
      const counts = new Map<string, number>();
      for (const i of result.items) {
        counts.set(i.menu_item_name, (counts.get(i.menu_item_name) || 0) + i.qty);
      }
      const summary = Array.from(counts.entries())
        .map(([n, q]) => `${q}× ${n}`)
        .join(', ');
      // Món đã mang ra bàn tách riêng event: chủ quán cần thấy ngay là đã tốn
      // nguyên liệu + đã bớt tiền khỏi bill, khác hẳn huỷ khi chưa nấu.
      const reasonText = result.items[0]?.cancelled_reason ?? '';
      await this.writeActivity({
        order: snap,
        event_kind: result.allServed ? 'item_returned' : 'item_cancelled',
        message: result.allServed
          ? `Trả món đã giao: ${summary} — ${reasonText}` +
            ` (bớt ${OrdersService.fmtVnd(result.refunded)} khỏi bill)`
          : `Huỷ món: ${summary} — ${reasonText}`,
        actor,
        item_id: result.items[0]?.id ?? null,
      });
      // Món cuối cùng bị huỷ → đơn đã bị niêm ở trên, ghi thêm dòng kết đơn để
      // nhật ký nói rõ bàn kết thúc bằng HUỶ chứ không phải thanh toán.
      if (result.emptied) {
        await this.writeActivity({
          order: snap,
          event_kind: 'order_cancelled',
          message: 'Bàn kết thúc bằng HUỶ — đã huỷ hết món, không thu tiền',
          actor,
        });
      }
    }
    return { removed: result.items.length, refunded: result.refunded, order_id: result.order_id };
  }

  /** HUỶ CẢ BÀN — khách vào, gọi đồ rồi không dùng nữa, bỏ sạch bàn.
   *
   * Huỷ toàn bộ món chưa bị huỷ (mọi trạng thái, kể cả đã giao) trong 1 transaction.
   *
   * KHÔNG set `closed_at`: cả hệ thống đang dùng `closed_at IS NOT NULL` làm định
   * nghĩa "đã thanh toán" (lịch sử, doanh thu, paid_count) — đóng đơn ở đây sẽ biến
   * bàn bị huỷ thành "đơn đã thanh toán 0đ" trong báo cáo. Để đơn mở + sạch món là
   * đủ: `HAS_REAL_ITEMS_SQL` khiến nó biến khỏi sơ đồ bàn, lịch sử và thống kê,
   * còn bản ghi vẫn ở lại cho nhật ký truy vết. */
  async cancelWholeOrder(
    order_id: string,
    reason?: string,
    actor?: OrderCreator,
  ): Promise<{ cancelled: number; voided_amount: number }> {
    const finalReason = reason?.trim() || CANCEL_TABLE_DEFAULT_REASON;
    const result = await this.ds.transaction(async (mgr) => {
      const orderRepo = mgr.getRepository(Order);
      const itemRepo = mgr.getRepository(OrderItem);

      const order = await orderRepo.findOne({ where: { id: order_id } });
      if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
      if (order.closed_at) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: 'Đơn đã thanh toán — không huỷ được nữa',
        });
      }

      const items = await itemRepo.find({ where: { order_id } });
      const alive = items.filter((i) => i.state !== 'CANCELLED');
      if (alive.length === 0) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: 'Bàn này không có món nào để huỷ',
        });
      }

      // Chỉ món đã giao mới đang được tính tiền → chỉ nó là số tiền bị xoá khỏi bill.
      let voided = 0;
      for (const it of alive) {
        if (it.state === 'SERVED') voided += it.menu_item_price * it.qty;
        it.state = 'CANCELLED';
        it.cancelled_reason = finalReason;
        it.cancelled_by_user_id = actor?.id ?? null;
        it.cancelled_by_full_name = actor?.full_name ?? null;
        await itemRepo.save(it);
      }
      // NIÊM ĐƠN: closed_at = đã kết đơn, is_paid = false → trạng thái "Đã huỷ".
      // Bắt buộc phải niêm, không được để đơn mở:
      // (1) Đơn mở sẽ được khách tiếp theo dùng lại, món đã huỷ trộn lẫn với nhóm
      //     mới → mất vết gian lận.
      // (2) Niêm rồi thì khách mới tự có đơn sạch (getOrCreateOpenOrder tạo mới).
      // Doanh thu KHÔNG bị ảnh hưởng vì mọi query doanh thu đã đổi sang PAID_SQL.
      await sealAsCancelled(orderRepo, order, actor);
      return { alive, voided };
    });

    // 1 dòng nhật ký cho cả bàn, gộp theo tên món.
    const snap = await this.orderSnapshot(order_id);
    if (snap) {
      const counts = new Map<string, number>();
      for (const i of result.alive) {
        counts.set(i.menu_item_name, (counts.get(i.menu_item_name) || 0) + i.qty);
      }
      const summary = Array.from(counts.entries())
        .map(([n, q]) => `${q}× ${n}`)
        .join(', ');
      await this.writeActivity({
        order: snap,
        event_kind: 'order_cancelled',
        message:
          `HUỶ CẢ BÀN: ${summary} — ${finalReason}` +
          (result.voided > 0 ? ` (xoá ${OrdersService.fmtVnd(result.voided)} khỏi bill)` : ''),
        actor,
      });
    }
    return { cancelled: result.alive.length, voided_amount: result.voided };
  }

  /** THÊM GHI CHÚ CHO BẾP — "lấy bát cho khách", "đũa thìa", "nước mắm"...
   *
   * Tạo 1 dòng item y như gọi món, chỉ khác: giá 0, không gắn menu_item_id,
   * `is_note = true`. Nhờ vậy nó chạy đúng vòng đời sẵn có — bồi bàn báo bếp, bếp
   * tick chuyển cột trên KDS, đánh dấu đã giao — không cần bảng hay endpoint state
   * riêng, và không đội tiền bàn lên.
   *
   * KHÔNG kiểm tra hết nguyên liệu (ghi chú không phải hàng trong menu). */
  async addServiceNote(
    order_id: string,
    text: string,
    send_to_kitchen = true,
    creator?: OrderCreator,
  ): Promise<OrderItem> {
    const content = text.trim();
    if (!content) {
      throw new BadRequestException({ code: 'BAD_REQUEST', message: 'Ghi chú không được để trống' });
    }
    const order = await this.orderRepo.findOne({ where: { id: order_id } });
    if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
    if (order.closed_at) {
      throw new BadRequestException({ code: 'CONFLICT', message: 'Đơn đã kết thúc — không thêm được' });
    }

    const saved = await this.itemRepo.save(
      this.itemRepo.create({
        order_id,
        menu_item_id: null,
        menu_item_name: content,
        menu_item_price: 0,
        qty: 1,
        state: send_to_kitchen ? 'KITCHEN' : 'PENDING',
        is_note: true,
        note: null,
        cancelled_reason: null,
        created_by_user_id: creator?.id ?? null,
        created_by_full_name: creator?.full_name ?? null,
      }),
    );
    if (send_to_kitchen) {
      await this.markFirstKitchenIfNull(this.ds.manager, order_id);
    }

    await this.writeActivity({
      order,
      event_kind: 'note_added',
      message: `Ghi chú cho bếp: ${content}${send_to_kitchen ? ' (báo bếp luôn)' : ''}`,
      actor: creator,
      item_id: saved.id,
    });
    return saved;
  }

  /** Set/unset cờ ưu tiên — chỉ cho phép khi item còn ở KITCHEN.
   * Item ở các state khác (PENDING/COOKING/READY/SERVED/CANCELLED) → từ chối. */
  async setItemPriority(item_id: string, priority: boolean): Promise<OrderItem> {
    const itemRepo = this.ds.getRepository(OrderItem);
    const item = await itemRepo.findOne({ where: { id: item_id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });
    if (item.state !== 'KITCHEN') {
      throw new BadRequestException({
        code: 'PRIORITY_INVALID_STATE',
        message: `Chỉ đánh dấu ưu tiên cho món còn ở "Đã order". Món này đang ở "${item.state}".`,
      });
    }
    if (item.is_priority === priority) return item;
    item.is_priority = priority;
    await itemRepo.save(item);
    return item;
  }

  /** Update thông tin khách giao hàng — chỉ dùng cho bàn 'delivery'. */
  async updateCustomerInfo(
    order_id: string,
    info: { name: string; address: string; phone: string },
  ): Promise<Order> {
    const o = await this.orderRepo.findOne({ where: { id: order_id } });
    if (!o) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
    if (o.closed_at) throw new BadRequestException({ code: 'CONFLICT', message: 'Order đã đóng, không sửa được' });
    o.customer_name = info.name.trim();
    o.customer_address = info.address.trim();
    o.customer_phone = info.phone.trim();
    await this.orderRepo.save(o);
    return o;
  }

  /** Bulk send PENDING items to kitchen (one click) */
  async sendPendingToKitchen(order_id: string) {
    return await this.ds.transaction(async (mgr) => {
      const itemRepo = mgr.getRepository(OrderItem);
      const result = await itemRepo
        .createQueryBuilder()
        .update(OrderItem)
        .set({ state: 'KITCHEN' })
        .where('order_id = :oid AND state = :s', { oid: order_id, s: 'PENDING' })
        .execute();
      const affected = result.affected || 0;
      if (affected > 0) {
        await this.markFirstKitchenIfNull(mgr, order_id);
      }
      return { affected };
    });
  }

  /** Checkout: thanh toán + đóng order.
   *
   * Behaviour:
   * - Cho phép thanh toán BẤT KỲ TRẠNG THÁI nào của items (kể cả còn PENDING/KITCHEN/COOKING/READY).
   * - Items chưa SERVED sẽ TỰ ĐỘNG BỊ HUỶ với reason "Khách thanh toán khi món chưa giao xong"
   *   (nhân viên đã confirm ở FE dialog).
   * - Tổng tiền = sum(qty × menu_item_price) của items SERVED ONLY (món đã giao mới tính tiền).
   * - CANCELLED items (manual + auto) không tính.
   * - Set closed_at = now, is_paid = true.
   * - Order + items vẫn giữ trong DB cho báo cáo (REQ-H).
   */
  async checkout(order_id: string, cashier?: OrderCreator): Promise<{
    order: Order;
    served_items: number;
    cancelled_items: number;
    auto_cancelled_items: number;
    total: number;
  }> {
    const result = await this.ds.transaction(async (mgr) => {
      const orderRepo = mgr.getRepository(Order);
      const itemRepo = mgr.getRepository(OrderItem);

      const order = await orderRepo.findOne({ where: { id: order_id }, relations: ['items'] });
      if (!order) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order không tồn tại' });
      if (order.closed_at) {
        throw new BadRequestException({ code: 'CONFLICT', message: 'Order đã thanh toán rồi' });
      }
      const items = order.items || [];
      if (items.length === 0) {
        throw new BadRequestException({ code: 'CONFLICT', message: 'Order trống, không có gì để thanh toán' });
      }

      // Auto-cancel các items chưa SERVED (PENDING / KITCHEN / COOKING / READY)
      const activeItems = items.filter((i) => !['SERVED', 'CANCELLED'].includes(i.state));
      const reason = 'Khách thanh toán khi món chưa giao xong';
      for (const it of activeItems) {
        it.state = 'CANCELLED';
        it.cancelled_reason = reason;
        await itemRepo.save(it);
      }

      const served = items.filter((i) => i.state === 'SERVED');
      const cancelled = items.filter((i) => i.state === 'CANCELLED' && i.cancelled_reason !== reason);
      const total = served.reduce((s, i) => s + i.menu_item_price * i.qty, 0);

      order.closed_at = Date.now();
      order.is_paid = true;
      order.checked_out_by_user_id = cashier?.id ?? null;
      order.checked_out_by_full_name = cashier?.full_name ?? null;
      await orderRepo.save(order);

      return {
        order,
        served_items: served.length,
        cancelled_items: cancelled.length,
        auto_cancelled_items: activeItems.length,
        total,
      };
    });

    // Log "thanh toán" (post-commit).
    await this.writeActivity({
      order: result.order,
      event_kind: 'checkout',
      message:
        `Thanh toán: ${OrdersService.fmtVnd(result.total)} ` +
        `(${result.served_items} món đã giao` +
        `${result.auto_cancelled_items > 0 ? `, huỷ ${result.auto_cancelled_items} món chưa giao` : ''})`,
      actor: cashier,
    });
    return result;
  }

  /** Lịch sử order — bao gồm cả paid (closed) + unpaid (open).
   * Filter: table_id, date range, cashier_user_id, status.
   * Sort theo COALESCE(closed_at, opened_at) DESC — hoạt động gần nhất lên trên.
   * Trả về kèm items để FE expand chi tiết khi cần. */
  async listHistory(opts: {
    table_id?: string;
    start_ms?: number;
    end_ms?: number;
    cashier_user_id?: string;
    status?: 'all' | 'paid' | 'unpaid' | 'cancelled';
    page?: number;
    page_size?: number;
    /** Giới hạn tuổi đơn được xem (nhân viên order: 48h). Chặn ở server, không
     * chỉ ẩn ở UI — sửa query string trên URL cũng không lùi xa hơn được. */
    max_age_ms?: number;
  }): Promise<{ items: Array<Order & { table_name: string }>; total: number; page: number; page_size: number }> {
    const page = Math.max(1, opts.page || 1);
    const page_size = Math.min(100, Math.max(1, opts.page_size || 20));
    const status = opts.status || 'all';

    // WHERE dùng chung cho query đếm / lấy ID / tải chi tiết
    const wheres: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.max_age_ms != null) {
      wheres.push('o.opened_at >= :floor');
      params.floor = new Date(Date.now() - opts.max_age_ms);
    }
    // 3 trạng thái kết đơn (xem ORDER_STATE_SQL): đã thanh toán / đã huỷ / đang dùng.
    if (status === 'paid') wheres.push(PAID_SQL);
    else if (status === 'cancelled') wheres.push(CANCELLED_SQL);
    else if (status === 'unpaid') wheres.push(`o.closed_at IS NULL AND ${HAS_ALIVE_ITEMS_SQL}`);
    // Ẩn ĐƠN RỖNG khỏi lịch sử: bàn chỉ được tap mở drawer nhưng chưa gọi món nào.
    // Đó không phải giao dịch nên không được nằm trong lịch sử dưới dạng "chưa thanh
    // toán" (bàn đã trống mà lịch sử vẫn hiện là sai).
    // LƯU Ý: đơn đã gọi rồi huỷ hết VẪN HIỆN — dùng HAS_ANY_ITEM chứ không phải
    // HAS_ALIVE_ITEM. Đó là vết để phát hiện nhân viên huỷ bàn thay vì thu tiền.
    wheres.push(`(o.closed_at IS NOT NULL OR ${HAS_ANY_ITEM_SQL})`);
    if (opts.table_id) { wheres.push('o.table_id = :tid'); params.tid = opts.table_id; }
    if (opts.cashier_user_id) {
      wheres.push('o.checked_out_by_user_id = :cid');
      params.cid = opts.cashier_user_id;
    }
    // Date filter ưu tiên closed_at, fallback opened_at — dùng MySQL COALESCE.
    if (opts.start_ms) {
      wheres.push('COALESCE(o.closed_at, o.opened_at) >= :s');
      params.s = new Date(opts.start_ms);
    }
    if (opts.end_ms) {
      wheres.push('COALESCE(o.closed_at, o.opened_at) <= :e');
      params.e = new Date(opts.end_ms);
    }
    const whereSql = wheres.length > 0 ? wheres.join(' AND ') : '1=1';

    // Bước 1: phân trang theo ID, sort theo THỜI GIAN VÀO ĂN = opened_at DESC (mới nhất trước).
    // KHÔNG join items ở bước này → tránh bug TypeORM (join to-many + skip/take + orderBy).
    // opened_at không bao giờ NULL nên đơn CHƯA thanh toán vẫn hiện đúng ở tab "Tất cả"
    // (trước đây sort closed_at DESC khiến đơn chưa TT — closed_at NULL — rơi xuống cuối).
    const idRows = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.id', 'id')
      .where(whereSql, params)
      .orderBy('o.opened_at', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .offset((page - 1) * page_size)
      .limit(page_size)
      .getRawMany<{ id: string }>();
    const ids = idRows.map((r) => r.id);
    const total = await this.orderRepo
      .createQueryBuilder('o')
      .where(whereSql, params)
      .getCount();

    if (ids.length === 0) {
      return { items: [], total, page, page_size };
    }

    // Bước 2: tải đầy đủ đơn + items, giữ đúng thứ tự bước 1.
    const loaded = await this.orderRepo.find({ where: { id: In(ids) }, relations: ['items'] });
    const byId = new Map(loaded.map((o) => [o.id, o]));
    const orders = ids.map((id) => byId.get(id)).filter((o): o is Order => !!o);

    // Resolve table.name cho FE — checkout notification dùng tên thân thiện
    const tableIds = Array.from(new Set(orders.map((o) => o.table_id)));
    const tables = tableIds.length === 0
      ? []
      : await this.tableRepo.find({ where: { id: In(tableIds) }, select: ['id', 'name'] });
    const tableNameById = new Map(tables.map((t) => [t.id, t.name]));
    const items = orders.map((o) => ({
      ...o,
      table_name: tableNameById.get(o.table_id) || o.table_code,
    }));
    return { items, total, page, page_size };
  }

  /** GET /orders/stats — số liệu tổng hợp cho biểu đồ ở màn Giao dịch.
   *
   * Áp filter bàn/thu ngân/khoảng ngày (KHÔNG áp status — biểu đồ luôn phản ánh
   * đủ bức tranh trong phạm vi ngày/bàn/thu ngân). Doanh thu = tổng món state
   * SERVED của các đơn ĐÃ thanh toán (closed_at NOT NULL) — khớp cách tính ở FE.
   *
   * Bucket theo NGÀY/GIỜ giờ Việt Nam (UTC+7, cố định, không DST): cộng offset
   * 7h vào epoch ms rồi lấy phần ngày/giờ — tránh lệ thuộc timezone table MySQL.
   */
  async stats(opts: {
    table_id?: string;
    cashier_user_id?: string;
    start_ms?: number;
    end_ms?: number;
  }): Promise<{
    revenue_by_day: Array<{ day: string; revenue: number; orders: number }>;
    top_items: Array<{ name: string; qty: number; revenue: number }>;
    revenue_by_cashier: Array<{ name: string; revenue: number; orders: number }>;
    by_hour: Array<{ hour: number; orders: number; revenue: number }>;
    paid_count: number;
    unpaid_count: number;
    cancelled_count: number;
    paid_revenue: number;
  }> {
    const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
    // Áp các filter dùng chung (bàn/thu ngân/khoảng ngày) vào 1 QueryBuilder.
    const applyFilters = (qb: import('typeorm').SelectQueryBuilder<Order>) => {
      if (opts.table_id) qb.andWhere('o.table_id = :tid', { tid: opts.table_id });
      if (opts.cashier_user_id) {
        qb.andWhere('o.checked_out_by_user_id = :cid', { cid: opts.cashier_user_id });
      }
      if (opts.start_ms) {
        qb.andWhere('COALESCE(o.closed_at, o.opened_at) >= :s', { s: new Date(opts.start_ms) });
      }
      if (opts.end_ms) {
        qb.andWhere('COALESCE(o.closed_at, o.opened_at) <= :e', { e: new Date(opts.end_ms) });
      }
      return qb;
    };

    // 1) Doanh thu từng đơn ĐÃ thanh toán (kèm epoch ms + thu ngân) → gom theo
    //    ngày/giờ/thu ngân bằng JS (tránh hàm timezone trong SQL).
    const perOrder = await applyFilters(
      this.orderRepo
        .createQueryBuilder('o')
        .leftJoin('o.items', 'i')
        .select('UNIX_TIMESTAMP(o.closed_at) * 1000', 'closed_ms')
        .addSelect('o.checked_out_by_full_name', 'cashier')
        .addSelect(
          "SUM(CASE WHEN i.state = 'SERVED' THEN i.menu_item_price * i.qty ELSE 0 END)",
          'revenue',
        )
        .where(PAID_SQL)
        .groupBy('o.id')
        .addGroupBy('o.closed_at')
        .addGroupBy('o.checked_out_by_full_name'),
    ).getRawMany<{ closed_ms: string | number; cashier: string | null; revenue: string | number }>();

    const dayMap = new Map<string, { revenue: number; orders: number }>();
    const cashierMap = new Map<string, { revenue: number; orders: number }>();
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, revenue: 0 }));
    let paidRevenue = 0;
    for (const r of perOrder) {
      const rev = Number(r.revenue) || 0;
      paidRevenue += rev;
      // closed_ms = UNIX_TIMESTAMP(closed_at)*1000 (epoch UTC ms) → +7h ra giờ VN
      const vn = new Date((Number(r.closed_ms) || 0) + VN_OFFSET_MS);
      const day = vn.toISOString().slice(0, 10);
      const hour = vn.getUTCHours();
      const d = dayMap.get(day) || { revenue: 0, orders: 0 };
      d.revenue += rev; d.orders += 1; dayMap.set(day, d);
      hours[hour].orders += 1; hours[hour].revenue += rev;
      const cname = r.cashier || '(không xác định)';
      const c = cashierMap.get(cname) || { revenue: 0, orders: 0 };
      c.revenue += rev; c.orders += 1; cashierMap.set(cname, c);
    }

    // 2) Top món bán chạy (theo doanh thu) — món SERVED của đơn đã thanh toán.
    const topRaw = await applyFilters(
      this.orderRepo
        .createQueryBuilder('o')
        .innerJoin('o.items', 'i')
        .select('i.menu_item_name', 'name')
        .addSelect('SUM(i.qty)', 'qty')
        .addSelect('SUM(i.menu_item_price * i.qty)', 'revenue')
        .where(PAID_SQL)
        .andWhere("i.state = 'SERVED'")
        // Ghi chú ("lấy bát", "nước mắm") không phải hàng bán → không được lọt
        // vào top món bán chạy, nếu không nó đứng đầu bảng với doanh thu 0đ.
        .andWhere('i.is_note = 0')
        .groupBy('i.menu_item_name')
        .orderBy('revenue', 'DESC')
        .limit(10),
    ).getRawMany<{ name: string; qty: string | number; revenue: string | number }>();

    // 3) Đếm đơn theo 3 trạng thái (cùng phạm vi filter).
    const paid_count = await applyFilters(
      this.orderRepo.createQueryBuilder('o').where(PAID_SQL),
    ).getCount();
    // Đơn bị HUỶ — đếm riêng để chủ quán soi được: bàn có gọi món nhưng kết thúc
    // bằng huỷ chứ không phải thu tiền.
    const cancelled_count = await applyFilters(
      this.orderRepo.createQueryBuilder('o').where(CANCELLED_SQL),
    ).getCount();
    // Đơn rỗng (tap mở bàn chưa gọi gì / đã huỷ hết) KHÔNG tính là "chưa thanh
    // toán" — nếu tính thì con số này phình theo số lần bấm vào bàn.
    const unpaid_count = await applyFilters(
      this.orderRepo
        .createQueryBuilder('o')
        .where('o.closed_at IS NULL')
        .andWhere(HAS_ALIVE_ITEMS_SQL),
    ).getCount();

    return {
      revenue_by_day: Array.from(dayMap.entries())
        .map(([day, v]) => ({ day, revenue: v.revenue, orders: v.orders }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      top_items: topRaw.map((t) => ({
        name: t.name,
        qty: Number(t.qty) || 0,
        revenue: Number(t.revenue) || 0,
      })),
      revenue_by_cashier: Array.from(cashierMap.entries())
        .map(([name, v]) => ({ name, revenue: v.revenue, orders: v.orders }))
        .sort((a, b) => b.revenue - a.revenue),
      by_hour: hours,
      paid_count,
      unpaid_count,
      cancelled_count,
      paid_revenue: paidRevenue,
    };
  }

  /** DISTINCT cashiers từ orders — dropdown filter ở HistoryPage.
   * Chỉ lấy user đã từng thanh toán ít nhất 1 order (checked_out_by_user_id NOT NULL). */
  async listCashiers(): Promise<Array<{ id: string; full_name: string }>> {
    const rows = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.checked_out_by_user_id', 'id')
      .addSelect('o.checked_out_by_full_name', 'full_name')
      .where('o.checked_out_by_user_id IS NOT NULL')
      .groupBy('o.checked_out_by_user_id')
      .addGroupBy('o.checked_out_by_full_name')
      .orderBy('o.checked_out_by_full_name', 'ASC')
      .getRawMany<{ id: string; full_name: string }>();
    return rows;
  }

  /** Transfer all items from source table to destination table.
   * Closes source order (if no items remain) and moves items to dest order. */
  async transferTable(source_order_id: string, dest_table_id: string, actor?: OrderCreator) {
    try {
      let srcTableName = '';
      let movedCount = 0;
      const dest = await this.ds.transaction(async (mgr) => {
        const orderRepo = mgr.getRepository(Order);
        const itemRepo = mgr.getRepository(OrderItem);
        const tableRepo = mgr.getRepository(RestaurantTable);

        // KHÔNG load relations 'items' — tránh TypeORM cascade-save items lại vào src
        // khi save src.closed_at sau (bug: items có thể bị revert order_id về src).
        const src = await orderRepo.findOne({ where: { id: source_order_id } });
        if (!src) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order nguồn không tồn tại' });
        if (src.closed_at) throw new BadRequestException({ code: 'CONFLICT', message: 'Order đã đóng' });

        const destTable = await tableRepo.findOne({ where: { id: dest_table_id, is_active: true } });
        if (!destTable) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn đích không tồn tại' });
        if (src.table_id === dest_table_id) {
          throw new BadRequestException({ code: 'CONFLICT', message: 'Bàn đích trùng bàn nguồn' });
        }
        // Tên bàn nguồn cho log (fallback mã bàn nếu bàn đã bị xoá).
        const srcTable = await tableRepo.findOne({ where: { id: src.table_id } });
        srcTableName = srcTable?.name || src.table_code;

        // Đếm src items TRƯỚC khi move (sanity check sau cùng)
        const srcItemCount = await itemRepo.count({ where: { order_id: src.id } });

        let dest = await orderRepo.findOne({ where: { table_id: dest_table_id, closed_at: IsNull() } });
        const destWasNew = !dest;
        if (!dest) {
          // Tạo mới — copy snapshot từ src để giữ context (first_kitchen_at, customer info)
          dest = orderRepo.create({
            table_id: dest_table_id,
            table_code: destTable.code,
            closed_at: null,
            is_paid: false,
            first_kitchen_at: src.first_kitchen_at,
            created_by_user_id: src.created_by_user_id,
            created_by_full_name: src.created_by_full_name,
            customer_name: destTable.kind === 'delivery' ? src.customer_name : null,
            customer_address: destTable.kind === 'delivery' ? src.customer_address : null,
            customer_phone: destTable.kind === 'delivery' ? src.customer_phone : null,
          });
          await orderRepo.save(dest);
        } else if (!dest.first_kitchen_at && src.first_kitchen_at) {
          await orderRepo.update(dest.id, { first_kitchen_at: src.first_kitchen_at });
        }

        // Move items qua UPDATE thuần — bypass relations management
        const moveResult = await itemRepo
          .createQueryBuilder()
          .update(OrderItem)
          .set({ order_id: dest.id })
          .where('order_id = :sid', { sid: src.id })
          .execute();
        const moved = moveResult.affected || 0;
        movedCount = moved;

        // Sanity check: dest phải có ≥ srcItemCount items TRƯỚC khi xoá src
        const destItemCount = await itemRepo.count({ where: { order_id: dest.id } });
        if (destItemCount < moved) {
          // Lỗi data — throw để rollback transaction (src vẫn còn nguyên)
          throw new Error(
            `Transfer integrity error: moved=${moved} but dest only has ${destItemCount} items`,
          );
        }

        // Chuyển NHẬT KÝ đơn nguồn sang đơn đích — nếu không, xoá src sẽ làm mồ côi
        // toàn bộ log (gọi món/báo bếp/huỷ/giao...) → nhật ký bàn mới bị mất lịch sử.
        await mgr
          .getRepository(OrderActivityLog)
          .createQueryBuilder()
          .update()
          .set({ order_id: dest.id })
          .where('order_id = :sid', { sid: src.id })
          .execute();

        // XOÁ source order — KHÔNG set closed_at (sẽ bị history page hiểu nhầm
        // là đơn cũ đã thanh toán). Source đã rỗng, không còn giá trị giữ lại.
        // Items + nhật ký đã được move (giữ created_at gốc) nên audit trail còn đủ.
        await orderRepo.delete(src.id);

        this.logger.log(
          `transferTable: src=${source_order_id} (${srcItemCount} items, deleted) → dest=${dest.id} ` +
          `(table ${destTable.code}, ${destItemCount} items total), moved=${moved}, dest_new=${destWasNew}`,
        );

        const refreshed = await orderRepo.findOne({ where: { id: dest.id }, relations: ['items'] });
        return refreshed!;
      });

      // Log "chuyển món" trên đơn ĐÍCH (post-commit). Đơn nguồn đã bị xoá.
      await this.writeActivity({
        order: dest,
        event_kind: 'transfer',
        message: `Nhận ${movedCount} món chuyển từ ${srcTableName}`,
        actor,
      });
      return dest;
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException || err instanceof ConflictException) throw err;
      this.logger.error(
        `transferTable failed: src=${source_order_id} dest_table=${dest_table_id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';

export type OrderCreator = { id: string; full_name: string };

// State machine — must match packages/schemas/orders.ts.
// 'SERVED' là shortcut: cho phép skip các bước bếp khi món có sẵn (drink, snack
// lấy ngay từ quầy giao luôn). Không cần đi qua KITCHEN→COOKING→READY.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING:   ['KITCHEN', 'SERVED', 'CANCELLED'],
  KITCHEN:   ['COOKING', 'SERVED', 'CANCELLED'],
  COOKING:   ['READY',   'SERVED', 'CANCELLED'],
  READY:     ['SERVED',  'CANCELLED'],
  SERVED:    [],
  CANCELLED: [],
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(MenuItem) private readonly menuRepo: Repository<MenuItem>,
    @InjectRepository(RestaurantTable) private readonly tableRepo: Repository<RestaurantTable>,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

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

      // 2) FAST PATH — read without lock. 1 SELECT.
      const existing = await this.orderRepo.find({
        where: { table_id, closed_at: IsNull() },
        order: { opened_at: 'ASC' },
      });
      if (existing.length === 1) {
        return existing[0];  // happy path: đã có order, không cần lock
      }

      // 3) SLOW PATH — cần lock cho create hoặc dedupe
      return await this.ds.transaction(async (mgr) => {
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
          if (withItems.length > 0) return withItems[0];
          const keep = lockedExisting[0];
          const toDelete = lockedExisting.slice(1).map((o) => o.id);
          if (toDelete.length > 0) await orderRepo.delete(toDelete);
          return keep;
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
        return order;
      });
    } catch (err) {
      // Re-throw HttpException, log + wrap others
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
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
    return await this.ds.transaction(async (mgr) => {
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
      for (const it of items) {
        const m = menuMap.get(it.menu_item_id)!;
        const entity = itemRepo.create({
          order_id,
          menu_item_id: m.id,
          menu_item_name: m.name,
          menu_item_price: m.price,
          qty: it.qty,
          state,
          note: it.note ?? null,
          cancelled_reason: null,
          created_by_user_id: creator?.id ?? null,
          created_by_full_name: creator?.full_name ?? null,
        });
        const saved = await itemRepo.save(entity);
        created.push(saved);
      }
      if (send_to_kitchen) {
        await this.markFirstKitchenIfNull(mgr, order_id);
      }
      return { items: created, count: created.length, state };
    });
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
    const item = this.itemRepo.create({
      order_id,
      menu_item_id,
      menu_item_name: menu.name,
      menu_item_price: menu.price,
      qty,
      state: 'PENDING',
      note: note ?? null,
      cancelled_reason: null,
      created_by_user_id: creator?.id ?? null,
      created_by_full_name: creator?.full_name ?? null,
    });
    await this.itemRepo.save(item);
    return item;
  }

  /** State transition with validation + snapshot actor (cho notification) */
  async changeItemState(item_id: string, to: string, reason?: string, actor?: OrderCreator) {
    return await this.ds.transaction(async (mgr) => {
      const itemRepo = mgr.getRepository(OrderItem);
      const item = await itemRepo.findOne({ where: { id: item_id } });
      if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item không tồn tại' });
      const allowed = ALLOWED_TRANSITIONS[item.state] || [];
      if (!allowed.includes(to)) {
        throw new BadRequestException({
          code: 'CONFLICT',
          message: `Không thể chuyển từ ${item.state} sang ${to}`,
        });
      }
      item.state = to;
      if (to === 'CANCELLED') {
        if (reason) item.cancelled_reason = reason;
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
    return await this.ds.transaction(async (mgr) => {
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
    status?: 'all' | 'paid' | 'unpaid';
    page?: number;
    page_size?: number;
  }): Promise<{ items: Array<Order & { table_name: string }>; total: number; page: number; page_size: number }> {
    const page = Math.max(1, opts.page || 1);
    const page_size = Math.min(100, Math.max(1, opts.page_size || 20));
    const status = opts.status || 'all';
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'i');

    // WHERE conditions — gom dồn để tránh quirk where('1=1')
    const wheres: string[] = [];
    const params: Record<string, unknown> = {};
    if (status === 'paid') wheres.push('o.closed_at IS NOT NULL');
    else if (status === 'unpaid') wheres.push('o.closed_at IS NULL');
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
    if (wheres.length > 0) qb.where(wheres.join(' AND '), params);

    // Sort: paid order trước (NULL sort cuối ở DESC), trong nhóm sort theo opened_at DESC.
    // Cách này tránh COALESCE trong orderBy vốn lỗi với leftJoinAndSelect + take/skip
    // (TypeORM split query, cột virtual không tồn tại trong subquery distinct-id).
    qb.orderBy('o.closed_at', 'DESC')
      .addOrderBy('o.opened_at', 'DESC')
      .skip((page - 1) * page_size)
      .take(page_size);
    const [orders, total] = await qb.getManyAndCount();

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
  async transferTable(source_order_id: string, dest_table_id: string) {
    try {
      return await this.ds.transaction(async (mgr) => {
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

        // Sanity check: dest phải có ≥ srcItemCount items TRƯỚC khi xoá src
        const destItemCount = await itemRepo.count({ where: { order_id: dest.id } });
        if (destItemCount < moved) {
          // Lỗi data — throw để rollback transaction (src vẫn còn nguyên)
          throw new Error(
            `Transfer integrity error: moved=${moved} but dest only has ${destItemCount} items`,
          );
        }

        // XOÁ source order — KHÔNG set closed_at (sẽ bị history page hiểu nhầm
        // là đơn cũ đã thanh toán). Source đã rỗng, không còn giá trị giữ lại.
        // Items đã được move (giữ created_at gốc + người gọi gốc) nên audit trail còn đủ.
        await orderRepo.delete(src.id);

        this.logger.log(
          `transferTable: src=${source_order_id} (${srcItemCount} items, deleted) → dest=${dest.id} ` +
          `(table ${destTable.code}, ${destItemCount} items total), moved=${moved}, dest_new=${destWasNew}`,
        );

        const refreshed = await orderRepo.findOne({ where: { id: dest.id }, relations: ['items'] });
        return refreshed!;
      });
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(
        `transferTable failed: src=${source_order_id} dest_table=${dest_table_id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }
}

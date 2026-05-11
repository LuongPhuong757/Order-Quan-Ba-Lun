import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';

// State machine — must match packages/schemas/orders.ts
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING:   ['KITCHEN', 'CANCELLED'],
  KITCHEN:   ['COOKING', 'CANCELLED'],
  COOKING:   ['READY',   'CANCELLED'],
  READY:     ['SERVED',  'CANCELLED'],
  SERVED:    [],
  CANCELLED: [],
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(MenuItem) private readonly menuRepo: Repository<MenuItem>,
    @InjectRepository(RestaurantTable) private readonly tableRepo: Repository<RestaurantTable>,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  /** Get or create the open order for a table.
   * Pessimistic-lock pattern để tránh race condition khi nhiều client poll cùng lúc tạo
   * duplicate open orders cho cùng bàn (bug từ session trước). */
  async getOrCreateOpenOrder(table_id: string): Promise<Order> {
    return await this.ds.transaction(async (mgr) => {
      const tableRepo = mgr.getRepository(RestaurantTable);
      const orderRepo = mgr.getRepository(Order);

      const table = await tableRepo.findOne({ where: { id: table_id, is_active: true } });
      if (!table) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });

      // Lock open orders cho bàn này (FOR UPDATE) — ngăn concurrent insert
      const existing = await orderRepo
        .createQueryBuilder('o')
        .where('o.table_id = :tid AND o.closed_at IS NULL', { tid: table_id })
        .orderBy('o.opened_at', 'ASC')
        .setLock('pessimistic_write')
        .getMany();

      if (existing.length > 0) {
        // Nếu lỡ có nhiều open orders (legacy data) → chọn cái có items hoặc cái cũ nhất
        const withItems: Order[] = [];
        for (const o of existing) {
          const cnt = await mgr.getRepository(OrderItem).count({ where: { order_id: o.id } });
          if (cnt > 0) withItems.push(o);
        }
        if (withItems.length > 0) return withItems[0];
        // Tất cả empty — keep oldest, delete rest
        const keep = existing[0];
        const toDelete = existing.slice(1).map((o) => o.id);
        if (toDelete.length > 0) {
          await orderRepo.delete(toDelete);
        }
        return keep;
      }

      const order = orderRepo.create({
        table_id,
        table_code: table.code,
        closed_at: null,
        is_paid: false,
      });
      await orderRepo.save(order);
      return order;
    });
  }

  async listOpenOrders() {
    const orders = await this.orderRepo.find({
      where: { closed_at: IsNull() },
      relations: ['items'],
      order: { opened_at: 'DESC' },
    });
    return orders;
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
        });
        const saved = await itemRepo.save(entity);
        created.push(saved);
      }
      return { items: created, count: created.length, state };
    });
  }

  async addItem(order_id: string, menu_item_id: string, qty: number, note?: string | null) {
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
    });
    await this.itemRepo.save(item);
    return item;
  }

  /** State transition with validation */
  async changeItemState(item_id: string, to: string, reason?: string) {
    const item = await this.itemRepo.findOne({ where: { id: item_id } });
    if (!item) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Item không tồn tại' });
    const allowed = ALLOWED_TRANSITIONS[item.state] || [];
    if (!allowed.includes(to)) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: `Không thể chuyển từ ${item.state} sang ${to}`,
      });
    }
    item.state = to;
    if (to === 'CANCELLED' && reason) item.cancelled_reason = reason;
    await this.itemRepo.save(item);
    return item;
  }

  /** Bulk send PENDING items to kitchen (one click) */
  async sendPendingToKitchen(order_id: string) {
    const result = await this.itemRepo
      .createQueryBuilder()
      .update(OrderItem)
      .set({ state: 'KITCHEN' })
      .where('order_id = :oid AND state = :s', { oid: order_id, s: 'PENDING' })
      .execute();
    return { affected: result.affected || 0 };
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
  async checkout(order_id: string): Promise<{
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

  /** Transfer all items from source table to destination table.
   * Closes source order (if no items remain) and moves items to dest order. */
  async transferTable(source_order_id: string, dest_table_id: string) {
    return await this.ds.transaction(async (mgr) => {
      const orderRepo = mgr.getRepository(Order);
      const itemRepo = mgr.getRepository(OrderItem);
      const tableRepo = mgr.getRepository(RestaurantTable);

      const src = await orderRepo.findOne({ where: { id: source_order_id }, relations: ['items'] });
      if (!src) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Order nguồn không tồn tại' });
      if (src.closed_at) throw new BadRequestException({ code: 'CONFLICT', message: 'Order đã đóng' });

      const destTable = await tableRepo.findOne({ where: { id: dest_table_id, is_active: true } });
      if (!destTable) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn đích không tồn tại' });
      if (src.table_id === dest_table_id) {
        throw new BadRequestException({ code: 'CONFLICT', message: 'Bàn đích trùng bàn nguồn' });
      }

      let dest = await orderRepo.findOne({ where: { table_id: dest_table_id, closed_at: IsNull() } });
      if (!dest) {
        dest = orderRepo.create({
          table_id: dest_table_id,
          table_code: destTable.code,
          closed_at: null,
          is_paid: false,
        });
        await orderRepo.save(dest);
      }

      // Move items
      await itemRepo
        .createQueryBuilder()
        .update(OrderItem)
        .set({ order_id: dest.id })
        .where('order_id = :sid', { sid: src.id })
        .execute();

      // Close source order
      src.closed_at = Date.now();
      await orderRepo.save(src);

      const refreshed = await orderRepo.findOne({ where: { id: dest.id }, relations: ['items'] });
      return refreshed!;
    });
  }
}

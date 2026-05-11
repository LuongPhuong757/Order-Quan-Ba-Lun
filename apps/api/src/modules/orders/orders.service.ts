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

  /** Get or create the open order for a table */
  async getOrCreateOpenOrder(table_id: string): Promise<Order> {
    const table = await this.tableRepo.findOne({ where: { id: table_id, is_active: true } });
    if (!table) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Bàn không tồn tại' });
    let order = await this.orderRepo.findOne({ where: { table_id, closed_at: IsNull() } });
    if (!order) {
      order = this.orderRepo.create({
        table_id,
        table_code: table.code,
        closed_at: null,
        is_paid: false,
      });
      await this.orderRepo.save(order);
    }
    return order;
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

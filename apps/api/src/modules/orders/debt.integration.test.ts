// Integration test cho GHI NỢ KHÁCH (2026-09-25, `docs/GHI-NO-KHACH-SPEC.md`).
//
// Vì sao PHẢI là integration: toàn bộ tính năng là SQL phân loại — `is_paid = 0` giờ có HAI nghĩa
// (huỷ / nợ) và mốc tiền đổi từ `closed_at` sang `COALESCE(debt_paid_at, closed_at)`. Cái sai kinh
// điển ở đây là đơn nợ hiện lên tab "Đã huỷ", hoặc nợ trả hôm 25 mà doanh thu rơi vào hôm 20.
// Fake-repository không chứng minh được câu SQL nào đã chạy.
//
// `import 'dotenv/config'` BẮT BUỘC — xem `open-count.integration.test.ts`.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { dataSourceOptions } from '../../data-source.js';
import { OrdersService } from './orders.service.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from './../tables/entities/restaurant-table.entity.js';
import { OrderActivityLog } from './entities/order-activity-log.entity.js';
import { ConsumptionService } from '../ingredients/consumption.service.js';
import { noOpPrintingService } from '../printing/printing.test-double.js';
import { OrderItemIngredientUsage } from '../ingredients/entities/order-item-ingredient-usage.entity.js';
import { RecipeLine } from '../ingredients/entities/recipe-line.entity.js';
import { Ingredient } from '../ingredients/entities/ingredient.entity.js';

/** Tiền tố sentinel RIÊNG của file này — vitest chạy các file integration song song trên cùng
 *  MySQL, mỗi file một tiền tố để dọn dẹp không đụng nhau. */
const SENTINEL_TABLE_PREFIX = 'debt25-';
const SENTINEL_LIKE = 'debt25-%';

const CASHIER = { id: randomUUID(), full_name: 'Thu ngân test' };
const ADMIN = { id: randomUUID(), full_name: 'Admin test' };

let ds: DataSource;
let svc: OrdersService;
let tableId: string;

async function cleanupSentinelRows(): Promise<void> {
  await ds.query(
    `DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.table_code LIKE ?`,
    [SENTINEL_LIKE],
  );
  await ds.query('DELETE FROM order_activity_logs WHERE table_code LIKE ?', [SENTINEL_LIKE]);
  await ds.query('DELETE FROM orders WHERE table_code LIKE ?', [SENTINEL_LIKE]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ?', [SENTINEL_LIKE]);
}

/** Đơn ĐANG MỞ với các món đã giao — đầu vào cho `checkout()`. */
async function insertOpenOrder(prices: number[]): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source, ship_fee)
     VALUES (?, ?, ?, NOW(6), NULL, 0, 'STAFF', 0)`,
    [id, tableId, `${SENTINEL_TABLE_PREFIX}a`],
  );
  for (const price of prices) {
    await ds.query(
      `INSERT INTO order_items
        (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, created_at, updated_at)
       VALUES (?, ?, NULL, 'Món test', 1, ?, 'SERVED', NOW(6), NOW(6))`,
      [randomUUID(), id, price],
    );
  }
  return id;
}

async function statusOf(id: string): Promise<'paid' | 'debt' | 'cancelled' | 'open'> {
  const o = await ds.getRepository(Order).findOneByOrFail({ id });
  if (o.closed_at === null) return 'open';
  if (o.is_paid) return 'paid';
  return o.debt_at !== null ? 'debt' : 'cancelled';
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này. ' +
        `Lỗi gốc: ${String(err)}`,
    );
  }
  svc = new OrdersService(
    ds.getRepository(Order),
    ds.getRepository(OrderItem),
    ds.getRepository(MenuItem),
    ds.getRepository(RestaurantTable),
    ds.getRepository(OrderActivityLog),
    ds,
    new EventEmitter2(),
    new ConsumptionService(
      ds.getRepository(OrderItemIngredientUsage),
      ds.getRepository(RecipeLine),
      ds.getRepository(Ingredient),
    ),
    noOpPrintingService(),
  );
}, 20_000);

afterAll(async () => {
  await cleanupSentinelRows();
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await cleanupSentinelRows();
  const id = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active)
     VALUES (?, ?, ?, 'dine-in', 0, 0, 1)`,
    [id, `${SENTINEL_TABLE_PREFIX}a`, 'Bàn nợ'],
  );
  tableId = id;
});

describe('ghi nợ lúc thanh toán', () => {
  it('trả bàn nhưng KHÔNG vào doanh thu, KHÔNG phải đơn huỷ', async () => {
    const id = await insertOpenOrder([100_000, 50_000]);
    const r = await svc.checkout(id, CASHIER, false, undefined, { note: 'Anh Tuấn' });
    expect(r.debt).toBe(true);
    expect(r.total).toBe(150_000);
    expect(await statusOf(id)).toBe('debt');

    const s = await svc.stats({ table_id: tableId, status: 'all' });
    expect(s.paid_revenue).toBe(0);
    expect(s.paid_count).toBe(0);
    expect(s.cancelled_count).toBe(0);
    expect(s.debt_count).toBe(1);

    // Tab "Đang nợ": tiền = giá trị khách còn nợ.
    const d = await svc.stats({ table_id: tableId, status: 'debt' });
    expect(d.paid_revenue).toBe(150_000);

    const hist = await svc.listHistory({ table_id: tableId, status: 'debt' });
    expect(hist.items.map((o) => o.id)).toEqual([id]);
    expect(hist.items[0].debt_note).toBe('Anh Tuấn');
    // Không lọt vào tab "Đã huỷ" — đây là cái sai kinh điển cả file này canh.
    const cancelled = await svc.listHistory({ table_id: tableId, status: 'cancelled' });
    expect(cancelled.total).toBe(0);
  }, 20_000);

  it('phần chuyển khoản gửi kèm bị BỎ QUA — nợ là nợ toàn bộ', async () => {
    const id = await insertOpenOrder([80_000]);
    await svc.checkout(id, CASHIER, false, { amount: 30_000 }, { note: 'Chị Hoa' });
    const o = await ds.getRepository(Order).findOneByOrFail({ id });
    expect(o.transfer_amount).toBe(0);
    expect(o.is_paid).toBe(false);
  }, 20_000);

  it('đơn 0đ (huỷ sạch món) không ghi nợ được', async () => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source, ship_fee)
       VALUES (?, ?, ?, NOW(6), NULL, 0, 'STAFF', 0)`,
      [id, tableId, `${SENTINEL_TABLE_PREFIX}a`],
    );
    await ds.query(
      `INSERT INTO order_items
        (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, created_at, updated_at)
       VALUES (?, ?, NULL, 'Món test', 1, 50000, 'CANCELLED', NOW(6), NOW(6))`,
      [randomUUID(), id],
    );
    await expect(svc.checkout(id, CASHIER, false, undefined, { note: 'Ai đó' })).rejects.toThrow();
    expect(await statusOf(id)).toBe('open');
  }, 20_000);
});

describe('thu nợ', () => {
  it('đưa đơn vào doanh thu, đối soát rơi vào NGÀY THU NỢ, ghi người thu riêng', async () => {
    const id = await insertOpenOrder([120_000]);
    await svc.checkout(id, CASHIER, false, undefined, { note: 'Anh Tuấn' });
    // Giả lập trả bàn từ 10 ngày trước — mốc tiền phải là hôm nay, không phải hôm đó.
    await ds.query('UPDATE orders SET closed_at = DATE_SUB(NOW(6), INTERVAL 10 DAY) WHERE id = ?', [id]);

    const r = await svc.settleDebt(id, ADMIN, true, { amount: 120_000, qr_label: 'TK test' });
    expect(r.transfer_amount).toBe(120_000);
    expect(await statusOf(id)).toBe('paid');

    const o = await ds.getRepository(Order).findOneByOrFail({ id });
    expect(o.debt_paid_at).not.toBeNull();
    expect(o.debt_paid_by_full_name).toBe('Admin test');
    expect(o.checked_out_by_full_name).toBe('Thu ngân test'); // người trả bàn giữ nguyên
    expect(o.misa_copied_at).not.toBeNull();

    const todayStart = Date.now() - 60 * 60 * 1000;
    const today = await svc.paymentSummary({ start_ms: todayStart });
    // Lọc thêm theo bàn không có ở paymentSummary → dùng stats (có table_id) cho con số tuyệt đối.
    const s = await svc.stats({ table_id: tableId, status: 'all', start_ms: todayStart });
    expect(s.paid_revenue).toBe(120_000);
    expect(s.debt_count).toBe(0);
    // Ngày trả bàn (10 ngày trước) KHÔNG còn đơn nào có tiền.
    const oldDay = await svc.stats({
      table_id: tableId,
      status: 'all',
      start_ms: Date.now() - 11 * 24 * 3600 * 1000,
      end_ms: Date.now() - 9 * 24 * 3600 * 1000,
    });
    expect(oldDay.paid_revenue).toBe(0);
    expect(today.debt_outstanding.orders).toBeGreaterThanOrEqual(0);
  }, 20_000);

  it('thu nợ lần hai bị chặn; đơn thường không "thu nợ" được', async () => {
    const id = await insertOpenOrder([10_000]);
    await svc.checkout(id, CASHIER, false, undefined, { note: 'X' });
    await svc.settleDebt(id, CASHIER);
    await expect(svc.settleDebt(id, CASHIER)).rejects.toThrow();

    const normal = await insertOpenOrder([10_000]);
    await svc.checkout(normal, CASHIER);
    await expect(svc.settleDebt(normal, CASHIER)).rejects.toThrow();
  }, 20_000);
});

describe('admin chuyển đơn đã thu sang nợ', () => {
  it('rút khỏi doanh thu, xoá phần chuyển khoản đã ghi, giữ người trả bàn', async () => {
    const id = await insertOpenOrder([90_000]);
    await svc.checkout(id, CASHIER, true, { amount: 90_000, qr_label: 'TK test' });
    expect(await statusOf(id)).toBe('paid');

    await svc.markAsDebt(id, 'Khách quen bàn 3', ADMIN);
    expect(await statusOf(id)).toBe('debt');
    const o = await ds.getRepository(Order).findOneByOrFail({ id });
    expect(o.transfer_amount).toBe(0);
    expect(o.payment_qr_label).toBeNull();
    expect(o.misa_copied_at).toBeNull();
    expect(o.checked_out_by_full_name).toBe('Thu ngân test');

    const s = await svc.stats({ table_id: tableId, status: 'all' });
    expect(s.paid_revenue).toBe(0);
    expect(s.debt_count).toBe(1);

    // Đường vòng đầy đủ: thu nợ lại được.
    await svc.settleDebt(id, CASHIER);
    expect(await statusOf(id)).toBe('paid');
  }, 20_000);

  it('đơn đã HUỶ hoặc đang mở không chuyển sang nợ được', async () => {
    const open = await insertOpenOrder([10_000]);
    await expect(svc.markAsDebt(open, 'X', ADMIN)).rejects.toThrow();

    const cancelled = randomUUID();
    await ds.query(
      `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source, ship_fee)
       VALUES (?, ?, ?, NOW(6), NOW(6), 0, 'STAFF', 0)`,
      [cancelled, tableId, `${SENTINEL_TABLE_PREFIX}a`],
    );
    await expect(svc.markAsDebt(cancelled, 'X', ADMIN)).rejects.toThrow();
    expect(await statusOf(cancelled)).toBe('cancelled');
  }, 20_000);
});

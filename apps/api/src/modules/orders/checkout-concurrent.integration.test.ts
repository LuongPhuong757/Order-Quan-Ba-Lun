// Integration test: HAI máy bấm "Thanh toán" cùng lúc cho CÙNG một đơn (2026-11-10).
//
// Lỗi gốc (báo cáo QA test/full-flow, BUG-01): `checkout()` đọc đơn bằng `findOne` KHÔNG khoá
// dòng rồi mới kiểm `closed_at`. Hai giao dịch chạy song song cùng đọc thấy `closed_at = NULL`,
// cùng chốt → đơn có 2 dòng nhật ký "checkout", 2 phiếu in, thu ngân tưởng thu 2 lần.
//
// Phải là integration (MySQL thật): chỉ khoá dòng InnoDB thật mới chứng minh được request thứ hai
// phải ĐỢI request đầu rồi thấy đơn đã đóng. Mock repository không có khái niệm khoá.
//
// `import 'dotenv/config'` BẮT BUỘC — xem chú thích ở `kitchen-count.integration.test.ts`.
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

/** Tiền tố sentinel RIÊNG của file này — xem chú thích ở `open-count.integration.test.ts`. */
const SENTINEL_LIKE = 'ckcc-%';

let ds: DataSource;
let svc: OrdersService;

async function cleanupSentinelRows(): Promise<void> {
  await ds.query(
    `DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.table_code LIKE ?`,
    [SENTINEL_LIKE],
  );
  await ds.query('DELETE FROM order_activity_logs WHERE table_code LIKE ?', [SENTINEL_LIKE]);
  await ds.query('DELETE FROM orders WHERE table_code LIKE ?', [SENTINEL_LIKE]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ?', [SENTINEL_LIKE]);
}

/** Bàn + đơn đang mở có 2 món đã ra, mỗi món 3 × 10.000đ. */
async function openOrderWithItems(code: string): Promise<string> {
  const tableId = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active) VALUES (?, ?, ?, 'dine-in', 0, 0, 1)`,
    [tableId, code, `Bàn ${code}`],
  );
  const id = randomUUID();
  await ds.query(
    `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source)
     VALUES (?, ?, ?, NOW(6), NULL, 0, 'STAFF')`,
    [id, tableId, code],
  );
  for (let i = 0; i < 2; i++) {
    await ds.query(
      `INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, created_at, updated_at)
       VALUES (?, ?, NULL, 'Món test', 3, 10000, 'SERVED', NOW(6), NOW(6))`,
      [randomUUID(), id],
    );
  }
  return id;
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql`), rồi chạy lại ' +
        '`pnpm --filter @order/api test -- checkout-concurrent.integration.test.ts`. ' +
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
});

const CASHIER_1 = { id: randomUUID(), full_name: 'Máy 1' };
const CASHIER_2 = { id: randomUUID(), full_name: 'Máy 2' };

describe('checkout() — hai máy bấm Thanh toán cùng lúc', () => {
  it('chỉ MỘT lần chốt thành công, lần kia bị từ chối vì đơn đã thanh toán', async () => {
    const id = await openOrderWithItems(`ckcc-${randomUUID().slice(0, 8)}`);

    const results = await Promise.allSettled([svc.checkout(id, CASHIER_1), svc.checkout(id, CASHIER_2)]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(JSON.stringify(rejected[0].reason?.response ?? String(rejected[0].reason))).toContain('đã thanh toán');
  });

  it('chỉ ghi MỘT dòng nhật ký "checkout" cho đơn', async () => {
    const id = await openOrderWithItems(`ckcc-${randomUUID().slice(0, 8)}`);

    await Promise.allSettled([
      svc.checkout(id, CASHIER_1),
      svc.checkout(id, CASHIER_2),
      svc.checkout(id, { id: randomUUID(), full_name: 'Máy 3' }),
    ]);

    const [{ n }] = await ds.query(
      `SELECT COUNT(*) AS n FROM order_activity_logs WHERE order_id = ? AND event_kind = 'checkout'`,
      [id],
    );
    expect(Number(n)).toBe(1);
  });

  it('thanh toán tuần tự lần 2 vẫn bị chặn như cũ', async () => {
    const id = await openOrderWithItems(`ckcc-${randomUUID().slice(0, 8)}`);
    const first = await svc.checkout(id, CASHIER_1);
    expect(first.total).toBe(60_000);
    await expect(svc.checkout(id, CASHIER_1)).rejects.toThrow();
  });
});

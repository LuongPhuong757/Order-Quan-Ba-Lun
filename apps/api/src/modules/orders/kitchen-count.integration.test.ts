// Integration test cho `countKitchenPendingItems` — badge số món chờ bếp ở nav dưới (2026-09-07).
//
// Vì sao PHẢI là integration, không mock: rủi ro duy nhất đáng test là câu COUNT có đếm CÙNG tập
// dòng mà cột "Đã order" của màn Bếp vẽ hay không. Màn Bếp lấy `listOpenOrders()` rồi lọc
// `state === 'KITCHEN'`; ở đây là một câu SQL khác hẳn (JOIN thay vì EXISTS). Hai đường đi khác
// nhau tới cùng một con số — chỉ SQL thật mới chứng minh được chúng khớp.
//
// Test so CHÊNH LỆCH trước/sau chứ không so số tuyệt đối: DB local còn dữ liệu của lần chạy dev
// trước, và các file integration khác chạy song song trên cùng MySQL.
//
// `import 'dotenv/config'` BẮT BUỘC: `data-source.ts` đọc `process.env.MYSQL_PORT` trực tiếp,
// thiếu dòng này là nối vào cổng 3306 sai (container map 3307).
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
import { OrderItemIngredientUsage } from '../ingredients/entities/order-item-ingredient-usage.entity.js';
import { RecipeLine } from '../ingredients/entities/recipe-line.entity.js';
import { Ingredient } from '../ingredients/entities/ingredient.entity.js';

/** Tiền tố sentinel RIÊNG của file này — xem chú thích cùng nội dung ở `open-count.integration.test.ts`. */
const SENTINEL_TABLE_PREFIX = 'kcnt-';
const SENTINEL_LIKE = 'kcnt-%';

let ds: DataSource;
let svc: OrdersService;

async function cleanupSentinelRows(): Promise<void> {
  await ds.query(
    `DELETE oi FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.table_code LIKE ?`,
    [SENTINEL_LIKE],
  );
  await ds.query('DELETE FROM order_activity_logs WHERE table_code LIKE ?', [SENTINEL_LIKE]);
  await ds.query('DELETE FROM orders WHERE table_code LIKE ?', [SENTINEL_LIKE]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ?', [SENTINEL_LIKE]);
}

async function insertTable(code: string): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active)
     VALUES (?, ?, ?, 'dine-in', 0, 0, 1)`,
    [id, code, `Bàn ${code}`],
  );
  return id;
}

/** Tạo 1 order kèm món. `closedAt=null` = bàn chưa thanh toán. */
async function insertOrder(opts: {
  tableId: string;
  tableCode: string;
  closedAt: Date | null;
  itemStates: string[];
}): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source)
     VALUES (?, ?, ?, NOW(6), ?, ?, 'STAFF')`,
    [id, opts.tableId, opts.tableCode, opts.closedAt, opts.closedAt ? 1 : 0],
  );
  for (const state of opts.itemStates) {
    await ds.query(
      `INSERT INTO order_items
        (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, created_at, updated_at)
       VALUES (?, ?, NULL, 'Món test', 3, 10000, ?, NOW(6), NOW(6))`,
      [randomUUID(), id, state],
    );
  }
  return id;
}

/** Đếm lại đúng cách màn Bếp đếm: từ `listOpenOrders()` rồi lọc state KITCHEN. */
function countFromOpenOrders(orders: Array<{ items?: OrderItem[] }>): number {
  return orders.reduce(
    (n, o) => n + (o.items || []).filter((it) => it.state === 'KITCHEN').length,
    0,
  );
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql`), rồi chạy lại ' +
        '`pnpm --filter @order/api test -- kitchen-count.integration.test.ts`. ' +
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
  );
}, 20_000);

afterAll(async () => {
  await cleanupSentinelRows();
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await cleanupSentinelRows();
});

describe('countKitchenPendingItems — badge "Bếp" ở nav dưới', () => {
  it('đếm đúng số DÒNG state KITCHEN của đơn chưa đóng, khớp với cột "Đã order" của màn Bếp', async () => {
    const before = await svc.countKitchenPendingItems();
    expect(before).toBe(countFromOpenOrders(await svc.listOpenOrders()));

    const t1 = await insertTable(`${SENTINEL_TABLE_PREFIX}a`);
    const t2 = await insertTable(`${SENTINEL_TABLE_PREFIX}b`);
    const t3 = await insertTable(`${SENTINEL_TABLE_PREFIX}c`);

    // +3 dòng chờ bếp: 2 ở bàn a, 1 ở bàn b. Món đang nấu / đã xong / chưa gửi bếp / đã huỷ
    // KHÔNG được tính — chúng nằm ở cột khác (hoặc chưa xuống bếp).
    await insertOrder({
      tableId: t1,
      tableCode: `${SENTINEL_TABLE_PREFIX}a`,
      closedAt: null,
      itemStates: ['KITCHEN', 'KITCHEN', 'COOKING', 'PENDING'],
    });
    await insertOrder({
      tableId: t2,
      tableCode: `${SENTINEL_TABLE_PREFIX}b`,
      closedAt: null,
      itemStates: ['KITCHEN', 'READY', 'CANCELLED'],
    });
    // Bàn đã thanh toán: dù còn sót dòng KITCHEN cũng không phải việc của bếp nữa.
    await insertOrder({
      tableId: t3,
      tableCode: `${SENTINEL_TABLE_PREFIX}c`,
      closedAt: new Date(),
      itemStates: ['KITCHEN'],
    });

    const after = await svc.countKitchenPendingItems();
    expect(after - before).toBe(3);

    // Bất biến thật sự cần giữ: badge và cột "Đã order" nói cùng một con số. Món chèn ở đây có
    // qty=3, nên phép so này cũng chốt luôn việc KHÔNG nhân qty.
    expect(after).toBe(countFromOpenOrders(await svc.listOpenOrders()));
  }, 20_000);
});

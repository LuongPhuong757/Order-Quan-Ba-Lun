// Integration test cho `countOpenOrders` — badge số bàn đang mở ở nav dưới (2026-08-06).
//
// Vì sao PHẢI là integration, không mock: rủi ro duy nhất đáng test của hàm này là câu COUNT có
// đếm CÙNG tập dòng với `listOpenOrders` hay không. Đó là hành vi của SQL thật (subquery EXISTS
// trên `order_items.state`), fake-repository không chứng minh được gì. Badge lệch với sơ đồ bàn là
// lỗi nhân viên nhìn thấy ngay và mất tin vào cả hai con số.
//
// Test gọi CẢ HAI hàm trên cùng dữ liệu rồi so — đó là bất biến cần giữ, không phải một con số
// tuyệt đối (DB local có dữ liệu thật của lần chạy dev trước).
//
// `import 'dotenv/config'` BẮT BUỘC: `data-source.ts` đọc `process.env.MYSQL_PORT` trực tiếp,
// thiếu dòng này là nối vào cổng 3306 sai (container map 3307) — xem chú thích cùng nội dung ở
// `public/open-order-lock.integration.test.ts`.
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

/** Tiền tố sentinel RIÊNG của file này — mỗi file integration một tiền tố, vì vitest chạy các file
 * song song trên cùng MySQL và mỗi file đều `DELETE ... LIKE <tiền tố>` ở beforeEach. Dùng chung
 * tiền tố là file này xoá dữ liệu của file kia giữa chừng → flaky chỉ khi chạy cả suite. */
const SENTINEL_TABLE_PREFIX = 'cnt90-';
const SENTINEL_LIKE = 'cnt90-%';

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
       VALUES (?, ?, NULL, 'Món test', 1, 10000, ?, NOW(6), NOW(6))`,
      [randomUUID(), id, state],
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
        '`pnpm --filter @order/api test -- open-count.integration.test.ts`. ' +
        `Lỗi gốc: ${String(err)}`,
    );
  }
  // Không bootstrap Nest — dựng service bằng tay với repo thật, đúng hướng nhẹ của các file
  // integration khác trong repo.
  svc = new OrdersService(
    ds.getRepository(Order),
    ds.getRepository(OrderItem),
    ds.getRepository(MenuItem),
    ds.getRepository(RestaurantTable),
    ds.getRepository(OrderActivityLog),
    ds,
    new EventEmitter2(),
  );
}, 20_000);

afterAll(async () => {
  await cleanupSentinelRows();
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await cleanupSentinelRows();
});

describe('countOpenOrders — badge "Order" ở nav dưới', () => {
  it('đếm ĐÚNG BẰNG số dòng listOpenOrders trả về, kể cả khi có phantom order', async () => {
    const before = await svc.countOpenOrders();
    const beforeList = (await svc.listOpenOrders()).length;
    expect(before).toBe(beforeList);

    const t1 = await insertTable(`${SENTINEL_TABLE_PREFIX}a`);
    const t2 = await insertTable(`${SENTINEL_TABLE_PREFIX}b`);
    const t3 = await insertTable(`${SENTINEL_TABLE_PREFIX}c`);
    const t4 = await insertTable(`${SENTINEL_TABLE_PREFIX}d`);
    const t5 = await insertTable(`${SENTINEL_TABLE_PREFIX}e`);

    // +2 bàn đang mở thật
    await insertOrder({ tableId: t1, tableCode: `${SENTINEL_TABLE_PREFIX}a`, closedAt: null, itemStates: ['PENDING'] });
    await insertOrder({ tableId: t2, tableCode: `${SENTINEL_TABLE_PREFIX}b`, closedAt: null, itemStates: ['READY', 'CANCELLED'] });
    // Phantom 1: mở nhưng 0 món (nhân viên tap mở drawer rồi thoát)
    await insertOrder({ tableId: t3, tableCode: `${SENTINEL_TABLE_PREFIX}c`, closedAt: null, itemStates: [] });
    // Phantom 2: mở nhưng huỷ hết món
    await insertOrder({ tableId: t4, tableCode: `${SENTINEL_TABLE_PREFIX}d`, closedAt: null, itemStates: ['CANCELLED', 'CANCELLED'] });
    // Đã thanh toán → không phải bàn đang mở
    await insertOrder({ tableId: t5, tableCode: `${SENTINEL_TABLE_PREFIX}e`, closedAt: new Date(), itemStates: ['SERVED'] });

    const after = await svc.countOpenOrders();
    const afterList = (await svc.listOpenOrders()).length;

    expect(after - before).toBe(2);
    // Bất biến thật sự cần giữ: badge và sơ đồ bàn nói cùng một con số.
    expect(after).toBe(afterList);
  }, 20_000);
});

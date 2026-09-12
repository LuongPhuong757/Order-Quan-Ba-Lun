// Integration test cho CHUYỂN BÀN — giờ vào ăn phải theo lượt khách, không theo giờ bấm nút
// (bug production 2026-09-10: nhật ký đơn hiện "mở 21:27" trùng luôn giờ thanh toán, trong khi
// dòng "Mở đơn mới" ngay bên dưới ghi 20:28).
//
// Vì sao PHẢI là integration: thứ đáng test là dòng `orders` mà `transferTable` GHI XUỐNG DB có
// mang `opened_at` gốc hay không. `opened_at` là `@CreateDateColumn`, ai ghi đè giá trị đó là
// TypeORM + driver quyết định lúc insert thật — fake-repository không chứng minh được. Câu chữ
// của log đã có test thuần riêng ở `transfer-log.test.ts`.
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
import { fmtVnDateTime } from './transfer-log.js';

/** Tiền tố sentinel RIÊNG của file này (mỗi file integration một tiền tố — xem chú thích ở
 * `open-count.integration.test.ts`). Giới hạn `restaurant_tables.code` là varchar(16). */
const P = 'xfer910-';
const LIKE = 'xfer910-%';

const H = 60 * 60 * 1000;
const NV = { id: randomUUID(), full_name: 'Nguyễn Thắng' };

let ds: DataSource;
let svc: OrdersService;

async function cleanupSentinelRows(): Promise<void> {
  await ds.query(
    `DELETE oi FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE o.table_code LIKE ?`,
    [LIKE],
  );
  await ds.query('DELETE FROM order_activity_logs WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM orders WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ?', [LIKE]);
}

async function insertTable(code: string, name: string): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active)
     VALUES (?, ?, ?, 'dine-in', 0, 0, 1)`,
    [id, code, name],
  );
  return id;
}

/** Đơn đang mở với giờ mở LÙI VỀ QUÁ KHỨ + `itemCount` món đã giao. */
async function insertOpenOrder(opts: {
  tableId: string;
  tableCode: string;
  openedAgoMs: number;
  itemCount: number;
}): Promise<{ id: string; opened_at: number }> {
  const id = randomUUID();
  const opened = new Date(Date.now() - opts.openedAgoMs);
  await ds.query(
    `INSERT INTO orders
       (id, table_id, table_code, opened_at, closed_at, is_paid, source,
        created_by_user_id, created_by_full_name)
     VALUES (?, ?, ?, ?, NULL, 0, 'STAFF', ?, ?)`,
    [id, opts.tableId, opts.tableCode, opened, NV.id, NV.full_name],
  );
  for (let i = 0; i < opts.itemCount; i++) {
    await ds.query(
      `INSERT INTO order_items
        (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, created_at, updated_at)
       VALUES (?, ?, NULL, 'Món test', 1, 10000, 'SERVED', ?, ?)`,
      [randomUUID(), id, opened, opened],
    );
  }
  // Nhật ký của lượt khách: snapshot `order_opened_at` đúng như đường chạy thật.
  await ds.query(
    `INSERT INTO order_activity_logs
       (id, order_id, item_id, table_id, table_code, order_opened_at, event_kind, message,
        actor_id, actor_name, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, 'order_created', 'Mở đơn mới', ?, ?, ?)`,
    [randomUUID(), id, opts.tableId, opts.tableCode, opened, NV.id, NV.full_name, opened],
  );
  return { id, opened_at: opened.getTime() };
}

async function readOrder(id: string): Promise<Order | null> {
  return ds.getRepository(Order).findOne({ where: { id } });
}

async function activityOf(order_id: string): Promise<OrderActivityLog[]> {
  return ds.getRepository(OrderActivityLog).find({
    where: { order_id },
    order: { created_at: 'ASC' },
  });
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql`), rồi chạy lại ' +
        '`pnpm --filter @order/api test -- transfer-table.integration.test.ts`. ' +
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

describe('transferTable — giờ vào ăn sau khi chuyển bàn', () => {
  it('bàn đích TRỐNG → đơn mới giữ nguyên giờ mở gốc, không lấy giờ bấm chuyển', async () => {
    const srcCode = `${P}a1`;
    const destCode = `${P}a2`;
    const srcTableId = await insertTable(srcCode, 'Bàn 48');
    const destTableId = await insertTable(destCode, 'Bàn 49');
    const src = await insertOpenOrder({
      tableId: srcTableId,
      tableCode: srcCode,
      openedAgoMs: 1 * H,
      itemCount: 6,
    });

    const dest = await svc.transferTable(src.id, destTableId);

    // Đây là cả cái bug: trước khi sửa `opened_at` là NOW nên header nhật ký hiện đúng giờ
    // bấm chuyển bàn, trùng luôn giờ thanh toán ngay sau đó.
    const after = await readOrder(dest.id);
    expect(after!.opened_at).toBe(src.opened_at);
    expect(Date.now() - after!.opened_at).toBeGreaterThan(H - 60_000);
    // Đơn nguồn bị xoá (không set closed_at — xem chú thích trong transferTable).
    expect(await readOrder(src.id)).toBeNull();
  }, 20_000);

  it('nhật ký dời sang mang snapshot giờ mở khớp đơn đích, và log chuyển bàn ghi giờ mở gốc', async () => {
    const srcCode = `${P}b1`;
    const destCode = `${P}b2`;
    const srcTableId = await insertTable(srcCode, 'Bàn 48');
    const destTableId = await insertTable(destCode, 'Bàn 49');
    const src = await insertOpenOrder({
      tableId: srcTableId,
      tableCode: srcCode,
      openedAgoMs: 1 * H,
      itemCount: 6,
    });

    const dest = await svc.transferTable(src.id, destTableId, NV);

    const logs = await activityOf(dest.id);
    // Log cũ của lượt khách phải theo sang, giữ nguyên `created_at` gốc.
    expect(logs.map((l) => l.event_kind)).toEqual(['order_created', 'transfer']);
    expect(logs[0].message).toBe('Mở đơn mới');
    // Snapshot dùng để tách lượt khách trên cùng 1 bàn — phải khớp đơn đang giữ log.
    const after = await readOrder(dest.id);
    for (const l of logs) expect(l.order_opened_at).toBe(after!.opened_at);
    // "Lưu cả log chuyển bàn": ai chuyển, mấy món, từ bàn nào, lượt khách mở lúc nào.
    expect(logs[1].message).toBe(`Nhận 6 món chuyển từ Bàn 48 (mở ${fmtVnDateTime(src.opened_at)})`);
    expect(logs[1].actor_name).toBe(NV.full_name);
  }, 20_000);

  it('bàn đích ĐANG CÓ KHÁCH (gộp bàn) → giữ giờ mở của bàn đích, giờ mở bên nguồn nằm lại trong log', async () => {
    const srcCode = `${P}c1`;
    const destCode = `${P}c2`;
    const srcTableId = await insertTable(srcCode, 'Bàn 48');
    const destTableId = await insertTable(destCode, 'Bàn 49');
    const dest0 = await insertOpenOrder({
      tableId: destTableId,
      tableCode: destCode,
      openedAgoMs: 2 * H,
      itemCount: 2,
    });
    const src = await insertOpenOrder({
      tableId: srcTableId,
      tableCode: srcCode,
      openedAgoMs: 1 * H,
      itemCount: 6,
    });

    const dest = await svc.transferTable(src.id, destTableId);

    // Đơn đích đang chạy: đổi `opened_at` của nó là xê dịch cả ngày lên bill của khách đó.
    expect(dest.id).toBe(dest0.id);
    const after = await readOrder(dest0.id);
    expect(after!.opened_at).toBe(dest0.opened_at);
    const items = await ds.getRepository(OrderItem).count({ where: { order_id: dest0.id } });
    expect(items).toBe(8);
    // Giờ mở bên nguồn không còn dòng `orders` nào giữ → phải đọc lại được từ câu log.
    const logs = await activityOf(dest0.id);
    const transfer = logs.find((l) => l.event_kind === 'transfer')!;
    expect(transfer.message).toContain(`(mở ${fmtVnDateTime(src.opened_at)})`);
    for (const l of logs) expect(l.order_opened_at).toBe(dest0.opened_at);
  }, 20_000);
});

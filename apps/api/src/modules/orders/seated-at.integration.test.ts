// Integration test cho GIỜ VÀO ĂN — `opened_at` phải là lúc gọi món đầu tiên, không phải lúc
// nhân viên mở drawer (bug production 2026-09-10: "mở bàn ra chọn món lại thoát ra nhưng vẫn
// lưu thời gian vào bàn dù bàn chưa có người"). Xem `seated-at.ts` để biết bug gốc.
//
// Vì sao PHẢI là integration: thứ đáng test là dòng `orders` GHI XUỐNG DB sau khi thêm món, và
// `opened_at` là `@CreateDateColumn` — ai được phép ghi đè giá trị đó là TypeORM quyết định lúc
// chạy thật. Ngưỡng ghi nhật ký đã có test thuần riêng ở `seated-at.test.ts`.
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

/** Tiền tố sentinel RIÊNG của file này (mỗi file integration một tiền tố — xem chú thích ở
 * `open-count.integration.test.ts`). Giới hạn `restaurant_tables.code` là varchar(16). */
const P = 'seat910-';
const LIKE = 'seat910-%';

const M = 60 * 1000;
const NV_TAP = { id: randomUUID(), full_name: 'Nhân viên tap nhầm' };
const NV_GOI = { id: randomUUID(), full_name: 'Nhân viên gọi món' };

let ds: DataSource;
let svc: OrdersService;
let menuItemId: string;

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
  await ds.query('DELETE FROM menu_items WHERE code LIKE ?', [LIKE]);
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

async function insertMenuItem(): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO menu_items (id, code, name, \`group\`, unit, price, is_active, is_out_of_stock)
     VALUES (?, ?, ?, 'mon', 'phần', 50000, 1, 0)`,
    [id, `${P}m1`, `${P}món`],
  );
  return id;
}

/** Đơn RỖNG mở từ `openedAgoMs` trước — đúng cảnh nhân viên tap mở drawer rồi thoát. */
async function insertEmptyOpenOrder(opts: {
  tableId: string;
  tableCode: string;
  openedAgoMs: number;
  source?: string;
}): Promise<{ id: string; opened_at: number }> {
  const id = randomUUID();
  const opened = new Date(Date.now() - opts.openedAgoMs);
  await ds.query(
    `INSERT INTO orders
       (id, table_id, table_code, opened_at, closed_at, is_paid, source,
        created_by_user_id, created_by_full_name)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?, ?)`,
    [id, opts.tableId, opts.tableCode, opened, opts.source ?? 'STAFF', NV_TAP.id, NV_TAP.full_name],
  );
  await ds.query(
    `INSERT INTO order_activity_logs
       (id, order_id, item_id, table_id, table_code, order_opened_at, event_kind, message,
        actor_id, actor_name, created_at)
     VALUES (?, ?, NULL, ?, ?, ?, 'order_created', 'Mở đơn mới', ?, ?, ?)`,
    [randomUUID(), id, opts.tableId, opts.tableCode, opened, NV_TAP.id, NV_TAP.full_name, opened],
  );
  return { id, opened_at: opened.getTime() };
}

async function readOrder(id: string): Promise<Order | null> {
  return ds.getRepository(Order).findOne({ where: { id } });
}

async function activityOf(order_id: string): Promise<OrderActivityLog[]> {
  return ds
    .getRepository(OrderActivityLog)
    .find({ where: { order_id }, order: { created_at: 'ASC' } });
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql`), rồi chạy lại ' +
        '`pnpm --filter @order/api test -- seated-at.integration.test.ts`. ' +
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
  await cleanupSentinelRows();
  menuItemId = await insertMenuItem();
}, 20_000);

afterAll(async () => {
  await cleanupSentinelRows();
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await ds.query(
    `DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.table_code LIKE ?`,
    [LIKE],
  );
  await ds.query('DELETE FROM order_activity_logs WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM orders WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ?', [LIKE]);
});

describe('giờ vào ăn tính từ món đầu tiên', () => {
  it('bàn mở trống 47 phút rồi mới gọi món → giờ vào + người mở tính lại từ lúc gọi', async () => {
    const code = `${P}a`;
    const tableId = await insertTable(code);
    const o = await insertEmptyOpenOrder({ tableId, tableCode: code, openedAgoMs: 47 * M });

    await svc.addItemsBulk(o.id, [{ menu_item_id: menuItemId, qty: 2 }], true, NV_GOI);

    const after = await readOrder(o.id);
    // Đây là cả cái bug: trước khi sửa `opened_at` vẫn là 47 phút trước — giờ tap nhầm.
    expect(Date.now() - after!.opened_at).toBeLessThan(60_000);
    expect(after!.created_by_full_name).toBe(NV_GOI.full_name);
  }, 20_000);

  it('ghi 1 dòng nhật ký giải thích, và mọi log của đơn trỏ về mốc mới', async () => {
    const code = `${P}b`;
    const tableId = await insertTable(code);
    const o = await insertEmptyOpenOrder({ tableId, tableCode: code, openedAgoMs: 47 * M });

    await svc.addItemsBulk(o.id, [{ menu_item_id: menuItemId, qty: 1 }], true, NV_GOI);

    const logs = await activityOf(o.id);
    expect(logs.map((l) => l.event_kind)).toEqual(['order_created', 'order_restarted', 'items_added']);
    expect(logs[1].message).toContain('47 phút');
    // Snapshot tách lượt khách — để nguyên là log trỏ về một mốc không còn tồn tại.
    const after = await readOrder(o.id);
    for (const l of logs) expect(l.order_opened_at).toBe(after!.opened_at);
  }, 20_000);

  it('mở drawer rồi gọi luôn → vẫn dời mốc nhưng KHÔNG thêm dòng nhật ký nhiễu', async () => {
    const code = `${P}c`;
    const tableId = await insertTable(code);
    const o = await insertEmptyOpenOrder({ tableId, tableCode: code, openedAgoMs: 30 * 1000 });

    await svc.addItemsBulk(o.id, [{ menu_item_id: menuItemId, qty: 1 }], true, NV_GOI);

    const logs = await activityOf(o.id);
    expect(logs.map((l) => l.event_kind)).toEqual(['order_created', 'items_added']);
  }, 20_000);

  it('món THỨ HAI không dời mốc nữa — giờ vào ăn giữ nguyên suốt bữa', async () => {
    const code = `${P}d`;
    const tableId = await insertTable(code);
    const o = await insertEmptyOpenOrder({ tableId, tableCode: code, openedAgoMs: 47 * M });

    await svc.addItemsBulk(o.id, [{ menu_item_id: menuItemId, qty: 1 }], true, NV_GOI);
    const firstOpened = (await readOrder(o.id))!.opened_at;
    await svc.addItemsBulk(o.id, [{ menu_item_id: menuItemId, qty: 1 }], true, NV_GOI);

    expect((await readOrder(o.id))!.opened_at).toBe(firstOpened);
  }, 20_000);

  it('ghi chú cho bếp cũng chốt được giờ vào ăn (bàn đã có người ngồi)', async () => {
    const code = `${P}e`;
    const tableId = await insertTable(code);
    const o = await insertEmptyOpenOrder({ tableId, tableCode: code, openedAgoMs: 47 * M });

    await svc.addServiceNote(o.id, 'Lấy thêm bát', true, NV_GOI);

    expect(Date.now() - (await readOrder(o.id))!.opened_at).toBeLessThan(60_000);
  }, 20_000);

  it('gọi món lẻ (addItem) cũng chốt giờ vào ăn', async () => {
    const code = `${P}f`;
    const tableId = await insertTable(code);
    const o = await insertEmptyOpenOrder({ tableId, tableCode: code, openedAgoMs: 47 * M });

    await svc.addItem(o.id, menuItemId, 1, null, NV_GOI);

    expect(Date.now() - (await readOrder(o.id))!.opened_at).toBeLessThan(60_000);
  }, 20_000);

  it('đơn ONLINE KHÔNG bị dời mốc — `opened_at` ở đó là giờ duyệt đơn, đã đúng', async () => {
    const code = `${P}g`;
    const tableId = await insertTable(code);
    const o = await insertEmptyOpenOrder({
      tableId,
      tableCode: code,
      openedAgoMs: 47 * M,
      source: 'ONLINE',
    });

    await svc.addItemsBulk(o.id, [{ menu_item_id: menuItemId, qty: 1 }], true, NV_GOI);

    expect((await readOrder(o.id))!.opened_at).toBe(o.opened_at);
  }, 20_000);
});

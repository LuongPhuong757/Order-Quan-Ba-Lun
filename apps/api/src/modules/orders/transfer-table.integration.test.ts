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

/** Đơn đang mở với giờ mở LÙI VỀ QUÁ KHỨ + `itemCount` món (mặc định đã giao).
 * `itemState` để dựng bàn đã huỷ sạch món — trông có món nhưng không tính là đang dùng. */
async function insertOpenOrder(opts: {
  tableId: string;
  tableCode: string;
  openedAgoMs: number;
  itemCount: number;
  itemState?: string;
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
       VALUES (?, ?, NULL, 'Món test', 1, 10000, ?, ?, ?)`,
      [randomUUID(), id, opts.itemState ?? 'SERVED', opened, opened],
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

describe('transferTable — giờ vào ăn + chặn bàn đích đang có khách', () => {
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

  it('bàn đích CHƯA THANH TOÁN → CHẶN, không gộp bill, hai bàn còn nguyên', async () => {
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

    // Gộp hai nhóm khách vào một bill thì không có đường tách lại — chặn từ đầu.
    await expect(svc.transferTable(src.id, destTableId)).rejects.toMatchObject({
      response: {
        code: 'DEST_TABLE_OCCUPIED',
        // Câu lỗi phải chỉ đúng việc cần làm: đi thanh toán bàn đích.
        message: expect.stringContaining('chưa thanh toán'),
      },
    });

    // Transaction rollback: KHÔNG món nào đi lạc, đơn nguồn không bị xoá.
    const repo = ds.getRepository(OrderItem);
    expect(await repo.count({ where: { order_id: dest0.id } })).toBe(2);
    expect(await repo.count({ where: { order_id: src.id } })).toBe(6);
    expect(await readOrder(src.id)).not.toBeNull();
    // Nhật ký bàn đích cũng không mọc thêm dòng nào của bàn nguồn.
    expect((await activityOf(dest0.id)).map((l) => l.event_kind)).toEqual(['order_created']);
  }, 20_000);

  it('bàn đích chỉ có đơn RỖNG (tap nhầm) → vẫn CHẶN, câu lỗi chỉ sang đường huỷ bàn', async () => {
    const srcCode = `${P}d1`;
    const destCode = `${P}d2`;
    const srcTableId = await insertTable(srcCode, 'Bàn 48');
    const destTableId = await insertTable(destCode, 'Bàn 49');
    // Đơn mở 0 món (nhân viên tap nhầm vào bàn). Chủ quán chốt: bàn phải TRỐNG HẲN mới nhận
    // chuyển — nhưng bàn kiểu này không có gì để thu, nên câu lỗi phải bảo đi huỷ bàn chứ không
    // bảo đi thanh toán, kẻo nhân viên đứng tìm nút thanh toán cho một bill 0 đồng.
    const dest0 = await insertOpenOrder({
      tableId: destTableId,
      tableCode: destCode,
      openedAgoMs: 2 * H,
      itemCount: 0,
    });
    const src = await insertOpenOrder({
      tableId: srcTableId,
      tableCode: srcCode,
      openedAgoMs: 1 * H,
      itemCount: 6,
    });

    await expect(svc.transferTable(src.id, destTableId)).rejects.toMatchObject({
      response: {
        code: 'DEST_TABLE_OCCUPIED',
        message: expect.stringContaining('huỷ bàn đó trước'),
      },
    });

    expect(await ds.getRepository(OrderItem).count({ where: { order_id: src.id } })).toBe(6);
    expect(await readOrder(src.id)).not.toBeNull();
    expect(await readOrder(dest0.id)).not.toBeNull();
  }, 20_000);

  it('bàn đích đã huỷ sạch món nhưng đơn chưa kết → vẫn CHẶN', async () => {
    const srcCode = `${P}e1`;
    const destCode = `${P}e2`;
    const srcTableId = await insertTable(srcCode, 'Bàn 48');
    const destTableId = await insertTable(destCode, 'Bàn 49');
    // Sơ đồ bàn vẽ bàn này là TRỐNG (`/orders` lọc đơn huỷ sạch món), nhưng `closed_at` vẫn NULL
    // → theo luật "chỉ nhận bàn trống hẳn" thì chặn. Vì thế màn Chuyển bàn phải đọc
    // `/orders/open-table-ids` chứ không đọc `/orders`, nếu không nó hiện bàn này bấm được.
    await insertOpenOrder({
      tableId: destTableId,
      tableCode: destCode,
      openedAgoMs: 2 * H,
      itemCount: 2,
      itemState: 'CANCELLED',
    });
    const src = await insertOpenOrder({
      tableId: srcTableId,
      tableCode: srcCode,
      openedAgoMs: 1 * H,
      itemCount: 6,
    });

    await expect(svc.transferTable(src.id, destTableId)).rejects.toMatchObject({
      response: { code: 'DEST_TABLE_OCCUPIED' },
    });
    expect(await readOrder(src.id)).not.toBeNull();
  }, 20_000);

  it('bàn đích vừa thanh toán xong (đơn đã kết) → nhận chuyển bình thường', async () => {
    const srcCode = `${P}f1`;
    const destCode = `${P}f2`;
    const srcTableId = await insertTable(srcCode, 'Bàn 48');
    const destTableId = await insertTable(destCode, 'Bàn 49');
    // Đúng đường mà nhân viên sẽ đi sau khi ăn câu lỗi: thanh toán bàn đích rồi chuyển lại.
    const paid = await insertOpenOrder({
      tableId: destTableId,
      tableCode: destCode,
      openedAgoMs: 2 * H,
      itemCount: 2,
    });
    await ds.query('UPDATE orders SET closed_at = ?, is_paid = 1 WHERE id = ?', [
      new Date(),
      paid.id,
    ]);
    const src = await insertOpenOrder({
      tableId: srcTableId,
      tableCode: srcCode,
      openedAgoMs: 1 * H,
      itemCount: 6,
    });

    const dest = await svc.transferTable(src.id, destTableId);

    // Đơn mới tinh, KHÔNG đụng vào bill đã thanh toán của lượt khách trước.
    expect(dest.id).not.toBe(paid.id);
    expect(dest.opened_at).toBe(src.opened_at);
    expect(await ds.getRepository(OrderItem).count({ where: { order_id: dest.id } })).toBe(6);
    expect(await ds.getRepository(OrderItem).count({ where: { order_id: paid.id } })).toBe(2);
    expect(await readOrder(src.id)).toBeNull();
  }, 20_000);
});

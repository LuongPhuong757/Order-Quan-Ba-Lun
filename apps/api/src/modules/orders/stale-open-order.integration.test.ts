// Integration test cho "BÀN TREO" — bàn trông trống trên sơ đồ nhưng DB vẫn coi là đơn đang mở
// (chốt 2026-09-09). Xem `stale-open-order.ts` để biết bug gốc.
//
// Vì sao PHẢI là integration, không mock: thứ đáng test ở đây là `getOrCreateOpenOrder` có DÙNG
// LẠI đúng dòng cũ hay không, và câu đo `probeOpenOrder` (SUM/MAX trên `order_items` thật, qua
// `UNIX_TIMESTAMP` với session UTC) có ra đúng mốc rảnh hay không. Fake-repository không chứng
// minh được cái nào. Ngưỡng thuần đã có test riêng ở `stale-open-order.test.ts`.
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
const P = 'stale91-';
const LIKE = 'stale91-%';

const H = 60 * 60 * 1000;
const NV_CU = { id: randomUUID(), full_name: 'Nhân viên lượt trước' };
const NV_MOI = { id: randomUUID(), full_name: 'Nhân viên lượt mới' };

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

async function insertTable(code: string): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active)
     VALUES (?, ?, ?, 'dine-in', 0, 0, 1)`,
    [id, code, `Bàn ${code}`],
  );
  return id;
}

/** Đơn đang mở với giờ mở LÙI VỀ QUÁ KHỨ + món có `updated_at` lùi tương ứng.
 * `openedAgoMs` / `itemTouchedAgoMs` tính từ NOW, để dựng đúng cảnh "treo từ hôm qua". */
async function insertOpenOrder(opts: {
  tableId: string;
  tableCode: string;
  openedAgoMs: number;
  itemStates?: string[];
  itemTouchedAgoMs?: number;
}): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO orders
       (id, table_id, table_code, opened_at, closed_at, is_paid, source,
        created_by_user_id, created_by_full_name)
     VALUES (?, ?, ?, ?, NULL, 0, 'STAFF', ?, ?)`,
    [
      id,
      opts.tableId,
      opts.tableCode,
      new Date(Date.now() - opts.openedAgoMs),
      NV_CU.id,
      NV_CU.full_name,
    ],
  );
  const touched = new Date(Date.now() - (opts.itemTouchedAgoMs ?? opts.openedAgoMs));
  for (const state of opts.itemStates ?? []) {
    await ds.query(
      `INSERT INTO order_items
        (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, created_at, updated_at)
       VALUES (?, ?, NULL, 'Món test', 1, 10000, ?, ?, ?)`,
      [randomUUID(), id, state, touched, touched],
    );
  }
  return id;
}

async function readOrder(id: string): Promise<Order | null> {
  return ds.getRepository(Order).findOne({ where: { id } });
}

async function activityKinds(order_id: string): Promise<string[]> {
  const rows: Array<{ event_kind: string }> = await ds.query(
    'SELECT event_kind FROM order_activity_logs WHERE order_id = ? ORDER BY created_at ASC',
    [order_id],
  );
  return rows.map((r) => r.event_kind);
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql`), rồi chạy lại ' +
        '`pnpm --filter @order/api test -- stale-open-order.integration.test.ts`. ' +
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

describe('getOrCreateOpenOrder — bàn trống nhưng để mở', () => {
  it('đơn RỖNG treo từ hôm qua → tính lại giờ vào, KHÔNG lưu sang ngày cũ nữa', async () => {
    const code = `${P}a`;
    const tableId = await insertTable(code);
    const oldId = await insertOpenOrder({ tableId, tableCode: code, openedAgoMs: 30 * H });

    const got = await svc.getOrCreateOpenOrder(tableId, NV_MOI);

    // Dùng lại CHÍNH dòng cũ (nhật ký bàn móc theo order_id, xoá là mất vết).
    expect(got.id).toBe(oldId);
    const after = await readOrder(oldId);
    // Đây là cả cái bug: trước khi sửa, `opened_at` vẫn là 30 giờ trước nên `HistoryPage`
    // (`vnDayIso(opened_at)`) xếp bill của khách hôm nay sang ngày hôm trước.
    expect(Date.now() - after!.opened_at).toBeLessThan(60_000);
    expect(after!.first_kitchen_at).toBeNull();
    // Header drawer + lịch sử phải hiện nhân viên của LƯỢT NÀY.
    expect(after!.created_by_full_name).toBe(NV_MOI.full_name);
    // Log giữ lại (chủ quán chốt): vẫn soi được bàn này từng bị treo bao lâu.
    expect(await activityKinds(oldId)).toContain('order_restarted');
  }, 20_000);

  it('đơn ĐÃ HUỶ HẾT MÓN treo qua ngày → niêm "Đã huỷ" + mở đơn mới, không trộn món cũ', async () => {
    const code = `${P}b`;
    const tableId = await insertTable(code);
    const oldId = await insertOpenOrder({
      tableId,
      tableCode: code,
      openedAgoMs: 30 * H,
      itemStates: ['CANCELLED', 'CANCELLED'],
      itemTouchedAgoMs: 28 * H,
    });

    const got = await svc.getOrCreateOpenOrder(tableId, NV_MOI);

    expect(got.id).not.toBe(oldId);
    // Đơn mới sạch: không kéo 2 món đã huỷ của lượt trước sang bill khách mới.
    expect(await ds.getRepository(OrderItem).count({ where: { order_id: got.id } })).toBe(0);
    expect(got.created_by_full_name).toBe(NV_MOI.full_name);
    // Lượt cũ nằm lại lịch sử ở trạng thái "Đã huỷ" (closed_at có + is_paid = 0) — vết chống
    // gian lận, KHÔNG được biến mất.
    const old = await readOrder(oldId);
    expect(old!.closed_at).not.toBeNull();
    expect(old!.is_paid).toBe(false);
    expect(await activityKinds(oldId)).toContain('order_cancelled');
    expect(await activityKinds(got.id)).toContain('order_created');
  }, 20_000);

  it('bàn CÒN MÓN CHƯA HUỶ mở qua đêm → KHÔNG đụng gì, giữ nguyên giờ vào', async () => {
    // Hồi quy quan trọng nhất: bàn ngồi lâu / quên thu tiền qua đêm là đơn THẬT đang chờ
    // thanh toán, sơ đồ bàn đang hiện nó. Tính lại giờ vào ở đây là làm sai số liệu.
    const code = `${P}c`;
    const tableId = await insertTable(code);
    const oldId = await insertOpenOrder({
      tableId,
      tableCode: code,
      openedAgoMs: 30 * H,
      itemStates: ['SERVED'],
      itemTouchedAgoMs: 29 * H,
    });
    const before = await readOrder(oldId);

    const got = await svc.getOrCreateOpenOrder(tableId, NV_MOI);

    expect(got.id).toBe(oldId);
    const after = await readOrder(oldId);
    expect(after!.opened_at).toBe(before!.opened_at);
    expect(after!.created_by_full_name).toBe(NV_CU.full_name);
    expect(await activityKinds(oldId)).not.toContain('order_restarted');
  }, 20_000);

  it('đơn rỗng vừa mở vài phút → dùng lại y nguyên (nhân viên đang chọn món)', async () => {
    const code = `${P}d`;
    const tableId = await insertTable(code);
    const oldId = await insertOpenOrder({ tableId, tableCode: code, openedAgoMs: 5 * 60_000 });
    const before = await readOrder(oldId);

    const got = await svc.getOrCreateOpenOrder(tableId, NV_MOI);

    expect(got.id).toBe(oldId);
    const after = await readOrder(oldId);
    expect(after!.opened_at).toBe(before!.opened_at);
    expect(after!.created_by_full_name).toBe(NV_CU.full_name);
  }, 20_000);
});

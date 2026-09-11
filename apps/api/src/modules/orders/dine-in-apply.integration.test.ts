// Integration test cho ĐỔ GIỎ QR VÀO ĐƠN (M4.D-13, M4.D-18..21).
//
// Vì sao PHẢI là integration, không phải test thuần: thứ đáng test ở đây là các bất biến do
// DB giữ, không phải nhánh if trong JS.
//
//   1. **Mã dùng đúng 1 lần** — chốt chặn là compare-and-set `UPDATE ... WHERE used_at IS NULL`.
//      Fake-repository luôn "thành công" nên không chứng minh được gì; chỉ MySQL thật mới cho
//      thấy người thứ hai nhận 0 affected row.
//   2. **Món vào ở `PENDING`** — trạng thái nằm trong dòng `order_items` đã ghi xuống.
//   3. **Giờ vào ăn dời theo món đầu tiên** — `opened_at` bị `addItemsBulk` ghi đè, và
//      `@CreateDateColumn` là thứ TypeORM + driver quyết định lúc insert thật.
//
// Phần logic thuần (preview, kế hoạch bỏ dòng, câu chữ) đã có `dine-in-apply.test.ts` riêng.
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
import { DineInStaffService } from './dine-in-staff.service.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { OrderActivityLog } from './entities/order-activity-log.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { DineInCart } from '../public/entities/dine-in-cart.entity.js';
import { ConsumptionService } from '../ingredients/consumption.service.js';
import { OrderItemIngredientUsage } from '../ingredients/entities/order-item-ingredient-usage.entity.js';
import { RecipeLine } from '../ingredients/entities/recipe-line.entity.js';
import { Ingredient } from '../ingredients/entities/ingredient.entity.js';
import { DINE_IN_CART_TTL_MS, generateDineInCode } from '../public/dine-in-code.js';

/** Tiền tố sentinel RIÊNG của file này — mỗi file integration một tiền tố, để cleanup của file
 * này không xoá dữ liệu của file khác chạy song song. `restaurant_tables.code` là varchar(16). */
const P = 'qr911-';
const LIKE = 'qr911-%';

const NV = { id: randomUUID(), full_name: 'Nguyễn Thị Hà' };
const NV2 = { id: randomUUID(), full_name: 'Trần Văn Bình' };

let ds: DataSource;
let orders: OrdersService;
let dineIn: DineInStaffService;

async function cleanupSentinelRows(): Promise<void> {
  await ds.query(
    `DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.table_code LIKE ?`,
    [LIKE],
  );
  await ds.query('DELETE FROM order_activity_logs WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM orders WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM dine_in_carts WHERE user_agent LIKE ?', [LIKE]);
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

async function insertMenuItem(opts: {
  name: string;
  price: number;
  outOfStock?: boolean;
  active?: boolean;
  onlineHidden?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO menu_items
       (id, code, name, \`group\`, price, unit, is_out_of_stock, is_online_hidden,
        is_menu_hidden, menu_sort_order, is_active)
     VALUES (?, ?, ?, 'food', ?, 'phần', ?, ?, 0, 0, ?)`,
    [
      id,
      `${P}${id.slice(0, 6)}`,
      opts.name,
      opts.price,
      opts.outOfStock ? 1 : 0,
      opts.onlineHidden ? 1 : 0,
      opts.active === false ? 0 : 1,
    ],
  );
  return id;
}

async function insertOpenOrder(tableId: string, tableCode: string, openedAgoMs = 0): Promise<string> {
  const id = randomUUID();
  const opened = new Date(Date.now() - openedAgoMs);
  await ds.query(
    `INSERT INTO orders
       (id, table_id, table_code, opened_at, closed_at, is_paid, source,
        created_by_user_id, created_by_full_name)
     VALUES (?, ?, ?, ?, NULL, 0, 'STAFF', ?, ?)`,
    [id, tableId, tableCode, opened, NV.id, NV.full_name],
  );
  return id;
}

/** Giỏ QR còn hiệu lực. `user_agent` mang tiền tố sentinel để cleanup nhận ra dòng của file này. */
async function insertCart(
  lines: Array<{ menu_item_id: string; name: string; unit_price: number; qty: number; note?: string | null }>,
  over: { expiresInMs?: number; usedAt?: number | null; cancelledAt?: number | null } = {},
): Promise<{ id: string; code: string }> {
  const id = randomUUID();
  const code = generateDineInCode();
  const snapshot = lines.map((l) => ({
    menu_item_id: l.menu_item_id,
    code: 'X',
    name: l.name,
    unit_price: l.unit_price,
    qty: l.qty,
    note: l.note ?? null,
  }));
  const subtotal = snapshot.reduce((s, l) => s + l.unit_price * l.qty, 0);
  await ds.query(
    `INSERT INTO dine_in_carts
       (id, code, items_snapshot, subtotal, customer_token, ip_hash, user_agent,
        expires_at, cancelled_at, used_at, used_by_user_id, used_by_full_name,
        used_table_code, order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    [
      id,
      code,
      JSON.stringify(snapshot),
      subtotal,
      'tok-'.padEnd(32, 'x'),
      'a'.repeat(64),
      `${P}ua`,
      new Date(Date.now() + (over.expiresInMs ?? DINE_IN_CART_TTL_MS)),
      over.cancelledAt ? new Date(over.cancelledAt) : null,
      over.usedAt ? new Date(over.usedAt) : null,
    ],
  );
  return { id, code };
}

async function itemsOf(orderId: string): Promise<OrderItem[]> {
  return ds.getRepository(OrderItem).find({ where: { order_id: orderId }, order: { created_at: 'ASC' } });
}

async function cartRow(id: string): Promise<DineInCart | null> {
  return ds.getRepository(DineInCart).findOne({ where: { id } });
}

beforeAll(async () => {
  // Bảng `dine_in_carts` mới ra đời ở M4. App thật tạo nó bằng `synchronize: true`
  // (C-SCHEMA-07), nhưng DataSource của test dùng `synchronize: false` nên trên một DB chưa
  // từng chạy app thì bảng chưa tồn tại. Đồng bộ DUY NHẤT entity này — KHÔNG dùng
  // `dataSourceOptions` đầy đủ với `synchronize: true`, vì như vậy là cho TypeORM tự do sửa
  // toàn bộ schema của một DB thật.
  const bootstrap = new DataSource({ ...dataSourceOptions, entities: [DineInCart], synchronize: true });
  try {
    await bootstrap.initialize();
    await bootstrap.destroy();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql`), rồi chạy lại. ' +
        `Lỗi gốc: ${String(err)}`,
    );
  }

  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  await ds.initialize();

  const emitter = new EventEmitter2();
  const consumption = new ConsumptionService(
    ds.getRepository(OrderItemIngredientUsage),
    ds.getRepository(RecipeLine),
    ds.getRepository(Ingredient),
  );
  orders = new OrdersService(
    ds.getRepository(Order),
    ds.getRepository(OrderItem),
    ds.getRepository(MenuItem),
    ds.getRepository(RestaurantTable),
    ds.getRepository(OrderActivityLog),
    ds,
    emitter,
    consumption,
  );
  dineIn = new DineInStaffService(
    ds.getRepository(DineInCart),
    ds.getRepository(MenuItem),
    ds.getRepository(Order),
    ds.getRepository(OrderActivityLog),
    orders,
  );

  await cleanupSentinelRows();
});

beforeEach(async () => {
  await cleanupSentinelRows();
});

afterAll(async () => {
  if (ds?.isInitialized) {
    await cleanupSentinelRows();
    await ds.destroy();
  }
});

describe('apply — đường đi bình thường', () => {
  it('món vào đơn ở state PENDING, KHÔNG phải KITCHEN', async () => {
    const tableId = await insertTable(`${P}b1`);
    const orderId = await insertOpenOrder(tableId, `${P}b1`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 2 }]);

    const res = await dineIn.apply(orderId, code, [], NV, Date.now());

    expect(res.added_count).toBe(2);
    const items = await itemsOf(orderId);
    expect(items).toHaveLength(1);
    // Đây là toàn bộ ý nghĩa của "xem xong rồi mới báo bếp": bếp KHÔNG thấy dòng PENDING.
    expect(items[0]!.state).toBe('PENDING');
    expect(items[0]!.qty).toBe(2);
    expect(items[0]!.menu_item_price).toBe(50_000);
  });

  it('ghi ai gõ mã, bàn nào, đơn nào vào bản ghi giỏ', async () => {
    const tableId = await insertTable(`${P}b2`);
    const orderId = await insertOpenOrder(tableId, `${P}b2`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { id, code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }]);

    await dineIn.apply(orderId, code, [], NV, Date.now());

    const row = await cartRow(id);
    expect(row!.used_at).not.toBeNull();
    expect(row!.used_by_user_id).toBe(NV.id);
    expect(row!.used_by_full_name).toBe(NV.full_name);
    expect(row!.used_table_code).toBe(`${P}b2`);
    expect(row!.order_id).toBe(orderId);
  });

  it('ghi nhật ký có mã giỏ — sáu tháng sau còn truy được món ở đâu ra', async () => {
    const tableId = await insertTable(`${P}b3`);
    const orderId = await insertOpenOrder(tableId, `${P}b3`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }]);

    await dineIn.apply(orderId, code, [], NV, Date.now());

    const logs = await ds.getRepository(OrderActivityLog).find({ where: { order_id: orderId } });
    const applied = logs.find((l) => l.event_kind === 'dine_in_cart_applied');
    expect(applied).toBeDefined();
    expect(applied!.message).toContain(code);
    expect(applied!.actor_name).toBe(NV.full_name);
    // `addItemsBulk` vẫn ghi dòng "Gọi món: ..." của nó — hai dòng bổ sung nhau, không thay thế.
    expect(logs.some((l) => l.event_kind === 'items_added')).toBe(true);
  });

  it('giữ ghi chú từng món', async () => {
    const tableId = await insertTable(`${P}b4`);
    const orderId = await insertOpenOrder(tableId, `${P}b4`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart([
      { menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1, note: 'ít cay' },
    ]);

    await dineIn.apply(orderId, code, [], NV, Date.now());
    const items = await itemsOf(orderId);
    expect(items[0]!.note).toBe('ít cay');
  });

  /** M4.D-19 — khách gọi thêm giữa bữa là ca thường xuyên nhất. */
  it('bàn đang ăn: món cộng thêm vào đơn đang mở, không tạo đơn thứ hai', async () => {
    const tableId = await insertTable(`${P}b5`);
    const orderId = await insertOpenOrder(tableId, `${P}b5`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const nem = await insertMenuItem({ name: 'Nem cuốn', price: 45_000 });

    await orders.addItemsBulk(orderId, [{ menu_item_id: pho, qty: 1 }], true, NV);
    const { code } = await insertCart([{ menu_item_id: nem, name: 'Nem cuốn', unit_price: 45_000, qty: 3 }]);
    await dineIn.apply(orderId, code, [], NV, Date.now());

    const items = await itemsOf(orderId);
    expect(items).toHaveLength(2);
    const openOrders = await ds.query('SELECT id FROM orders WHERE table_code = ? AND closed_at IS NULL', [`${P}b5`]);
    expect(openOrders).toHaveLength(1);
  });

  /**
   * Hệ quả của `seated-at.ts` (sửa 2026-09-10) áp lên luồng QR: bàn được mở lúc 18:00 mà khách
   * thật ngồi 19:00 thì giờ vào ăn phải là 19:00 — kể cả khi món đầu tiên đến từ giỏ QR.
   */
  it('món QR đầu tiên dời "giờ vào ăn" về hiện tại', async () => {
    const tableId = await insertTable(`${P}b6`);
    const twoHours = 2 * 60 * 60 * 1000;
    const orderId = await insertOpenOrder(tableId, `${P}b6`, twoHours);
    const before = await ds.getRepository(Order).findOne({ where: { id: orderId } });
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }]);

    await dineIn.apply(orderId, code, [], NV, Date.now());

    const after = await ds.getRepository(Order).findOne({ where: { id: orderId } });
    expect(after!.opened_at).toBeGreaterThan(before!.opened_at);
    expect(Date.now() - after!.opened_at).toBeLessThan(60_000);
  });
});

describe('apply — mã dùng 1 lần (M4.D-13, điểm chí tử)', () => {
  it('gõ lần hai bị chặn, và câu báo nói rõ ai đã gõ + bàn nào', async () => {
    const tableId = await insertTable(`${P}c1`);
    const orderId = await insertOpenOrder(tableId, `${P}c1`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 2 }]);

    await dineIn.apply(orderId, code, [], NV, Date.now());

    await expect(dineIn.apply(orderId, code, [], NV2, Date.now())).rejects.toMatchObject({
      response: { code: 'DINE_IN_CART_USED' },
    });
    const err = await dineIn.apply(orderId, code, [], NV2, Date.now()).catch((e) => e);
    expect(err.response.message).toContain(NV.full_name);
    expect(err.response.message).toContain(`${P}c1`);

    // Và quan trọng nhất: món KHÔNG bị nhân đôi.
    const items = await itemsOf(orderId);
    expect(items).toHaveLength(1);
    expect(items.reduce((s, i) => s + i.qty, 0)).toBe(2);
  });

  /**
   * Hai nhân viên gõ cùng một mã cùng lúc — đúng ca mà compare-and-set sinh ra để chặn. Chỉ
   * một người được thắng, và tổng số phần trong đơn phải bằng đúng một lần giỏ.
   */
  it('hai nhân viên gõ đồng thời: chỉ một người thắng', async () => {
    const tableId = await insertTable(`${P}c2`);
    const orderId = await insertOpenOrder(tableId, `${P}c2`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 2 }]);

    const results = await Promise.allSettled([
      dineIn.apply(orderId, code, [], NV, Date.now()),
      dineIn.apply(orderId, code, [], NV2, Date.now()),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);

    const items = await itemsOf(orderId);
    expect(items.reduce((s, i) => s + i.qty, 0)).toBe(2);
  });
});

describe('apply — mã không dùng được', () => {
  it('mã sai số kiểm tra bị chặn trước khi đụng DB', async () => {
    const tableId = await insertTable(`${P}d1`);
    const orderId = await insertOpenOrder(tableId, `${P}d1`);
    await expect(dineIn.apply(orderId, '11111', [], NV, Date.now())).rejects.toMatchObject({
      response: { code: 'DINE_IN_CODE_INVALID' },
    });
  });

  it('mã hết hạn: báo hết hạn, không đổ món', async () => {
    const tableId = await insertTable(`${P}d2`);
    const orderId = await insertOpenOrder(tableId, `${P}d2`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart(
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      { expiresInMs: -1_000 },
    );

    await expect(dineIn.apply(orderId, code, [], NV, Date.now())).rejects.toMatchObject({
      response: { code: 'DINE_IN_CART_EXPIRED' },
    });
    expect(await itemsOf(orderId)).toHaveLength(0);
  });

  it('khách đã bấm "Sửa lại": báo giỏ đã huỷ, nhắc hỏi mã mới', async () => {
    const tableId = await insertTable(`${P}d3`);
    const orderId = await insertOpenOrder(tableId, `${P}d3`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart(
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      { cancelledAt: Date.now() - 1_000 },
    );

    await expect(dineIn.apply(orderId, code, [], NV, Date.now())).rejects.toMatchObject({
      response: { code: 'DINE_IN_CART_CANCELLED' },
    });
    expect(await itemsOf(orderId)).toHaveLength(0);
  });

  it('đơn đã đóng thì không nhận giỏ, và mã KHÔNG bị đốt', async () => {
    const tableId = await insertTable(`${P}d4`);
    const orderId = await insertOpenOrder(tableId, `${P}d4`);
    await ds.query('UPDATE orders SET closed_at = NOW(6), is_paid = 1 WHERE id = ?', [orderId]);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { id, code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }]);

    await expect(dineIn.apply(orderId, code, [], NV, Date.now())).rejects.toMatchObject({
      response: { code: 'CONFLICT' },
    });
    // Mã còn sống để nhân viên gõ vào bàn đúng.
    expect((await cartRow(id))!.used_at).toBeNull();
  });
});

describe('apply — món hết giữa lúc chờ (M4.D-21)', () => {
  it('bỏ dòng hết hàng, đổ phần còn lại', async () => {
    const tableId = await insertTable(`${P}e1`);
    const orderId = await insertOpenOrder(tableId, `${P}e1`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const rau = await insertMenuItem({ name: 'Rau muống xào', price: 30_000, outOfStock: true });
    const { code } = await insertCart([
      { menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 2 },
      { menu_item_id: rau, name: 'Rau muống xào', unit_price: 30_000, qty: 1 },
    ]);

    const res = await dineIn.apply(orderId, code, [], NV, Date.now());
    expect(res.skipped_count).toBe(1);
    expect(res.added_count).toBe(2);

    const items = await itemsOf(orderId);
    expect(items).toHaveLength(1);
    expect(items[0]!.menu_item_name).toBe('Phở bò');
  });

  it('cả giỏ đều hết: không đốt mã, báo lỗi rõ ràng', async () => {
    const tableId = await insertTable(`${P}e2`);
    const orderId = await insertOpenOrder(tableId, `${P}e2`);
    const rau = await insertMenuItem({ name: 'Rau muống xào', price: 30_000, outOfStock: true });
    const { id, code } = await insertCart([
      { menu_item_id: rau, name: 'Rau muống xào', unit_price: 30_000, qty: 1 },
    ]);

    await expect(dineIn.apply(orderId, code, [], NV, Date.now())).rejects.toMatchObject({
      response: { code: 'DINE_IN_CART_EMPTY' },
    });
    expect((await cartRow(id))!.used_at).toBeNull();
  });

  it('nhân viên bỏ tay hết mọi dòng: cũng không đốt mã', async () => {
    const tableId = await insertTable(`${P}e3`);
    const orderId = await insertOpenOrder(tableId, `${P}e3`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { id, code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }]);

    await expect(dineIn.apply(orderId, code, [pho], NV, Date.now())).rejects.toMatchObject({
      response: { code: 'DINE_IN_CART_EMPTY' },
    });
    expect((await cartRow(id))!.used_at).toBeNull();
  });

  /** Món `is_online_hidden` = "web ship không bán" — tại bàn thì vẫn bán. Đây là điểm khác
   * luồng online và là lý do `/api/public/dine-in-menu` tồn tại riêng. */
  it('món chỉ bán tại chỗ (is_online_hidden) vẫn đổ vào đơn được', async () => {
    const tableId = await insertTable(`${P}e4`);
    const orderId = await insertOpenOrder(tableId, `${P}e4`);
    const lau = await insertMenuItem({ name: 'Lẩu gà lá é', price: 350_000, onlineHidden: true });
    const { code } = await insertCart([
      { menu_item_id: lau, name: 'Lẩu gà lá é', unit_price: 350_000, qty: 1 },
    ]);

    const res = await dineIn.apply(orderId, code, [], NV, Date.now());
    expect(res.added_count).toBe(1);
    expect((await itemsOf(orderId))[0]!.menu_item_name).toBe('Lẩu gà lá é');
  });
});

describe('apply — giá chốt lúc xác nhận (M4.D-20)', () => {
  it('giá menu đã đổi: bill tính theo giá MỚI', async () => {
    const tableId = await insertTable(`${P}f1`);
    const orderId = await insertOpenOrder(tableId, `${P}f1`);
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 2 }]);

    // Chủ quán tăng giá SAU khi khách sinh mã.
    await ds.query('UPDATE menu_items SET price = 55000 WHERE id = ?', [pho]);

    const res = await dineIn.apply(orderId, code, [], NV, Date.now());
    expect(res.subtotal_added).toBe(110_000);
    const items = await itemsOf(orderId);
    expect(items[0]!.menu_item_price).toBe(55_000);
  });
});

describe('preview — không tiêu mã', () => {
  it('xem preview nhiều lần vẫn không làm mã chết', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { id, code } = await insertCart([{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 2 }]);

    await dineIn.preview(code, Date.now());
    await dineIn.preview(code, Date.now());

    expect((await cartRow(id))!.used_at).toBeNull();
  });

  it('preview hiện cảnh báo lệch giá và dòng hết hàng', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const rau = await insertMenuItem({ name: 'Rau muống xào', price: 30_000, outOfStock: true });
    const { code } = await insertCart([
      { menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 2 },
      { menu_item_id: rau, name: 'Rau muống xào', unit_price: 30_000, qty: 1 },
    ]);
    await ds.query('UPDATE menu_items SET price = 55000 WHERE id = ?', [pho]);

    const pv = await dineIn.preview(code, Date.now());
    expect(pv.has_price_change).toBe(true);
    expect(pv.has_unavailable).toBe(true);
    expect(pv.lines).toHaveLength(2);
    // Tổng tiền chỉ gồm dòng còn bán được, theo giá mới.
    expect(pv.subtotal).toBe(110_000);
    expect(pv.item_count).toBe(2);
  });
});

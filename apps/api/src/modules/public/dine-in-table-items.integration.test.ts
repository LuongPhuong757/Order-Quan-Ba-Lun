// Integration test cho "MÓN BÀN BẠN ĐÃ GỌI" — phần khách nhìn thấy sau khi nhân viên nhận mã
// (chủ quán 2026-09-16).
//
// Vì sao PHẢI là integration: thứ đáng test ở đây là RANH GIỚI QUYỀN trên dữ liệu thật —
// `table_items` chỉ được lộ ra khi mã đã `USED` VÀ người hỏi gửi đúng `customer_token`. Mã chỉ
// 5 chữ số, dò hết là chuyện vài giây; một nhánh if viết ngược ở đây nghĩa là ai ngồi trong
// quán cũng đọc được bàn khác đang ăn gì. Fake-repository không chứng minh được điều đó, vì
// chính việc đọc `order_items` thật của bàn mới là thứ bị chặn hay không bị chặn.
//
// `import 'dotenv/config'` BẮT BUỘC: `data-source.ts` đọc `process.env.MYSQL_PORT` trực tiếp,
// thiếu dòng này là nối vào cổng 3306 sai (container map 3307).
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { dataSourceOptions } from '../../data-source.js';
import { OrdersService } from '../orders/orders.service.js';
import { DineInStaffService } from '../orders/dine-in-staff.service.js';
import { DineInCartsService } from './dine-in-carts.service.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrderActivityLog } from '../orders/entities/order-activity-log.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../tables/entities/restaurant-table.entity.js';
import { DineInCart } from './entities/dine-in-cart.entity.js';
import { ConsumptionService } from '../ingredients/consumption.service.js';
import { OrderItemIngredientUsage } from '../ingredients/entities/order-item-ingredient-usage.entity.js';
import { RecipeLine } from '../ingredients/entities/recipe-line.entity.js';
import { Ingredient } from '../ingredients/entities/ingredient.entity.js';
import { DINE_IN_CART_TTL_MS, generateDineInCode } from './dine-in-code.js';

/** Tiền tố sentinel RIÊNG của file này — mỗi file integration một tiền tố, để cleanup của file
 * này không xoá dữ liệu của file khác chạy song song. `restaurant_tables.code` là varchar(16). */
const P = 'qrtbl-';
const LIKE = 'qrtbl-%';

const NV = { id: randomUUID(), full_name: 'Nguyễn Thị Hà' };
const NV2 = { id: randomUUID(), full_name: 'Trần Văn Bình' };

/** Token thiết bị của khách — credential duy nhất mở ra `table_items`. */
const TOKEN = 'tok-'.padEnd(32, 'x');

let ds: DataSource;
let orders: OrdersService;
let dineIn: DineInStaffService;
let customer: DineInCartsService;

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
      TOKEN,
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
  customer = new DineInCartsService(
    ds.getRepository(DineInCart),
    ds.getRepository(MenuItem),
    ds.getRepository(OrderItem),
    emitter,
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


/** Đưa một giỏ qua đường thật của nhân viên: nhận mã + báo bếp. Trả `orderId` của bàn. */
async function acceptCart(
  tableSuffix: string,
  cartLines: Array<{ menu_item_id: string; name: string; unit_price: number; qty: number }>,
  submit: Array<{ menu_item_id: string; qty: number; note: string | null }>,
): Promise<{ orderId: string; code: string }> {
  const tableId = await insertTable(`${P}${tableSuffix}`);
  const orderId = await insertOpenOrder(tableId, `${P}${tableSuffix}`);
  const { code } = await insertCart(cartLines);
  await dineIn.apply(orderId, code, { items: submit, sendToKitchen: true }, NV, Date.now());
  return { orderId, code };
}

describe('món của bàn — ai được xem', () => {
  it('mã CHƯA được nhận: không trả danh sách, kể cả khi gửi đúng token', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await insertCart([
      { menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 },
    ]);

    const st = await customer.getByCode(code, Date.now(), TOKEN);

    expect(st.state).toBe('ACTIVE');
    // Chưa ai nhận thì chưa có bàn nào để mà kể — và giỏ thì khách đang cầm trên tay rồi.
    expect(st.table_items).toBeNull();
    expect(st.table_subtotal).toBeNull();
  });

  it('đã nhận nhưng KHÔNG gửi token: không trả danh sách', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await acceptCart(
      'a1',
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      [{ menu_item_id: pho, qty: 1, note: null }],
    );

    const st = await customer.getByCode(code, Date.now());

    // Đây là cái chặn người ngồi bàn bên cạnh dò 5 chữ số rồi đọc bàn khác đang ăn gì.
    expect(st.state).toBe('USED');
    expect(st.table_items).toBeNull();
    // Phần cũ của response vẫn mở như trước — không siết thêm, không nới thêm.
    expect(st.item_count).toBe(1);
  });

  it('đã nhận nhưng token SAI: không trả danh sách', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await acceptCart(
      'a2',
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      [{ menu_item_id: pho, qty: 1, note: null }],
    );

    const st = await customer.getByCode(code, Date.now(), 'kho'.padEnd(32, 'z'));

    expect(st.table_items).toBeNull();
  });

  it('đã nhận + token ĐÚNG: trả món của bàn kèm tổng tiền', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { code } = await acceptCart(
      'a3',
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 2 }],
      [{ menu_item_id: pho, qty: 2, note: null }],
    );

    const st = await customer.getByCode(code, Date.now(), TOKEN);

    expect(st.table_items).toEqual([
      { name: 'Phở bò', qty: 2, unit_price: 50_000, line_total: 100_000 },
    ]);
    expect(st.table_subtotal).toBe(100_000);
  });
});

describe('món của bàn — nội dung danh sách', () => {
  it('gồm CẢ món nhân viên gọi thêm sau đó, không chỉ món trong mã', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const bia = await insertMenuItem({ name: 'Bia Tiger', price: 25_000 });
    const { orderId, code } = await acceptCart(
      'b1',
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      [{ menu_item_id: pho, qty: 1, note: null }],
    );

    // Khách gọi thêm bằng miệng, nhân viên gõ vào đơn như bình thường.
    await orders.addItemsBulk(orderId, [{ menu_item_id: bia, qty: 2, note: null }], true, NV);

    const st = await customer.getByCode(code, Date.now(), TOKEN);

    // Đây là lý do chọn "món của BÀN" thay vì "món của mã": khách soát được với thứ sắp ra bàn.
    expect(st.table_items!.map((l) => l.name).sort()).toEqual(['Bia Tiger', 'Phở bò']);
    expect(st.table_subtotal).toBe(50_000 + 2 * 25_000);
  });

  it('gộp món gọi làm hai lượt thành MỘT dòng', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { orderId, code } = await acceptCart(
      'b2',
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      [{ menu_item_id: pho, qty: 1, note: null }],
    );
    await orders.addItemsBulk(orderId, [{ menu_item_id: pho, qty: 3, note: 'ít hành' }], true, NV);

    const st = await customer.getByCode(code, Date.now(), TOKEN);

    // Hai dòng trong DB (khác ghi chú), nhưng khách phải đọc ra "4 × Phở bò".
    expect(st.table_items).toHaveLength(1);
    expect(st.table_items![0]).toMatchObject({ name: 'Phở bò', qty: 4, line_total: 200_000 });
  });

  it('tách dòng khi cùng món vào bill ở HAI mức giá', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { orderId, code } = await acceptCart(
      'b3',
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      [{ menu_item_id: pho, qty: 1, note: null }],
    );
    // Chủ quán sửa giá giữa bữa — lượt gọi sau vào bill ở giá mới.
    await ds.query('UPDATE menu_items SET price = 60000 WHERE id = ?', [pho]);
    await orders.addItemsBulk(orderId, [{ menu_item_id: pho, qty: 1, note: null }], true, NV);

    const st = await customer.getByCode(code, Date.now(), TOKEN);

    // Gộp chung lại thì tổng của dòng đó sai — nên gộp theo tên + GIÁ, không chỉ theo tên.
    expect(st.table_items).toHaveLength(2);
    expect(st.table_subtotal).toBe(110_000);
  });

  it('món đã HUỶ không hiện và không vào tổng', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const rau = await insertMenuItem({ name: 'Rau muống xào', price: 30_000 });
    const { orderId, code } = await acceptCart(
      'b4',
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      [
        { menu_item_id: pho, qty: 1, note: null },
        { menu_item_id: rau, qty: 1, note: null },
      ],
    );
    await ds.query(
      `UPDATE order_items SET state = 'CANCELLED' WHERE order_id = ? AND menu_item_id = ?`,
      [orderId, rau],
    );

    const st = await customer.getByCode(code, Date.now(), TOKEN);

    // Hiện món đã huỷ chỉ làm khách tưởng mình bị tính tiền món đó.
    expect(st.table_items!.map((l) => l.name)).toEqual(['Phở bò']);
    expect(st.table_subtotal).toBe(50_000);
  });

  it('dòng ghi chú cho bếp KHÔNG phải món ăn, không hiện cho khách', async () => {
    const pho = await insertMenuItem({ name: 'Phở bò', price: 50_000 });
    const { orderId, code } = await acceptCart(
      'b5',
      [{ menu_item_id: pho, name: 'Phở bò', unit_price: 50_000, qty: 1 }],
      [{ menu_item_id: pho, qty: 1, note: null }],
    );
    await ds.query(
      `INSERT INTO order_items
         (id, order_id, menu_item_id, menu_item_name, menu_item_price, qty, state, is_note)
       VALUES (?, ?, NULL, 'Ra sau cùng nhé', 0, 1, 'KITCHEN', 1)`,
      [randomUUID(), orderId],
    );

    const st = await customer.getByCode(code, Date.now(), TOKEN);

    expect(st.table_items!.map((l) => l.name)).toEqual(['Phở bò']);
  });
});

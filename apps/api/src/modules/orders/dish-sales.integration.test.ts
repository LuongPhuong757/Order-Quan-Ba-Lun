// Integration test cho `DishSalesService.report` (2026-09-09).
//
// Vì sao PHẢI là integration: rủi ro của màn này nằm gọn trong CÂU SQL — gộp theo
// `menu_item_id` (món đổi tên không tách đôi), lọc `state IN (COOKING, READY, SERVED)` (khác
// hẳn `top_items` chỉ đếm SERVED), `COUNT(DISTINCT order_id)`, và quy đổi ngày giờ VN. Fake
// repository không chứng minh được câu nào đã thực sự chạy.
//
// `import 'dotenv/config'` BẮT BUỘC: `data-source.ts` đọc `process.env.MYSQL_PORT` trực tiếp.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';
import { DishSalesService } from './dish-sales.service.js';
import { OrderItem } from './entities/order-item.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';

/** Tiền tố sentinel RIÊNG của file này — mỗi file integration một tiền tố (xem
 * `stats-tabs.integration.test.ts`). */
const P = 'dsl77-';
const LIKE = `${P}%`;

/** KỲ TEST nằm ở QUÁ KHỨ XA và không giao với dữ liệu thật của DB dev.
 *
 * Báo cáo này KHÔNG lọc theo bàn (nó là con số toàn quán), nên cách duy nhất để khẳng định số
 * tuyệt đối là chọn một kỳ mà chắc chắn không có đơn nào khác. 05/01/2019 là ngày đó. */
const NGAY = '2019-01-05';
/** 12:00 giờ VN ngày đó = 05:00 UTC — nằm gọn trong kỳ dù có bị lệch múi giờ vài tiếng. */
const TRUA_VN = new Date('2019-01-05T05:00:00Z');

let ds: DataSource;
let svc: DishSalesService;
let tableId: string;
let phoId: string;
let traId: string;
let eId: string;

async function cleanup(): Promise<void> {
  await ds.query(
    `DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.table_code LIKE ?`,
    [LIKE],
  );
  await ds.query('DELETE FROM order_activity_logs WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM orders WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM menu_items WHERE code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM menu_groups WHERE code LIKE ?', [LIKE]);
}

async function insertMenuItem(opts: {
  code: string;
  name: string;
  group: string;
  price: number;
  active?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO menu_items (id, code, name, \`group\`, price, unit, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'phần', ?, NOW(6), NOW(6))`,
    [id, opts.code, opts.name, opts.group, opts.price, opts.active === false ? 0 : 1],
  );
  return id;
}

/** 1 đơn trong kỳ test + các dòng món. */
async function insertOrder(
  items: Array<{ menuItemId: string | null; name: string; price: number; qty: number; state: string; isNote?: boolean }>,
): Promise<void> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source, ship_fee)
     VALUES (?, ?, ?, ?, ?, 1, 'STAFF', 0)`,
    [id, tableId, `${P}a`, TRUA_VN, TRUA_VN],
  );
  for (const it of items) {
    await ds.query(
      `INSERT INTO order_items
        (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, is_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), id, it.menuItemId, it.name, it.qty, it.price, it.state, it.isNote ? 1 : 0, TRUA_VN, TRUA_VN],
    );
  }
}

const ky = () => svc.report({ from: NGAY, to: NGAY });

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        `(vd \`docker compose up -d mysql\`). Lỗi gốc: ${String(err)}`,
    );
  }
  svc = new DishSalesService(
    ds.getRepository(OrderItem),
    ds.getRepository(MenuItem),
    ds.getRepository(MenuGroup),
  );
}, 20_000);

afterAll(async () => {
  await cleanup();
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await cleanup();
  tableId = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active)
     VALUES (?, ?, 'Bàn thống kê món', 'dine-in', 0, 0, 1)`,
    [tableId, `${P}a`],
  );
  await ds.query(
    `INSERT INTO menu_groups (id, code, name, icon, kitchen_type, sort_order, created_at)
     VALUES (?, ?, 'Món test', '🍜', 'cook', 0, NOW(6))`,
    [randomUUID(), `${P}g`],
  );
  phoId = await insertMenuItem({ code: `${P}pho`, name: 'Phở bò', group: `${P}g`, price: 50_000 });
  traId = await insertMenuItem({ code: `${P}tra`, name: 'Trà đá', group: `${P}g`, price: 3_000 });
  eId = await insertMenuItem({ code: `${P}e`, name: 'Món ế', group: `${P}g`, price: 20_000 });
}, 20_000);

describe('DishSalesService.report', () => {
  it('cộng số phần, doanh thu và ĐẾM SỐ ĐƠN có món (không phải số dòng)', async () => {
    // Đơn 1: 2 phở + 1 trà. Đơn 2: 1 phở (dòng riêng, cùng món) + 1 phở ghi chú khác.
    await insertOrder([
      { menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 2, state: 'SERVED' },
      { menuItemId: traId, name: 'Trà đá', price: 3_000, qty: 1, state: 'SERVED' },
    ]);
    await insertOrder([
      { menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 1, state: 'SERVED' },
      { menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 1, state: 'READY' },
    ]);

    const r = await ky();
    const pho = r.items.find((x) => x.menu_item_id === phoId)!;

    expect(pho.qty).toBe(4);
    expect(pho.revenue).toBe(200_000);
    // 2 đơn, dù nằm ở 3 dòng — "món này xuất hiện trong bao nhiêu lượt khách".
    expect(pho.orders).toBe(2);
    expect(pho.group_name).toBe('🍜 Món test');
    expect(pho.current_price).toBe(50_000);
    expect(r.total_qty).toBe(5);
    expect(r.total_revenue).toBe(203_000);
    expect(pho.revenue_pct).toBeCloseTo(98.52, 1);
  }, 20_000);

  it('đếm mọi món ĐÃ NẤU (COOKING/READY/SERVED), bỏ món huỷ và ghi chú bếp', async () => {
    await insertOrder([
      { menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 1, state: 'COOKING' },
      { menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 1, state: 'READY' },
      { menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 1, state: 'SERVED' },
      // Chưa xuống bếp và đã huỷ — nguyên liệu chưa vào nồi, không tính.
      { menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 5, state: 'PENDING' },
      { menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 9, state: 'CANCELLED' },
      // Ghi chú cho bếp: 0đ, không phải hàng bán.
      { menuItemId: null, name: 'ít cay', price: 0, qty: 1, state: 'SERVED', isNote: true },
    ]);

    const r = await ky();
    const pho = r.items.find((x) => x.menu_item_id === phoId)!;

    expect(pho.qty).toBe(3);
    expect(pho.revenue).toBe(150_000);
    expect(r.items.some((x) => x.name === 'ít cay')).toBe(false);
  }, 20_000);

  it('món đổi tên giữa kỳ vẫn là MỘT dòng, mang tên hiện tại', async () => {
    // Đơn cũ snapshot tên cũ, đơn mới snapshot tên mới — cùng một `menu_item_id`.
    await insertOrder([{ menuItemId: phoId, name: 'Phở bò tái cũ', price: 45_000, qty: 1, state: 'SERVED' }]);
    await insertOrder([{ menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 1, state: 'SERVED' }]);

    const r = await ky();
    const rows = r.items.filter((x) => x.menu_item_id === phoId);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Phở bò');
    // Doanh thu giữ NGUYÊN giá đã bán từng lúc, không quy về giá hiện tại.
    expect(rows[0].revenue).toBe(95_000);
  }, 20_000);

  it('món trong menu bán 0 phần vẫn có dòng, qty = 0', async () => {
    await insertOrder([{ menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 1, state: 'SERVED' }]);

    const r = await ky();
    const e = r.items.find((x) => x.menu_item_id === eId)!;

    expect(e.qty).toBe(0);
    expect(e.revenue).toBe(0);
    expect(e.in_menu).toBe(true);
    expect(e.current_price).toBe(20_000);
    // Món ế của test nằm trong nhóm "chưa bán phần nào" — cùng với menu thật của DB dev, nên
    // chỉ khẳng định "có nó", không khẳng định con số tuyệt đối.
    expect(r.unsold_count).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it('lọc theo ngày kinh doanh giờ VN — đơn ngoài kỳ không lọt vào', async () => {
    await insertOrder([{ menuItemId: phoId, name: 'Phở bò', price: 50_000, qty: 1, state: 'SERVED' }]);

    const truoc = await svc.report({ from: '2019-01-01', to: '2019-01-04' });
    expect(truoc.items.find((x) => x.menu_item_id === phoId)?.qty ?? 0).toBe(0);

    const sau = await svc.report({ from: '2019-01-06', to: '2019-01-10' });
    expect(sau.items.find((x) => x.menu_item_id === phoId)?.qty ?? 0).toBe(0);

    // Đúng ngày đó, chọn cả hai đầu bằng nhau: mốc `to` phải GỒM cả ngày, không cắt lúc 00:00.
    const trong = await ky();
    expect(trong.items.find((x) => x.menu_item_id === phoId)?.qty).toBe(1);
  }, 20_000);
});

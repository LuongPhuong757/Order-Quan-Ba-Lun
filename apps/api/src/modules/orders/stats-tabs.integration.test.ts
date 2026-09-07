// Integration test cho `OrdersService.stats` theo TAB ở màn Lịch sử (2026-09-05).
//
// Vì sao PHẢI là integration, không mock: rủi ro duy nhất đáng test ở đây là SQL — mỗi tab đổi
// `scopeSql` (đơn nào được tính) và `itemStateSql` (món nào tính tiền), và cái sai kinh điển là
// "đổi tab mà số không đổi": người xem tưởng doanh thu 6,45tr là tiền chờ thu trong khi đó là
// giá trị đơn đã huỷ. Fake-repository không chứng minh được câu SQL nào đã thực sự chạy.
//
// `import 'dotenv/config'` BẮT BUỘC: `data-source.ts` đọc `process.env.MYSQL_PORT` trực tiếp —
// cùng lý do đã ghi ở `open-count.integration.test.ts`.
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

/** Tiền tố sentinel RIÊNG của file này — mỗi file integration một tiền tố, vì vitest chạy các
 * file song song trên cùng MySQL (xem chú thích cùng nội dung ở `open-count.integration.test.ts`). */
const SENTINEL_TABLE_PREFIX = 'stt92-';
const SENTINEL_LIKE = 'stt92-%';

let ds: DataSource;
let svc: OrdersService;
/** Cả test dùng ĐÚNG 1 bàn và luôn lọc `table_id` — nhờ vậy số liệu không lẫn với dữ liệu dev
 * có sẵn trong MySQL local, và các con số kỳ vọng là tuyệt đối chứ không phải hiệu số. */
let tableId: string;

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

/** 1 đơn + các món. `price` × 1 phần mỗi món để số kỳ vọng đọc thẳng ra được. */
async function insertOrder(opts: {
  closedAt: Date | null;
  isPaid: boolean;
  items: Array<{ state: string; price: number }>;
  shipFee?: number;
  misaCopied?: boolean;
}): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO orders
       (id, table_id, table_code, opened_at, closed_at, is_paid, source, ship_fee, misa_copied_at)
     VALUES (?, ?, ?, NOW(6), ?, ?, 'STAFF', ?, ?)`,
    [
      id,
      tableId,
      `${SENTINEL_TABLE_PREFIX}a`,
      opts.closedAt,
      opts.isPaid ? 1 : 0,
      opts.shipFee ?? 0,
      opts.misaCopied ? new Date() : null,
    ],
  );
  for (const it of opts.items) {
    await ds.query(
      `INSERT INTO order_items
        (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, created_at, updated_at)
       VALUES (?, ?, NULL, 'Món test', 1, ?, ?, NOW(6), NOW(6))`,
      [randomUUID(), id, it.price, it.state],
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
        '(vd `docker compose up -d mysql`). ' +
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
  const id = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active)
     VALUES (?, ?, ?, 'dine-in', 0, 0, 1)`,
    [id, `${SENTINEL_TABLE_PREFIX}a`, 'Bàn stats'],
  );
  tableId = id;

  // Đã thu tiền, ĐÃ gõ sang Misa: 100k món SERVED + 1 món huỷ (không được tính) + 20k ship.
  await insertOrder({
    closedAt: new Date(),
    isPaid: true,
    shipFee: 20_000,
    misaCopied: true,
    items: [{ state: 'SERVED', price: 100_000 }, { state: 'CANCELLED', price: 999_000 }],
  });
  // Đã thu tiền, CHƯA gõ Misa: 50k.
  await insertOrder({
    closedAt: new Date(),
    isPaid: true,
    shipFee: 5_000,
    items: [{ state: 'SERVED', price: 50_000 }],
  });
  // Kết đơn bằng HUỶ: 70k món bị huỷ.
  await insertOrder({
    closedAt: new Date(),
    isPaid: false,
    items: [{ state: 'CANCELLED', price: 70_000 }],
  });
  // Đang mở, còn món sống: 30k chờ thu.
  await insertOrder({ closedAt: null, isPaid: false, items: [{ state: 'READY', price: 30_000 }] });
});

describe('stats theo tab — mỗi tab một bộ số khác nhau', () => {
  it('tab "Tất cả": doanh thu = đơn đã thu tiền, đếm đủ 3 trạng thái', async () => {
    const s = await svc.stats({ table_id: tableId, status: 'all' });
    expect(s.paid_revenue).toBe(150_000);
    expect(s.ship_fee_total).toBe(25_000);
    expect(s.paid_count).toBe(2);
    expect(s.cancelled_count).toBe(1);
    expect(s.unpaid_count).toBe(1);
  }, 20_000);

  it('tab "Đã huỷ": tiền = GIÁ TRỊ MÓN BỊ HUỶ, không phải doanh thu', async () => {
    const s = await svc.stats({ table_id: tableId, status: 'cancelled' });
    // 70k của đơn huỷ. KHÔNG có 999k — món huỷ đó nằm trong đơn ĐÃ THU TIỀN, ngoài phạm vi tab.
    expect(s.paid_revenue).toBe(70_000);
    expect(s.cancelled_count).toBe(1);
    // 2 ô đếm kia về 0 → FE chỉ vẽ ô của tab đang chọn.
    expect(s.paid_count).toBe(0);
    expect(s.unpaid_count).toBe(0);
    expect(s.top_items.map((t) => t.revenue)).toEqual([70_000]);
  }, 20_000);

  it('tab "Chưa thanh toán": tiền = món chưa huỷ của đơn đang mở', async () => {
    const s = await svc.stats({ table_id: tableId, status: 'unpaid' });
    expect(s.paid_revenue).toBe(30_000);
    expect(s.unpaid_count).toBe(1);
    expect(s.paid_count).toBe(0);
    expect(s.cancelled_count).toBe(0);
    // Đơn chưa kết không có closed_at — thiếu COALESCE là cả tab rơi về 1970 và biểu đồ trống.
    expect(s.revenue_by_day.length).toBe(1);
    expect(s.revenue_by_day[0].day).not.toMatch(/^19/);
  }, 20_000);

  it('tab "Misa": chỉ đơn đã thu tiền VÀ đã gõ sang Misa', async () => {
    const s = await svc.stats({ table_id: tableId, misa: 'copied' });
    expect(s.paid_revenue).toBe(100_000);
    expect(s.ship_fee_total).toBe(20_000);
    expect(s.paid_count).toBe(1);
  }, 20_000);

  it('4 tab cho 4 con số tiền KHÁC nhau (bắt lỗi "đổi tab mà số không đổi")', async () => {
    const [all, cancelled, unpaid, misa] = await Promise.all([
      svc.stats({ table_id: tableId, status: 'all' }),
      svc.stats({ table_id: tableId, status: 'cancelled' }),
      svc.stats({ table_id: tableId, status: 'unpaid' }),
      svc.stats({ table_id: tableId, misa: 'copied' }),
    ]);
    const monies = [all.paid_revenue, cancelled.paid_revenue, unpaid.paid_revenue, misa.paid_revenue];
    expect(new Set(monies).size).toBe(4);
  }, 20_000);
});

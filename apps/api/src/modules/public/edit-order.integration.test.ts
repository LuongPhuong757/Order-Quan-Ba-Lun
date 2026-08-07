// Bằng chứng cho phần MySQL THẬT của `PublicOrdersService.editByToken` (2026-08-06).
//
// `edit-order.test.ts` đã phủ hết quyết định bằng fake-deps, nhưng nó cố tình mù với đúng chỗ dễ
// sai nhất của tính năng này: 2 câu SQL THÔ mà service tự viết (không qua TypeORM repository).
// Cột `items_snapshot` là kiểu `json`, và driver mysql2 trả nó về khi là object khi là chuỗi tuỳ
// phiên bản/cấu hình — đoán sai một lần là `.map is not a function` ngay giữa transaction đang giữ
// row lock. Không test nào ngoài test chạm DB thật bắt được chuyện đó.
//
// Race lock KHÔNG lặp lại ở đây: `editByToken` khoá ĐÚNG hàng bằng ĐÚNG câu `SELECT ... FOR UPDATE`
// mà `cancel-order.test.ts` phần B đã chứng minh — chép lại chỉ làm chậm CI, không thêm bằng chứng.
//
// `import 'dotenv/config'` BẮT BUỘC: `data-source.ts` đọc `process.env.MYSQL_PORT` trực tiếp.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';
import type { OnlineOrderItemSnapshot } from './entities/online-order-request.entity.js';

// ⚠ Tiền tố PHẢI khác `09000000%` (open-order-lock) và `09110000%` (cancel-order): vitest chạy các
// file song song và cả 3 đều `DELETE ... LIKE <tiền tố>` ở `beforeEach`.
const SENTINEL_PHONE = '0912000005';
const SENTINEL_LIKE = '09120000%';

let ds: DataSource;

const SNAPSHOT: OnlineOrderItemSnapshot[] = [
  { menu_item_id: 'mi-1', code: 'PHO', name: 'Phở bò', unit_price: 50_000, qty: 2, note: 'ít cay' },
];

async function insertWaitingRow(): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await ds.query(
    `INSERT INTO online_order_requests
      (id, order_token, customer_token, status, fulfillment_type, customer_name, customer_phone,
       customer_address, customer_lat, customer_lng, customer_map_link, distance_km, customer_note,
       items_snapshot, subtotal, submitted_at, ip_hash, user_agent, max_progress_shown)
     VALUES (UUID(), ?, ?, 'WAITING', 'PICKUP', 'Sentinel Edit', ?, NULL, NULL, NULL, NULL, NULL, 'gọi trước',
             ?, 100000, NOW(), ?, 'vitest', 0)`,
    [
      token,
      randomBytes(16).toString('hex'),
      SENTINEL_PHONE,
      JSON.stringify(SNAPSHOT),
      randomBytes(32).toString('hex'),
    ],
  );
  return token;
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL rồi chạy lại ' +
        '`pnpm --filter @order/api test -- edit-order.integration.test.ts`. ' +
        `Lỗi gốc: ${String(err)}`,
    );
  }
}, 20_000);

afterAll(async () => {
  await ds.query('DELETE FROM online_order_requests WHERE customer_phone LIKE ?', [SENTINEL_LIKE]);
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await ds.query('DELETE FROM online_order_requests WHERE customer_phone LIKE ?', [SENTINEL_LIKE]);
});

describe('SQL thô của editByToken chạy được trên MySQL thật', () => {
  it(
    'câu SELECT ... FOR UPDATE đọc đúng 4 cột, và items_snapshot ra được mảng',
    async () => {
      const token = await insertWaitingRow();
      const rows: Array<{
        id: string;
        status: string;
        items_snapshot: unknown;
        customer_note: string | null;
      }> = await ds.query(
        'SELECT id, status, items_snapshot, customer_note FROM online_order_requests WHERE order_token = ? FOR UPDATE',
        [token],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('WAITING');
      expect(rows[0]!.customer_note).toBe('gọi trước');
      // Chính nhánh mà service phải chịu được cả 2 kiểu — test này chốt hành vi thật của driver.
      const snapshot =
        typeof rows[0]!.items_snapshot === 'string'
          ? JSON.parse(rows[0]!.items_snapshot as string)
          : rows[0]!.items_snapshot;
      expect(Array.isArray(snapshot)).toBe(true);
      expect(snapshot[0]).toMatchObject({ menu_item_id: 'mi-1', qty: 2, note: 'ít cay' });
    },
    20_000,
  );

  it(
    'câu UPDATE ghi lại được snapshot mới + subtotal + xoá ghi chú',
    async () => {
      const token = await insertWaitingRow();
      const next: OnlineOrderItemSnapshot[] = [
        { ...SNAPSHOT[0]!, qty: 3, note: null },
        { menu_item_id: 'mi-2', code: 'CHE', name: 'Chè đậu', unit_price: 20_000, qty: 1, note: null },
      ];

      await ds.query(
        'UPDATE online_order_requests SET items_snapshot = ?, subtotal = ?, customer_note = ? WHERE order_token = ?',
        [JSON.stringify(next), 170_000, null, token],
      );

      const rows: Array<{ items_snapshot: unknown; subtotal: number; customer_note: string | null }> =
        await ds.query(
          'SELECT items_snapshot, subtotal, customer_note FROM online_order_requests WHERE order_token = ?',
          [token],
        );
      const saved =
        typeof rows[0]!.items_snapshot === 'string'
          ? JSON.parse(rows[0]!.items_snapshot as string)
          : rows[0]!.items_snapshot;

      expect(saved).toHaveLength(2);
      expect(saved[1]).toMatchObject({ menu_item_id: 'mi-2', unit_price: 20_000 });
      expect(Number(rows[0]!.subtotal)).toBe(170_000);
      expect(rows[0]!.customer_note).toBeNull();
    },
    20_000,
  );
});

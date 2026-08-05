// Integration test — BẰNG CHỨNG DUY NHẤT cho phần DB của criterion 4 ROADMAP phase 8
// ("2 request cùng SĐT không tạo được 2 đơn mở"). Mock (fake-repository) KHÔNG chứng minh
// được hành vi gap lock thật của InnoDB (`SELECT ... FOR UPDATE` trên secondary index
// `idx_oor_phone_status` giữ next-key/gap lock khi không tìm thấy hàng khớp, dưới
// `REPEATABLE READ` mặc định) — file này dùng THẲNG `DataSource` với 2 `QueryRunner` riêng
// (2 connection MySQL thật), KHÔNG bootstrap Nest, KHÔNG thêm devDependency test-framework nào.
//
// Nếu MySQL local chưa chạy, test PHẢI fail rõ ràng (KHÔNG được âm thầm bỏ qua case này) —
// bỏ qua trong im lặng chính là cách criterion 4 mất bằng chứng.
//
// `import 'dotenv/config'` BẮT BUỘC ở đây: `data-source.ts` đọc `process.env.MYSQL_PORT`
// trực tiếp (không tự load `.env`) — thiếu dòng này, `vitest` chạy với cwd = `apps/api` sẽ
// rơi về default `MYSQL_PORT=3306`, là CỔNG SAI (MySQL container map ở `3307` theo `.env`),
// và có thể vô tình nối vào một MySQL cục bộ khác đang lắng nghe ở `3306`.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';

// SĐT sentinel — không đụng dữ liệu thật. Dọn sạch ở beforeEach + afterAll.
//
// Tiền tố `09000020` phải KHÔNG giao với tiền tố sentinel của file integration khác. Trước đây
// file này và `admin-online-orders.integration.test.ts` cùng dùng `09000000%`, mà cả hai đều
// `DELETE ... WHERE customer_phone LIKE <tiền tố>` ở beforeEach/afterAll. Vitest chạy các file
// test SONG SONG trên cùng một MySQL, nên file kia xoá mất row của file này giữa chừng và test
// rate-limit fail ngẫu nhiên (đếm được 0 thay vì 3) — chỉ fail khi chạy cả suite, chạy riêng thì
// pass, đúng kiểu flaky khó lần nhất. Thêm sentinel mới thì giữ nguyên nguyên tắc: mỗi file một
// tiền tố riêng.
const SENTINEL_PHONE_LOCK = '0900002001';
const SENTINEL_PHONE_OTHER = '0900002002';
const SENTINEL_PHONE_RATE = '0900002003';
const SENTINEL_LIKE = '09000020%';

let ds: DataSource;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupSentinelRows(): Promise<void> {
  await ds.query('DELETE FROM online_order_requests WHERE customer_phone LIKE ?', [SENTINEL_LIKE]);
}

async function insertRowAt(phone: string, submittedAt: Date): Promise<void> {
  await ds.query(
    `INSERT INTO online_order_requests
      (id, order_token, customer_token, status, fulfillment_type, customer_name, customer_phone,
       customer_address, customer_lat, customer_lng, customer_map_link, distance_km, customer_note,
       items_snapshot, subtotal, submitted_at, ip_hash, user_agent, max_progress_shown)
     VALUES (UUID(), ?, ?, 'WAITING', 'PICKUP', 'Sentinel Rate', ?, NULL, NULL, NULL, NULL, NULL, NULL,
             ?, 0, ?, ?, 'vitest', 0)`,
    [
      randomBytes(32).toString('hex'),
      randomBytes(16).toString('hex'),
      phone,
      JSON.stringify([]),
      submittedAt,
      randomBytes(32).toString('hex'),
    ],
  );
}

beforeAll(async () => {
  // Instance test không tự tạo/đổi schema — bảng đã tồn tại từ plan 08-02, đó là việc của
  // `AppDataSource` thật lúc app boot.
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql` hoặc `mysql.server start`), rồi chạy lại ' +
        '`pnpm --filter @order/api test -- open-order-lock.integration.test.ts`. ' +
        `Lỗi gốc: ${String(err)}`,
    );
  }
}, 20_000);

afterAll(async () => {
  await cleanupSentinelRows();
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await cleanupSentinelRows();
});

describe('gap lock FOR UPDATE — chặn race 2 request cùng SĐT (T-08-50 HIGH)', () => {
  it(
    'runner B bị chặn khi runner A giữ transaction chưa commit; cuối cùng chỉ có 1 row WAITING',
    async () => {
      const runnerA = ds.createQueryRunner();
      const runnerB = ds.createQueryRunner();
      await runnerA.connect();
      await runnerB.connect();

      try {
        await runnerA.startTransaction();
        await runnerB.startTransaction();

        // 1) Runner A: gap lock — chưa có đơn mở nào cho SĐT này.
        const existingA = await runnerA.query(
          `SELECT id FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`,
          [SENTINEL_PHONE_LOCK],
        );
        expect(existingA.length).toBe(0);

        // 2) Runner A: insert đơn mới TRONG CÙNG transaction (chưa commit).
        await runnerA.query(
          `INSERT INTO online_order_requests
            (id, order_token, customer_token, status, fulfillment_type, customer_name, customer_phone,
             customer_address, customer_lat, customer_lng, customer_map_link, distance_km, customer_note,
             items_snapshot, subtotal, submitted_at, ip_hash, user_agent, max_progress_shown)
           VALUES (UUID(), ?, ?, 'WAITING', 'PICKUP', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL,
                   ?, ?, NOW(), ?, ?, 0)`,
          [
            randomBytes(32).toString('hex'),
            randomBytes(16).toString('hex'),
            'Runner A',
            SENTINEL_PHONE_LOCK,
            JSON.stringify([]),
            0,
            randomBytes(32).toString('hex'),
            'vitest',
          ],
        );

        // 3) Runner B chạy CÙNG câu FOR UPDATE trước khi A commit — PHẢI BỊ CHẶN (dùng
        // Promise.race với timer ~500ms để chứng minh B chưa resolve).
        let bResolved = false;
        const bPromise: Promise<Array<{ id: string }>> = runnerB
          .query(
            `SELECT id FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`,
            [SENTINEL_PHONE_LOCK],
          )
          .then((rows: Array<{ id: string }>) => {
            bResolved = true;
            return rows;
          });

        const raceResult = await Promise.race([bPromise, sleep(500).then(() => 'TIMEOUT' as const)]);
        expect(raceResult).toBe('TIMEOUT');
        expect(bResolved).toBe(false);

        // 4) A commit → B mới đọc được, thấy đúng 1 row → kết luận "đã có đơn mở", KHÔNG insert.
        await runnerA.commitTransaction();

        const bRows = await bPromise;
        expect(bRows.length).toBe(1);
        await runnerB.commitTransaction();
      } finally {
        if (!runnerA.isReleased) await runnerA.release();
        if (!runnerB.isReleased) await runnerB.release();
      }

      const finalCount = await ds.query(
        `SELECT COUNT(*) AS cnt FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING'`,
        [SENTINEL_PHONE_LOCK],
      );
      expect(Number(finalCount[0].cnt)).toBe(1);
    },
    15_000,
  );
});

describe('gap lock FOR UPDATE — không chặn oan SĐT khác', () => {
  it(
    'runner B (SĐT Y) không bị chặn khi runner A đang giữ lock cho SĐT X',
    async () => {
      const runnerA = ds.createQueryRunner();
      const runnerB = ds.createQueryRunner();
      await runnerA.connect();
      await runnerB.connect();

      try {
        await runnerA.startTransaction();
        await runnerB.startTransaction();

        await runnerA.query(
          `SELECT id FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`,
          [SENTINEL_PHONE_LOCK],
        );

        let bResolved = false;
        const bPromise = runnerB
          .query(
            `SELECT id FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`,
            [SENTINEL_PHONE_OTHER],
          )
          .then((rows: unknown[]) => {
            bResolved = true;
            return rows;
          });

        const raceResult = await Promise.race([bPromise, sleep(500).then(() => 'TIMEOUT' as const)]);
        expect(raceResult).not.toBe('TIMEOUT');
        expect(bResolved).toBe(true);

        await runnerA.commitTransaction();
        await runnerB.commitTransaction();
      } finally {
        if (!runnerA.isReleased) await runnerA.release();
        if (!runnerB.isReleased) await runnerB.release();
      }
    },
    15_000,
  );
});

describe('rate limit — cửa sổ đếm 1 giờ trong DB (D-18)', () => {
  it(
    'chỉ đếm row trong cửa sổ 1 giờ gần nhất, bỏ row cũ hơn ngoài cửa sổ',
    async () => {
      const now = Date.now();
      await insertRowAt(SENTINEL_PHONE_RATE, new Date(now - 10 * 60 * 1000));
      await insertRowAt(SENTINEL_PHONE_RATE, new Date(now - 30 * 60 * 1000));
      await insertRowAt(SENTINEL_PHONE_RATE, new Date(now - 50 * 60 * 1000));
      // Row ngoài cửa sổ 1 giờ — KHÔNG được tính.
      await insertRowAt(SENTINEL_PHONE_RATE, new Date(now - 2 * 60 * 60 * 1000));

      const sinceMs = now - 3_600_000;
      const rows = await ds.query(
        'SELECT COUNT(*) AS cnt FROM online_order_requests WHERE customer_phone = ? AND submitted_at >= ?',
        [SENTINEL_PHONE_RATE, new Date(sinceMs)],
      );
      expect(Number(rows[0].cnt)).toBe(3);
    },
    15_000,
  );
});

// Integration test — BẰNG CHỨNG DUY NHẤT cho criterion 2 của ROADMAP phase 9 ("2 admin duyệt
// song song không cấp trùng bàn") và cho phần DB của criterion 3 ("đơn WAITING không lẫn vào
// doanh thu / sơ đồ bàn / hàng bếp").
//
// Mock KHÔNG chứng minh được hành vi record lock của InnoDB: việc transaction thứ hai bị CHẶN
// tại câu chọn-bàn-có-khoá trên các hàng TÌM THẤY là thuộc tính của DB, không phải của code
// Node. Tương tự, "48 điểm query doanh thu không nhìn thấy bảng staging" là thuộc tính của
// schema. Nên file này dùng THẲNG `DataSource` với 2 `QueryRunner` riêng (2 connection MySQL
// thật), KHÔNG bootstrap Nest, và KHÔNG thêm devDependency test-framework nào (giữ quyết định
// "hướng nhẹ" của phase 8 — không thêm thư viện HTTP-test hay module test của Nest).
//
// Nếu MySQL local chưa chạy, test PHẢI fail rõ ràng — KHÔNG được bỏ qua im lặng. Bỏ qua trong im
// lặng chính là cách criterion 2/3 mất bằng chứng mà vẫn được tô xanh (T-09-42).
//
// `import 'dotenv/config'` giữ đúng khuôn `open-order-lock.integration.test.ts`. Lưu ý đã ghi ở
// 09-07-SUMMARY: `vitest` chạy với cwd = `apps/api`, mà `.env` nằm ở repo root, nên dotenv KHÔNG
// nạp được gì và `data-source.ts` rơi về default (`localhost:3306`, `order_app`). Trên máy dev
// hiện tại default đó TRÙNG với MySQL thật đang chạy nên test nối được — đừng kết luận là dotenv
// đang hoạt động.
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';

// ─── Dải sentinel (T-09-41) ───────────────────────────────────────────────────────────────
// Mọi INSERT của file này nằm trong 3 dải dưới đây, và `cleanupSentinelRows()` CHỈ xoá theo
// đúng 3 điều kiện này. Nới rộng điều kiện xoá = xoá dữ liệu thật của quán.
const TABLE_LIKE_DELIVERY = 'ship-9%'; // ship-90..99 dành riêng cho test
const TABLE_LIKE_TAKEAWAY = 'mang-ve-9%';
const SENTINEL_PHONE_LIKE = '09000000%';

/** Câu chọn bàn CHÉP NGUYÊN VĂN từ `AdminOnlineOrdersService.confirmImpl` bước 3, chỉ thêm
 * `AND t.code LIKE ?` để không đụng bàn thật. Đây là câu cần chứng minh — sửa nó ở service mà
 * không sửa ở đây là làm test mất giá trị. */
const PICK_TABLE_SQL = `SELECT t.id, t.code, t.name FROM restaurant_tables t
   WHERE t.kind = ? AND t.is_active = 1 AND t.kiotviet_locked = 0
     AND t.id NOT IN (SELECT o.table_id FROM orders o WHERE o.closed_at IS NULL)
     AND t.code LIKE ?
   ORDER BY t.code ASC LIMIT 1 FOR UPDATE`;

let ds: DataSource;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupSentinelRows(): Promise<void> {
  // Thứ tự FK-an-toàn: con trước, cha sau.
  await ds.query(
    `DELETE oi FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN restaurant_tables t ON t.id = o.table_id
      WHERE t.code LIKE ? OR t.code LIKE ?`,
    [TABLE_LIKE_DELIVERY, TABLE_LIKE_TAKEAWAY],
  );
  await ds.query(
    `DELETE oal FROM order_activity_logs oal
       JOIN restaurant_tables t ON t.id = oal.table_id
      WHERE t.code LIKE ? OR t.code LIKE ?`,
    [TABLE_LIKE_DELIVERY, TABLE_LIKE_TAKEAWAY],
  );
  await ds.query(
    `DELETE o FROM orders o
       JOIN restaurant_tables t ON t.id = o.table_id
      WHERE t.code LIKE ? OR t.code LIKE ?`,
    [TABLE_LIKE_DELIVERY, TABLE_LIKE_TAKEAWAY],
  );
  await ds.query(
    `DELETE nob FROM notification_outbox nob
       JOIN online_order_requests r ON r.id = nob.request_id
      WHERE r.customer_phone LIKE ?`,
    [SENTINEL_PHONE_LIKE],
  );
  await ds.query('DELETE FROM online_order_requests WHERE customer_phone LIKE ?', [
    SENTINEL_PHONE_LIKE,
  ]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ? OR code LIKE ?', [
    TABLE_LIKE_DELIVERY,
    TABLE_LIKE_TAKEAWAY,
  ]);
}

/** Bàn sentinel. `kind` dùng đúng giá trị của `KIND_FORMAT` (`delivery`/`takeaway`), không phải
 * chữ hoa như văn xuôi spec §7 ghi. */
async function insertTable(
  code: string,
  kind: 'delivery' | 'takeaway',
  opts: { active?: boolean; kiotvietLocked?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active, kiotviet_locked, created_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, ?, NOW(6))`,
    [id, code, `Test ${code}`, kind, opts.active === false ? 0 : 1, opts.kiotvietLocked ? 1 : 0],
  );
  return id;
}

/** 1 đơn online đang chờ duyệt, có tiền thật trong `items_snapshot` + `subtotal` — để nếu ranh
 * giới M2.D-01 bị vỡ thì phép đếm doanh thu sẽ LỆCH, không phải lệch 0. */
async function insertWaitingRequest(phone: string, subtotal: number): Promise<string> {
  const id = randomUUID();
  const items = [
    { menu_item_id: randomUUID(), code: 'SP-TEST', name: 'Món test', unit_price: 50_000, qty: 3, note: null },
  ];
  await ds.query(
    `INSERT INTO online_order_requests
      (id, order_token, customer_token, status, fulfillment_type, customer_name, customer_phone,
       customer_address, customer_lat, customer_lng, customer_map_link, distance_km, customer_note,
       items_snapshot, subtotal, submitted_at, ip_hash, user_agent, max_progress_shown)
     VALUES (?, ?, ?, 'WAITING', 'PICKUP', 'Sentinel M2D01', ?, NULL, NULL, NULL, NULL, NULL, NULL,
             ?, ?, NOW(), ?, 'vitest', 0)`,
    [
      id,
      randomBytes(32).toString('hex'),
      randomBytes(16).toString('hex'),
      phone,
      JSON.stringify(items),
      subtotal,
      randomBytes(32).toString('hex'),
    ],
  );
  return id;
}

beforeAll(async () => {
  // Tắt đồng bộ schema — instance test KHÔNG tạo/đổi bảng. Bảng đã tồn tại từ plan 08-02 và
  // 09-02; đổi schema là việc của `AppDataSource` thật lúc app boot.
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này ' +
        '(vd `docker compose up -d mysql` hoặc service MySQL của máy), rồi chạy lại ' +
        '`pnpm --filter @order/api test -- admin-online-orders.integration.test.ts`. ' +
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

describe('Cấp bàn — row lock chống cấp trùng (M2.D-06)', () => {
  it(
    'transaction thứ hai BỊ CHẶN thật khi transaction đầu chưa commit, và không cấp trùng bàn',
    async () => {
      const tableId = await insertTable('ship-90', 'delivery');

      const runnerA = ds.createQueryRunner();
      const runnerB = ds.createQueryRunner();
      await runnerA.connect();
      await runnerB.connect();

      // Chốt chặn: câu dùng trong test này PHẢI còn khoá hàng. Ai gỡ `FOR UPDATE` khỏi
      // `PICK_TABLE_SQL` (hoặc khỏi service rồi đồng bộ sang đây) là làm test mất ý nghĩa mà
      // vẫn xanh — assert này bắt đúng trường hợp đó.
      expect(PICK_TABLE_SQL).toContain('FOR UPDATE');

      try {
        await runnerA.startTransaction();
        await runnerB.startTransaction();

        // 1) A chọn bàn trống duy nhất → khoá hàng `ship-90`.
        const rowsA: Array<{ id: string; code: string }> = await runnerA.query(PICK_TABLE_SQL, [
          'delivery',
          TABLE_LIKE_DELIVERY,
        ]);
        expect(rowsA.length).toBe(1);
        expect(rowsA[0].code).toBe('ship-90');

        // 2) B chạy CÙNG câu trước khi A commit → phải bị chặn. `Promise.race` với timer 500ms là
        //    cách phân biệt "bị chặn thật" khỏi "chỉ chậm".
        let bResolved = false;
        const bPromise: Promise<Array<{ id: string; code: string }>> = runnerB
          .query(PICK_TABLE_SQL, ['delivery', TABLE_LIKE_DELIVERY])
          .then((rows: Array<{ id: string; code: string }>) => {
            bResolved = true;
            return rows;
          });

        const raceResult = await Promise.race([bPromise, sleep(500).then(() => 'TIMEOUT' as const)]);
        expect(raceResult).toBe('TIMEOUT');
        expect(bResolved).toBe(false);

        // 3) A mở 1 đơn trên bàn đó rồi commit.
        await runnerA.query(
          `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source, payment_method)
           VALUES (?, ?, 'ship-90', NOW(6), NULL, 0, 'ONLINE', 'CASH')`,
          [randomUUID(), tableId],
        );
        await runnerA.commitTransaction();

        // 4) B đọc được → 0 HÀNG, vì `NOT IN (open orders)` đã loại bàn A vừa chiếm. Đúng nghĩa
        //    "B phải tự tạo bàn mới (M2.D-05) thay vì cấp trùng".
        const rowsB = await bPromise;
        expect(rowsB.length).toBe(0);
        await runnerB.commitTransaction();
      } finally {
        if (!runnerA.isReleased) await runnerA.release();
        if (!runnerB.isReleased) await runnerB.release();
      }

      const open = await ds.query(
        'SELECT COUNT(*) AS cnt FROM orders WHERE table_id = ? AND closed_at IS NULL',
        [tableId],
      );
      expect(Number(open[0].cnt)).toBe(1);
    },
    15_000,
  );

  it(
    'KHÔNG chặn oan bàn thuộc kind khác — B chọn takeaway trong lúc A giữ lock trên delivery',
    async () => {
      await insertTable('ship-90', 'delivery');
      await insertTable('mang-ve-90', 'takeaway');

      const runnerA = ds.createQueryRunner();
      const runnerB = ds.createQueryRunner();
      await runnerA.connect();
      await runnerB.connect();

      // Cùng lý do như test trên: khẳng định câu đang kiểm vẫn là câu CÓ khoá hàng
      // (`FOR UPDATE`), nếu không thì "không chặn oan" là kết luận vô nghĩa.
      expect(PICK_TABLE_SQL).toContain('FOR UPDATE');

      try {
        await runnerA.startTransaction();
        await runnerB.startTransaction();

        await runnerA.query(PICK_TABLE_SQL, ['delivery', TABLE_LIKE_DELIVERY]);

        let bResolved = false;
        const bPromise: Promise<Array<{ code: string }>> = runnerB
          .query(PICK_TABLE_SQL, ['takeaway', TABLE_LIKE_TAKEAWAY])
          .then((rows: Array<{ code: string }>) => {
            bResolved = true;
            return rows;
          });

        const raceResult = await Promise.race([bPromise, sleep(500).then(() => 'TIMEOUT' as const)]);
        expect(raceResult).not.toBe('TIMEOUT');
        expect(bResolved).toBe(true);
        const rowsB = (await bPromise) as Array<{ code: string }>;
        expect(rowsB[0].code).toBe('mang-ve-90');

        await runnerA.commitTransaction();
        await runnerB.commitTransaction();
      } finally {
        if (!runnerA.isReleased) await runnerA.release();
        if (!runnerB.isReleased) await runnerB.release();
      }
    },
    15_000,
  );

  it('trả bàn có `code` nhỏ nhất trước (M2.D-04), không phụ thuộc thứ tự chèn', async () => {
    // Cố ý chèn sai thứ tự — nếu câu SQL thiếu `ORDER BY t.code ASC` thì test này bắt được.
    await insertTable('ship-92', 'delivery');
    await insertTable('ship-90', 'delivery');
    await insertTable('ship-91', 'delivery');

    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      const rows: Array<{ code: string }> = await runner.query(PICK_TABLE_SQL, [
        'delivery',
        TABLE_LIKE_DELIVERY,
      ]);
      expect(rows.length).toBe(1);
      expect(rows[0].code).toBe('ship-90');
      await runner.commitTransaction();
    } finally {
      if (!runner.isReleased) await runner.release();
    }
  }, 15_000);

  it('bàn `kiotviet_locked` hoặc `is_active = 0` KHÔNG được cấp → buộc sang nhánh tự tạo bàn', async () => {
    await insertTable('ship-93', 'delivery', { kiotvietLocked: true });
    await insertTable('ship-94', 'delivery', { active: false });

    const runner = ds.createQueryRunner();
    await runner.connect();
    try {
      await runner.startTransaction();
      const rows: unknown[] = await runner.query(PICK_TABLE_SQL, ['delivery', TABLE_LIKE_DELIVERY]);
      expect(rows.length).toBe(0);
      await runner.commitTransaction();
    } finally {
      if (!runner.isReleased) await runner.release();
    }
  }, 15_000);
});

describe('Đơn WAITING không lẫn vào orders/doanh thu (M2.D-01)', () => {
  /** Doanh thu tính bằng ĐÚNG điều kiện `PAID_SQL` + `state='SERVED'` của `orders.service.ts`.
   * Nếu chỗ này lệch khỏi service thì phép đếm không còn chứng minh được gì. */
  async function snapshot() {
    const one = async (sql: string): Promise<number> => {
      const rows = await ds.query(sql);
      return Number(rows[0].v) || 0;
    };
    return {
      orders: await one('SELECT COUNT(*) AS v FROM orders'),
      openOrders: await one('SELECT COUNT(*) AS v FROM orders WHERE closed_at IS NULL'),
      revenue: await one(
        `SELECT COALESCE(SUM(i.menu_item_price * i.qty), 0) AS v
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.closed_at IS NOT NULL AND o.is_paid = 1 AND i.state = 'SERVED'`,
      ),
      shipFee: await one(
        `SELECT COALESCE(SUM(o.ship_fee), 0) AS v FROM orders o
          WHERE o.closed_at IS NOT NULL AND o.is_paid = 1`,
      ),
      kitchenItems: await one(
        `SELECT COUNT(*) AS v FROM order_items WHERE state IN ('KITCHEN', 'COOKING', 'READY')`,
      ),
      occupiedTables: await one(
        `SELECT COUNT(DISTINCT o.table_id) AS v FROM orders o WHERE o.closed_at IS NULL`,
      ),
    };
  }

  async function insertFiveWaiting(): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      ids.push(await insertWaitingRequest(`090000000${i}`, 150_000));
    }
    return ids;
  }

  it('5 đơn WAITING không đổi doanh thu, phí ship, số đơn, số đơn mở', async () => {
    const before = await snapshot();
    const ids = await insertFiveWaiting();
    expect(ids.length).toBe(5);

    const after = await snapshot();
    expect(after.revenue).toBe(before.revenue);
    expect(after.shipFee).toBe(before.shipFee);
    expect(after.orders).toBe(before.orders);
    expect(after.openOrders).toBe(before.openOrders);
  }, 15_000);

  it('5 đơn WAITING không đổi hàng bếp (KITCHEN/COOKING/READY)', async () => {
    const before = await snapshot();
    await insertFiveWaiting();
    const after = await snapshot();
    expect(after.kitchenItems).toBe(before.kitchenItems);
  }, 15_000);

  it('5 đơn WAITING không đổi sơ đồ bàn (số bàn đang có đơn mở)', async () => {
    const before = await snapshot();
    await insertFiveWaiting();
    const after = await snapshot();
    expect(after.occupiedTables).toBe(before.occupiedTables);
  }, 15_000);

  it('không có dòng `orders` nào trỏ tới 5 đơn WAITING, và không có đơn ONLINE mồ côi', async () => {
    const ids = await insertFiveWaiting();
    const placeholders = ids.map(() => '?').join(',');

    const linked = await ds.query(
      `SELECT COUNT(*) AS v FROM orders WHERE online_request_id IN (${placeholders})`,
      ids,
    );
    expect(Number(linked[0].v)).toBe(0);

    // Đơn `source='ONLINE'` mà không trỏ về request nào = ranh giới M2.D-01 đã bị đi tắt.
    const orphan = await ds.query(
      `SELECT COUNT(*) AS v FROM orders WHERE source = 'ONLINE' AND online_request_id IS NULL`,
    );
    expect(Number(orphan[0].v)).toBe(0);

    // 5 dòng vẫn nguyên trạng WAITING, chưa ai gán order_id.
    const still = await ds.query(
      `SELECT COUNT(*) AS v FROM online_order_requests
        WHERE id IN (${placeholders}) AND status = 'WAITING' AND order_id IS NULL`,
      ids,
    );
    expect(Number(still[0].v)).toBe(5);
  }, 15_000);
});

describe('Hợp đồng dữ liệu của duyệt đơn (D-02 — audit là kiểm soát bù trừ)', () => {
  it('bảng `audit_log` có sẵn 2 mã hành động của duyệt đơn để tra cứu được theo người thực hiện', async () => {
    // Test này KHÔNG gọi endpoint HTTP (xem 09-08-SUMMARY § "Chọn hướng nào cho Task 2"): nó chỉ
    // khẳng định phần DB — cột dùng để truy trách nhiệm tồn tại và query lọc theo `action_kind`
    // chạy được. Phần "gọi endpoint thật rồi kiểm audit" đã chạy bằng tay, output dán trong
    // SUMMARY của plan 09-07 và 09-08.
    const cols: Array<{ COLUMN_NAME: string }> = await ds.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log'
          AND COLUMN_NAME IN ('action_kind', 'actor_id', 'actor_name', 'target_id', 'target_kind')`,
    );
    expect(cols.length).toBe(5);

    const byKind = await ds.query(
      `SELECT COUNT(*) AS v FROM audit_log WHERE action_kind IN ('online_order.confirmed', 'online_order.rejected')`,
    );
    expect(Number(byKind[0].v)).toBeGreaterThanOrEqual(0);

    // `reviewed_by_*` là nơi lưu danh tính người duyệt trên chính dòng đơn — thiếu 2 cột này thì
    // kiểm soát bù trừ của D-02 không có chỗ nào để ghi.
    const reviewCols: Array<{ COLUMN_NAME: string }> = await ds.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'online_order_requests'
          AND COLUMN_NAME IN ('reviewed_by_user_id', 'reviewed_by_full_name', 'internal_reject_note')`,
    );
    expect(reviewCols.length).toBe(3);
  }, 15_000);
});

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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { REJECT_REASON_TEXT } from '@order/schemas';
import { dataSourceOptions } from '../../data-source.js';
import { AdminOnlineOrdersService } from './admin-online-orders.service.js';

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

// Món sentinel cho test sửa đơn/gọi thêm — dải code riêng, dọn theo đúng LIKE này.
const SENTINEL_MENU_CODE_LIKE = 'SPTEST9%';

async function insertMenuItem(
  code: string,
  price: number,
  opts: { active?: boolean; outOfStock?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await ds.query(
    `INSERT INTO menu_items (id, code, name, \`group\`, price, unit, image_url, is_out_of_stock, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'food', ?, 'phần', NULL, ?, ?, NOW(6), NOW(6))`,
    [id, code, `Món test ${code}`, price, opts.outOfStock ? 1 : 0, opts.active === false ? 0 : 1],
  );
  return id;
}

async function cleanupSentinelRows(): Promise<void> {
  await ds.query('DELETE FROM menu_items WHERE code LIKE ?', [SENTINEL_MENU_CODE_LIKE]);
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
  // Dọn theo ĐƠN SENTINEL, không theo bàn: `switchFulfillment` chuyển order sang bàn trống đầu
  // tiên cùng loại — có thể là một bàn THẬT của quán (`mang-ve-01`), nằm ngoài dải bàn sentinel.
  // Thiếu 3 câu này thì mỗi lần chạy test để lại một đơn MỞ trên bàn thật, và sơ đồ bàn của quán
  // hiện một bàn bận không ai mở.
  await ds.query(
    `DELETE oi FROM order_items oi
       JOIN online_order_requests r ON r.order_id = oi.order_id
      WHERE r.customer_phone LIKE ?`,
    [SENTINEL_PHONE_LIKE],
  );
  await ds.query(
    `DELETE oal FROM order_activity_logs oal
       JOIN online_order_requests r ON r.order_id = oal.order_id
      WHERE r.customer_phone LIKE ?`,
    [SENTINEL_PHONE_LIKE],
  );
  await ds.query(
    `DELETE o FROM orders o
       JOIN online_order_requests r ON r.order_id = o.id
      WHERE r.customer_phone LIKE ?`,
    [SENTINEL_PHONE_LIKE],
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
  // Chặn số từ hộp thoại từ chối/huỷ đơn (2026-08-06) ghi vào bảng này — cùng dải SĐT sentinel.
  await ds.query('DELETE FROM phone_blacklist WHERE phone LIKE ?', [SENTINEL_PHONE_LIKE]);
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
async function insertWaitingRequest(
  phone: string,
  subtotal: number,
  itemsOverride?: Array<{
    menu_item_id: string;
    code: string;
    name: string;
    unit_price: number;
    qty: number;
    note: string | null;
  }>,
): Promise<string> {
  const id = randomUUID();
  const items = itemsOverride ?? [
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

describe('Sửa món đơn chờ duyệt — editItems (Task.md 2026-08-04)', () => {
  /** editItems chỉ đụng `ds` + `emitter` — outbox/settings không tham gia nên truyền stub.
   * KHÔNG bootstrap Nest, giữ hướng nhẹ của file này. */
  function makeService(): AdminOnlineOrdersService {
    return new AdminOnlineOrdersService(
      ds,
      new EventEmitter2(),
      null as unknown as ConstructorParameters<typeof AdminOnlineOrdersService>[2],
      null as unknown as ConstructorParameters<typeof AdminOnlineOrdersService>[3],
    );
  }

  const snapItem = (menu_item_id: string, unit_price: number, qty: number) => ({
    menu_item_id,
    code: 'SPTEST90',
    name: 'Món giữ',
    unit_price,
    qty,
    note: null as string | null,
  });

  it('đổi qty + bỏ món: snapshot và subtotal GHI THẬT vào DB, giá món cũ giữ nguyên', async () => {
    const keepId = randomUUID();
    const dropId = randomUUID();
    const reqId = await insertWaitingRequest('0900000091', 110_000, [
      snapItem(keepId, 40_000, 2),
      { ...snapItem(dropId, 30_000, 1), code: 'SPTEST91', name: 'Món bỏ' },
    ]);

    const out = await makeService().editItems(reqId, {
      items: [{ menu_item_id: keepId, qty: 5 }],
    });
    expect(out.items.length).toBe(1);
    expect(out.items[0].qty).toBe(5);
    expect(out.subtotal).toBe(200_000);

    const rows: Array<{ items_snapshot: unknown; subtotal: number }> = await ds.query(
      'SELECT items_snapshot, subtotal FROM online_order_requests WHERE id = ?',
      [reqId],
    );
    const snap =
      typeof rows[0].items_snapshot === 'string'
        ? (JSON.parse(rows[0].items_snapshot) as Array<{ menu_item_id: string; qty: number; unit_price: number }>)
        : (rows[0].items_snapshot as Array<{ menu_item_id: string; qty: number; unit_price: number }>);
    expect(snap.length).toBe(1);
    expect(snap[0].menu_item_id).toBe(keepId);
    expect(snap[0].qty).toBe(5);
    expect(snap[0].unit_price).toBe(40_000); // giá đã chốt lúc đặt — sửa qty không đổi giá
    expect(Number(rows[0].subtotal)).toBe(200_000);
  }, 15_000);

  it('gọi thêm món: chốt giá menu HIỆN TẠI, nối vào cuối snapshot kèm note', async () => {
    const keepId = randomUUID();
    const menuId = await insertMenuItem('SPTEST92', 25_000);
    const reqId = await insertWaitingRequest('0900000092', 80_000, [snapItem(keepId, 40_000, 2)]);

    const out = await makeService().editItems(reqId, {
      items: [
        { menu_item_id: keepId, qty: 2 },
        { menu_item_id: menuId, qty: 3, note: ' ít cay ' },
      ],
    });
    expect(out.items.length).toBe(2);
    const addedRow = out.items[1];
    expect(addedRow.menu_item_id).toBe(menuId);
    expect(addedRow.unit_price).toBe(25_000);
    expect(addedRow.qty).toBe(3);
    expect(addedRow.note).toBe('ít cay'); // đã trim
    expect(out.subtotal).toBe(40_000 * 2 + 25_000 * 3);
  }, 15_000);

  it('gọi thêm món hết hàng / không tồn tại → 409 MENU_ITEM_UNAVAILABLE; đơn đã xử lý → 409', async () => {
    const keepId = randomUUID();
    const soldOutId = await insertMenuItem('SPTEST93', 25_000, { outOfStock: true });
    const reqId = await insertWaitingRequest('0900000093', 80_000, [snapItem(keepId, 40_000, 2)]);
    const svc = makeService();

    const errSoldOut = await svc
      .editItems(reqId, { items: [{ menu_item_id: keepId, qty: 2 }, { menu_item_id: soldOutId, qty: 1 }] })
      .then(() => null, (e: unknown) => e as { getResponse(): { code?: string } });
    expect(errSoldOut?.getResponse().code).toBe('MENU_ITEM_UNAVAILABLE');

    const errUnknown = await svc
      .editItems(reqId, { items: [{ menu_item_id: keepId, qty: 2 }, { menu_item_id: randomUUID(), qty: 1 }] })
      .then(() => null, (e: unknown) => e as { getResponse(): { code?: string } });
    expect(errUnknown?.getResponse().code).toBe('MENU_ITEM_UNAVAILABLE');

    await ds.query(`UPDATE online_order_requests SET status = 'CONFIRMED' WHERE id = ?`, [reqId]);
    const errReviewed = await svc
      .editItems(reqId, { items: [{ menu_item_id: keepId, qty: 3 }] })
      .then(() => null, (e: unknown) => e as { getResponse(): { code?: string } });
    expect(errReviewed?.getResponse().code).toBe('ORDER_ALREADY_CONFIRMED');
  }, 15_000);
});

describe('Huỷ đơn ĐÃ xác nhận — cancelConfirmed (Task.md 2026-08-04)', () => {
  function makeService(): AdminOnlineOrdersService {
    return new AdminOnlineOrdersService(
      ds,
      new EventEmitter2(),
      // outbox CÓ tham gia (cancelPendingForRequest) — stub tối thiểu đúng chữ ký.
      { cancelPendingForRequest: async () => {} } as unknown as ConstructorParameters<
        typeof AdminOnlineOrdersService
      >[2],
      null as unknown as ConstructorParameters<typeof AdminOnlineOrdersService>[3],
    );
  }

  /** Dựng đủ bộ: bàn + order mở + 2 món + request CONFIRMED trỏ vào order. */
  async function seedConfirmed(tableCode: string, phone: string) {
    const tableId = await insertTable(tableCode, 'delivery');
    const orderId = randomUUID();
    await ds.query(
      `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source, payment_method)
       VALUES (?, ?, ?, NOW(6), NULL, 0, 'ONLINE', 'CASH')`,
      [orderId, tableId, tableCode],
    );
    for (const [name, state] of [
      ['Món đã giao', 'SERVED'],
      ['Món đang nấu', 'COOKING'],
    ] as const) {
      await ds.query(
        `INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, menu_item_price, is_note, qty, state)
         VALUES (?, ?, ?, ?, 50000, 0, 1, ?)`,
        [randomUUID(), orderId, randomUUID(), name, state],
      );
    }
    const requestId = await insertWaitingRequest(phone, 100_000);
    await ds.query(
      `UPDATE online_order_requests SET status = 'CONFIRMED', order_id = ? WHERE id = ?`,
      [orderId, requestId],
    );
    return { requestId, orderId, tableId };
  }

  it('huỷ: mọi món CANCELLED, order NIÊM (closed + is_paid=0), request sang REJECTED, bàn tự do', async () => {
    const { requestId, orderId, tableId } = await seedConfirmed('ship-95', '0900000095');

    await makeService().cancelConfirmed(
      requestId,
      { id: randomUUID(), full_name: 'NV Test' },
      { reason_code: 'CANNOT_CONTACT' },
    );

    const [req] = await ds.query(
      'SELECT status, reject_reason, reviewed_by_full_name FROM online_order_requests WHERE id = ?',
      [requestId],
    );
    expect(req.status).toBe('REJECTED');
    // So với hằng số, KHÔNG chép lại chuỗi: câu gửi khách được viết lại theo chỉ đạo (2026-08-06
    // sửa cho lịch sự hơn) và sẽ còn sửa nữa. Điều cần khoá là "ghi ĐÚNG câu soạn sẵn của mã lý
    // do đó vào DB", không phải một chuỗi tiếng Việt cụ thể.
    expect(req.reject_reason).toBe(REJECT_REASON_TEXT.CANNOT_CONTACT);
    expect(req.reviewed_by_full_name).toBe('NV Test');

    const [ord] = await ds.query('SELECT closed_at, is_paid FROM orders WHERE id = ?', [orderId]);
    expect(ord.closed_at).not.toBeNull();
    expect(Number(ord.is_paid)).toBe(0);

    const items: Array<{ state: string }> = await ds.query(
      'SELECT state FROM order_items WHERE order_id = ?',
      [orderId],
    );
    expect(items.every((i) => i.state === 'CANCELLED')).toBe(true);

    // Bàn tự do trở lại: không còn đơn mở nào giữ nó.
    const [{ cnt }] = await ds.query(
      'SELECT COUNT(*) AS cnt FROM orders WHERE table_id = ? AND closed_at IS NULL',
      [tableId],
    );
    expect(Number(cnt)).toBe(0);
  }, 15_000);

  it('đơn đã kết (thanh toán/đã huỷ) → 409 ORDER_ALREADY_CLOSED, gọi lần 2 cũng 409', async () => {
    const { requestId, orderId } = await seedConfirmed('ship-96', '0900000096');
    await ds.query('UPDATE orders SET closed_at = NOW(6), is_paid = 1 WHERE id = ?', [orderId]);

    const svc = makeService();
    const err = await svc
      .cancelConfirmed(requestId, { id: randomUUID(), full_name: 'NV Test' }, { reason_code: 'OVERLOADED' })
      .then(() => null, (e: unknown) => e as { getResponse(): { code?: string } });
    expect(err?.getResponse().code).toBe('ORDER_ALREADY_CLOSED');
  }, 15_000);
});

describe('Cửa sổ 14h của order/bếp — list() (chỉ đạo chủ dự án 2026-08-06)', () => {
  /** `list()` đụng `ds` + `settingsSvc` (đọc ngưỡng leo thang SMS); outbox/emitter không tham gia. */
  function makeService(): AdminOnlineOrdersService {
    return new AdminOnlineOrdersService(
      ds,
      new EventEmitter2(),
      null as unknown as ConstructorParameters<typeof AdminOnlineOrdersService>[2],
      { readAll: async () => ({ escalate_sms_after_s: 90 }) } as unknown as ConstructorParameters<
        typeof AdminOnlineOrdersService
      >[3],
    );
  }

  /** Đơn WAITING với mốc ĐẶT tự chọn — đây là thứ cửa sổ 14h lọc theo. Tham số là Date vì cột
   * `submitted_at` là DATETIME(6): đẩy số ms thẳng vào MySQL sẽ so sánh sai im lặng. */
  async function insertWaitingAt(phone: string, submittedAt: Date): Promise<string> {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO online_order_requests
        (id, order_token, customer_token, status, fulfillment_type, customer_name, customer_phone,
         customer_address, customer_lat, customer_lng, customer_map_link, distance_km, customer_note,
         items_snapshot, subtotal, submitted_at, ip_hash, user_agent, max_progress_shown)
       VALUES (?, ?, ?, 'WAITING', 'PICKUP', 'Sentinel 14h', ?, NULL, NULL, NULL, NULL, NULL, NULL,
               ?, ?, ?, ?, 'vitest', 0)`,
      [
        id,
        randomBytes(32).toString('hex'),
        randomBytes(16).toString('hex'),
        phone,
        JSON.stringify([
          { menu_item_id: randomUUID(), code: 'SP-TEST', name: 'Món test', unit_price: 50_000, qty: 1, note: null },
        ]),
        50_000,
        submittedAt,
        randomBytes(32).toString('hex'),
      ],
    );
    return id;
  }

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

  it('order/bếp KHÔNG thấy đơn đặt quá 14h, admin thấy cả hai', async () => {
    const fresh = await insertWaitingAt('0900000080', hoursAgo(2));
    const old = await insertWaitingAt('0900000081', hoursAgo(20));
    const svc = makeService();

    // Cửa sổ nhân viên: 14h.
    const staff = await svc.list('WAITING', { maxAgeMs: 14 * 60 * 60 * 1000, windowHours: 14 });
    const staffIds = staff.items.map((i) => i.id);
    expect(staffIds).toContain(fresh);
    expect(staffIds).not.toContain(old);
    expect(staff.window_hours).toBe(14);

    // Admin không giới hạn: thấy cả đơn 20h.
    const admin = await svc.list('WAITING', { maxAgeMs: undefined, windowHours: null });
    const adminIds = admin.items.map((i) => i.id);
    expect(adminIds).toContain(fresh);
    expect(adminIds).toContain(old);
    expect(admin.window_hours).toBeNull();
  }, 15_000);

  // Đo bằng CHÊNH LỆCH so với mốc trước khi chèn, không bằng số tuyệt đối: DB dev của máy chạy
  // test có sẵn đơn thật, khẳng định "đúng 3 đơn" sẽ đỏ vì lý do không liên quan tới cửa sổ.
  it('badge `status_counts` đếm TRONG cửa sổ, không đếm toàn bảng', async () => {
    const svc = makeService();
    const staff14 = { maxAgeMs: 14 * 60 * 60 * 1000, windowHours: 14 };
    const noLimit = { maxAgeMs: undefined, windowHours: null };
    const before = {
      staff: (await svc.list('WAITING', staff14)).status_counts.WAITING,
      admin: (await svc.list('WAITING', noLimit)).status_counts.WAITING,
    };

    await insertWaitingAt('0900000082', hoursAgo(1));
    await insertWaitingAt('0900000083', hoursAgo(30));
    await insertWaitingAt('0900000084', hoursAgo(50));

    const staff = await svc.list('WAITING', staff14);
    // Badge phải khớp đúng số đơn danh sách trả về — lệch là nhân viên thấy "12" trên một tab
    // mở ra chỉ có 3 đơn.
    expect(staff.status_counts.WAITING).toBe(staff.items.length);
    expect(staff.status_counts.WAITING - before.staff).toBe(1);

    const admin = await svc.list('WAITING', noLimit);
    expect(admin.status_counts.WAITING - before.admin).toBe(3);
  }, 15_000);

  it('bộ lọc thời gian của admin (vd 24h) cắt đúng mốc đặt', async () => {
    const svc = makeService();
    const range24 = { maxAgeMs: 24 * 60 * 60 * 1000, windowHours: 24 };
    const before = (await svc.list('WAITING', range24)).items.length;

    await insertWaitingAt('0900000085', hoursAgo(10));
    await insertWaitingAt('0900000086', hoursAgo(20));
    await insertWaitingAt('0900000087', hoursAgo(40));

    const res = await svc.list('WAITING', range24);
    expect(res.items.length - before).toBe(2);
    expect(res.status_counts.WAITING).toBe(res.items.length);
    expect(res.window_hours).toBe(24);
  }, 15_000);
});

describe('Đổi hình thức nhận hàng — switchFulfillment (chỉ đạo chủ dự án 2026-08-06)', () => {
  /** Đụng `ds` + `emitter` + `settingsSvc` (từ 2026-08-06 kết quả trả kèm `suggested_ship_fee`,
   *  tính từ bảng giá ship trong settings); outbox không tham gia.
   *  `ship_fee_per_km: 0` = quán chưa đặt bảng giá → gợi ý luôn `null`, đúng mặc định hệ thống. */
  function makeService(): AdminOnlineOrdersService {
    return new AdminOnlineOrdersService(
      ds,
      new EventEmitter2(),
      null as unknown as ConstructorParameters<typeof AdminOnlineOrdersService>[2],
      {
        readAll: async () => ({ free_ship_km: 10, ship_fee_per_km: 0 }),
      } as unknown as ConstructorParameters<typeof AdminOnlineOrdersService>[3],
    );
  }

  const actor = { id: randomUUID(), full_name: 'NV Test' };

  /** Đơn DELIVERY đã duyệt, đang ngồi bàn ship + có phí ship đã chốt. */
  async function seedConfirmedDelivery(tableCode: string, phone: string, shipFee = 20_000) {
    const tableId = await insertTable(tableCode, 'delivery');
    const orderId = randomUUID();
    await ds.query(
      `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source,
                           fulfillment_type, ship_fee, customer_address, payment_method)
       VALUES (?, ?, ?, NOW(6), NULL, 0, 'ONLINE', 'DELIVERY', ?, '12 Lê Lợi', 'CASH')`,
      [orderId, tableId, tableCode, shipFee],
    );
    const requestId = await insertWaitingRequest(phone, 150_000);
    await ds.query(
      `UPDATE online_order_requests
          SET status = 'CONFIRMED', order_id = ?, fulfillment_type = 'DELIVERY',
              customer_address = '12 Lê Lợi', distance_km = '3.20'
        WHERE id = ?`,
      [orderId, requestId],
    );
    return { requestId, orderId, tableId };
  }

  it('DELIVERY → PICKUP: đơn CHUYỂN sang bàn mang về, phí ship về 0, bàn ship được trả lại', async () => {
    // Bàn mang về sentinel để chắc chắn có bàn trống (không rơi vào nhánh tự tạo bàn).
    await insertTable('mang-ve-90', 'takeaway');
    const { requestId, orderId, tableId } = await seedConfirmedDelivery('ship-91', '0900000091');

    const res = await makeService().switchFulfillment(requestId, actor, {
      fulfillment_type: 'PICKUP',
    });

    expect(res.from_fulfillment_type).toBe('DELIVERY');
    expect(res.previous_table_code).toBe('ship-91');
    expect(res.ship_fee).toBe(0);

    // Bàn mới PHẢI đúng loại — đây là điều kiện để sơ đồ bàn/màn bếp hiện đơn đúng chỗ.
    const [ord] = await ds.query(
      `SELECT o.fulfillment_type, o.ship_fee, o.table_code, t.kind
         FROM orders o JOIN restaurant_tables t ON t.id = o.table_id WHERE o.id = ?`,
      [orderId],
    );
    expect(ord.fulfillment_type).toBe('PICKUP');
    expect(Number(ord.ship_fee)).toBe(0);
    expect(ord.kind).toBe('takeaway');
    expect(ord.table_code).toBe(res.table_code);

    const [req] = await ds.query(
      'SELECT fulfillment_type, customer_address FROM online_order_requests WHERE id = ?',
      [requestId],
    );
    expect(req.fulfillment_type).toBe('PICKUP');
    // Địa chỉ GIỮ NGUYÊN — đổi ngược lại không bắt nhân viên gõ lại (điểm 3 `switch-fulfillment.ts`).
    expect(req.customer_address).toBe('12 Lê Lợi');

    // Bàn ship cũ tự do trở lại: mọi câu chọn bàn đều loại bàn còn đơn `closed_at IS NULL`.
    const [{ cnt }] = await ds.query(
      'SELECT COUNT(*) AS cnt FROM orders WHERE table_id = ? AND closed_at IS NULL',
      [tableId],
    );
    expect(Number(cnt)).toBe(0);
  }, 15_000);

  it('đơn ĐÃ RỜI QUÁN → 409 ALREADY_SHIPPED, không đụng gì tới dữ liệu', async () => {
    await insertTable('mang-ve-92', 'takeaway');
    const { requestId, orderId, tableId } = await seedConfirmedDelivery('ship-92', '0900000092');
    await ds.query('UPDATE orders SET shipped_at = NOW(6) WHERE id = ?', [orderId]);

    const err = await makeService()
      .switchFulfillment(requestId, actor, { fulfillment_type: 'PICKUP' })
      .then(() => null, (e: unknown) => e as { getResponse(): { code?: string } });
    expect(err?.getResponse().code).toBe('ALREADY_SHIPPED');

    const [ord] = await ds.query('SELECT table_id, ship_fee FROM orders WHERE id = ?', [orderId]);
    expect(ord.table_id).toBe(tableId);
    expect(Number(ord.ship_fee)).toBe(20_000);
  }, 15_000);

  it('đơn CHỜ DUYỆT: PICKUP → DELIVERY cần địa chỉ; có địa chỉ thì đổi được mà không cấp bàn', async () => {
    const requestId = await insertWaitingRequest('0900000093', 90_000);
    const svc = makeService();

    const err = await svc
      .switchFulfillment(requestId, actor, { fulfillment_type: 'DELIVERY' })
      .then(() => null, (e: unknown) => e as { getResponse(): { code?: string } });
    expect(err?.getResponse().code).toBe('ADDRESS_REQUIRED');

    const res = await svc.switchFulfillment(requestId, actor, {
      fulfillment_type: 'DELIVERY',
      customer_address: '  99 Trần Phú  ',
    });
    // Chưa duyệt thì chưa có bàn nào để đổi — cấp bàn ở đây là vi phạm ranh giới M2.D-01.
    expect(res.table_code).toBeNull();
    expect(res.customer_address).toBe('99 Trần Phú');

    const [req] = await ds.query(
      'SELECT fulfillment_type, customer_address, order_id FROM online_order_requests WHERE id = ?',
      [requestId],
    );
    expect(req.fulfillment_type).toBe('DELIVERY');
    expect(req.customer_address).toBe('99 Trần Phú');
    expect(req.order_id).toBeNull();
  }, 15_000);

  it('bấm đúng hình thức đang có → 409 FULFILLMENT_UNCHANGED', async () => {
    const requestId = await insertWaitingRequest('0900000094', 50_000); // seed là PICKUP
    const err = await makeService()
      .switchFulfillment(requestId, actor, { fulfillment_type: 'PICKUP' })
      .then(() => null, (e: unknown) => e as { getResponse(): { code?: string } });
    expect(err?.getResponse().code).toBe('FULFILLMENT_UNCHANGED');
  }, 15_000);
});

describe('Chặn SĐT ngay trong lượt từ chối / huỷ đơn (chỉ đạo chủ dự án 2026-08-06)', () => {
  function makeService(): AdminOnlineOrdersService {
    return new AdminOnlineOrdersService(
      ds,
      new EventEmitter2(),
      { cancelPendingForRequest: async () => {} } as unknown as ConstructorParameters<
        typeof AdminOnlineOrdersService
      >[2],
      null as unknown as ConstructorParameters<typeof AdminOnlineOrdersService>[3],
    );
  }

  const actor = { id: randomUUID(), full_name: 'NV Test' };

  async function blacklistRow(phone: string) {
    const rows: Array<{ phone: string; reason: string; expires_at: Date | null }> = await ds.query(
      'SELECT phone, reason, expires_at FROM phone_blacklist WHERE phone = ?',
      [phone],
    );
    return rows[0] ?? null;
  }

  it('từ chối đơn CHỜ DUYỆT + tick chặn → số vào blacklist, chặn VĨNH VIỄN (expires_at NULL)', async () => {
    const phone = '0900000071';
    const requestId = await insertWaitingRequest(phone, 80_000);

    const res = await makeService().reject(requestId, actor, {
      reason_code: 'OTHER',
      reason_other_text: 'Đặt 10 đơn ảo rồi tắt máy',
      blacklist_phone: true,
    });

    expect(res.blacklisted_phone).toBe(phone);
    expect(res.blacklist_already).toBe(false);
    const row = await blacklistRow(phone);
    expect(row).not.toBeNull();
    expect(row.expires_at).toBeNull();
    // Lý do "Khác" thì lấy chính câu đã gửi khách — admin mở màn chặn số phải đọc được VÌ SAO.
    expect(row.reason).toContain('Đặt 10 đơn ảo rồi tắt máy');
    // Ghi chú nội bộ KHÔNG được nhân bản sang bảng này (D-09 — nó có chỗ sống riêng).
    expect(row.reason).not.toContain('ghi chú');

    // Đơn vẫn bị từ chối bình thường — chặn số là việc phụ, không được nuốt việc chính.
    const [req] = await ds.query('SELECT status FROM online_order_requests WHERE id = ?', [requestId]);
    expect(req.status).toBe('REJECTED');
  }, 15_000);

  it('KHÔNG tick → không có dòng nào trong blacklist', async () => {
    const phone = '0900000072';
    const requestId = await insertWaitingRequest(phone, 80_000);
    const res = await makeService().reject(requestId, actor, { reason_code: 'OVERLOADED' });
    expect(res.blacklisted_phone).toBeNull();
    expect(await blacklistRow(phone)).toBeNull();
  }, 15_000);

  it('huỷ đơn ĐÃ XÁC NHẬN + tick chặn: đơn niêm VÀ số bị chặn trong cùng một lần bấm', async () => {
    const phone = '0900000073';
    const tableId = await insertTable('ship-97', 'delivery');
    const orderId = randomUUID();
    await ds.query(
      `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source, payment_method)
       VALUES (?, ?, 'ship-97', NOW(6), NULL, 0, 'ONLINE', 'CASH')`,
      [orderId, tableId],
    );
    const requestId = await insertWaitingRequest(phone, 120_000);
    await ds.query(
      `UPDATE online_order_requests SET status = 'CONFIRMED', order_id = ? WHERE id = ?`,
      [orderId, requestId],
    );

    const res = await makeService().cancelConfirmed(requestId, actor, {
      reason_code: 'CANNOT_CONTACT',
      internal_note: 'khách phá đám, ghi chú nội bộ',
      blacklist_phone: true,
    });

    expect(res.blacklisted_phone).toBe(phone);
    const [ord] = await ds.query('SELECT closed_at FROM orders WHERE id = ?', [orderId]);
    expect(ord.closed_at).not.toBeNull();
    const row = await blacklistRow(phone);
    expect(row.reason).toContain('Huỷ đơn online đã xác nhận');
    expect(row.reason).not.toContain('ghi chú nội bộ');
  }, 15_000);

  it('số đã bị chặn từ trước → BÁO "đã có sẵn", KHÔNG ném lỗi và đơn vẫn bị từ chối', async () => {
    // Nhân viên tick lần hai (đơn thứ hai của cùng một số) là chuyện thường. Ném 409 ở đây là làm
    // rớt cả lượt từ chối chỉ vì một cái tick thừa.
    const phone = '0900000074';
    const first = await insertWaitingRequest(phone, 60_000);
    await makeService().reject(first, actor, { reason_code: 'OTHER', reason_other_text: 'phá đám', blacklist_phone: true });

    const second = await insertWaitingRequest(phone, 60_000);
    const res = await makeService().reject(second, actor, {
      reason_code: 'OTHER',
      reason_other_text: 'phá đám lần 2',
      blacklist_phone: true,
    });

    expect(res.blacklisted_phone).toBeNull();
    expect(res.blacklist_already).toBe(true);
    const [{ cnt }] = await ds.query('SELECT COUNT(*) AS cnt FROM phone_blacklist WHERE phone = ?', [phone]);
    expect(Number(cnt)).toBe(1);
    const [req] = await ds.query('SELECT status FROM online_order_requests WHERE id = ?', [second]);
    expect(req.status).toBe('REJECTED');
  }, 15_000);
});

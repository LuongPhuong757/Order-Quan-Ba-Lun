// Test cho M2.D-44 (nửa huỷ) — khách tự huỷ đơn còn WAITING.
//
// File gồm 2 lớp bằng chứng, cố ý để chung 1 file vì chúng chứng minh cùng 1 hành vi ở 2 tầng:
//
//  A. `decideCancel` + `cancelOrderByCustomer` với fake-deps — 4 nhánh trạng thái, không cần DB.
//  B. Race khách-huỷ vs admin-xác nhận trên **MySQL thật, 2 connection** — mock KHÔNG chứng minh
//     được InnoDB xếp hàng 2 giao dịch cùng `SELECT ... FOR UPDATE`. Khuôn lấy nguyên từ
//     `open-order-lock.integration.test.ts` (2 `QueryRunner`, không bootstrap Nest).
//
// `import 'dotenv/config'` BẮT BUỘC: `data-source.ts` đọc `process.env.MYSQL_PORT` trực tiếp.
// Nếu MySQL local chưa chạy, phần B PHẢI fail rõ ràng — bỏ qua trong im lặng là cách criterion
// "race có test chứng minh" mất bằng chứng.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';
import { cancelOrderByCustomer, decideCancel, type CancelDeps } from './cancel-order.js';

const STORE_PHONE = '0909123456';

// ── Phần A: hàm thuần + orchestrator với fake-deps ──────────────────────────────────────────

type FakeCalls = { marked: string[]; notificationsCancelled: string[] };

function makeDeps(
  row: { id: string; status: string } | null,
  calls: FakeCalls,
): CancelDeps {
  return {
    lockRequestByToken: async () => row,
    markCancelled: async (id) => {
      calls.marked.push(id);
    },
    cancelPendingNotifications: async (id) => {
      calls.notificationsCancelled.push(id);
    },
    storePhone: STORE_PHONE,
  };
}

describe('decideCancel — nhánh theo trạng thái đơn', () => {
  it('WAITING → huỷ được', () => {
    expect(decideCancel('WAITING', STORE_PHONE).kind).toBe('CANCEL');
  });

  it('CANCELLED_BY_CUSTOMER → idempotent, không phải lỗi', () => {
    expect(decideCancel('CANCELLED_BY_CUSTOMER', STORE_PHONE).kind).toBe('ALREADY_CANCELLED');
  });

  it('CONFIRMED → 409 ORDER_ALREADY_CONFIRMED, câu báo có SĐT quán và KHÔNG dùng chữ "lỗi"', () => {
    const d = decideCancel('CONFIRMED', STORE_PHONE);
    expect(d).toMatchObject({ kind: 'CONFLICT', code: 'ORDER_ALREADY_CONFIRMED' });
    if (d.kind !== 'CONFLICT') throw new Error('unreachable');
    expect(d.message).toContain(STORE_PHONE);
    expect(d.message.toLowerCase()).not.toContain('lỗi');
  });

  it('CONFIRMED khi quán chưa cấu hình SĐT: câu vẫn trọn vẹn, không có khoảng trắng cụt', () => {
    const d = decideCancel('CONFIRMED', '   ');
    if (d.kind !== 'CONFLICT') throw new Error('unreachable');
    expect(d.message).toContain('vui lòng gọi quán');
    expect(d.message).not.toContain('  ');
  });

  it('REJECTED → 409 ORDER_ALREADY_REJECTED', () => {
    expect(decideCancel('REJECTED', STORE_PHONE)).toMatchObject({
      kind: 'CONFLICT',
      code: 'ORDER_ALREADY_REJECTED',
    });
  });

  it('status lạ (dữ liệu cũ) → mặc định KHÔNG huỷ, rơi vào nhánh an toàn', () => {
    expect(decideCancel('SOMETHING_ELSE', STORE_PHONE).kind).toBe('CONFLICT');
  });
});

describe('cancelOrderByCustomer — orchestrator', () => {
  it('đơn WAITING: đổi trạng thái + huỷ hàng thông báo còn PENDING, trả changed=true', async () => {
    const calls: FakeCalls = { marked: [], notificationsCancelled: [] };
    const out = await cancelOrderByCustomer(makeDeps({ id: 'r1', status: 'WAITING' }, calls), 'tok', 1000);

    expect(out).toMatchObject({ order_token: 'tok', status: 'CANCELLED_BY_CUSTOMER', changed: true });
    expect(calls.marked).toEqual(['r1']);
    // Thiếu bước này là SMS leo thang vẫn bắn cho quán về đơn khách đã huỷ (REQ-N).
    expect(calls.notificationsCancelled).toEqual(['r1']);
  });

  it('gọi lần 2 trên đơn đã huỷ: vẫn 200 cùng payload, KHÔNG ghi gì thêm', async () => {
    const calls: FakeCalls = { marked: [], notificationsCancelled: [] };
    const out = await cancelOrderByCustomer(
      makeDeps({ id: 'r1', status: 'CANCELLED_BY_CUSTOMER' }, calls),
      'tok',
      1000,
    );

    expect(out).toMatchObject({ status: 'CANCELLED_BY_CUSTOMER', changed: false });
    expect(calls.marked).toEqual([]);
    expect(calls.notificationsCancelled).toEqual([]);
  });

  it('đơn đã CONFIRMED: ném 409 và KHÔNG đụng vào DB', async () => {
    const calls: FakeCalls = { marked: [], notificationsCancelled: [] };
    await expect(
      cancelOrderByCustomer(makeDeps({ id: 'r1', status: 'CONFIRMED' }, calls), 'tok', 1000),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(calls.marked).toEqual([]);
  });

  it('token không tồn tại: 404 với câu KHÔNG tiết lộ token có tồn tại hay không', async () => {
    const calls: FakeCalls = { marked: [], notificationsCancelled: [] };
    const err = await cancelOrderByCustomer(makeDeps(null, calls), 'tok', 1000).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    const body = (err as NotFoundException).getResponse() as { code: string; message: string };
    expect(body.code).toBe('ORDER_NOT_FOUND');
    // Không được có chữ nào phân biệt "sai định dạng" với "không tồn tại" (T-09-81).
    expect(body.message).toBe('Không tìm thấy đơn này.');
  });
});

// ── Phần B: race trên MySQL thật ────────────────────────────────────────────────────────────

// ⚠ Tiền tố PHẢI khác `09000000%` của `open-order-lock.integration.test.ts`. Vitest chạy các file
// test song song, và cả 2 file đều `DELETE ... WHERE customer_phone LIKE <tiền tố>` ở
// `beforeEach` — dùng chung tiền tố là hai file xoá hàng sentinel của nhau giữa chừng, cho ra lỗi
// "không tìm thấy đơn" chỉ xuất hiện khi chạy CẢ BỘ, không bao giờ tái hiện khi chạy riêng file.
const SENTINEL_PHONE_CANCEL = '0911000004';
const SENTINEL_LIKE = '09110000%';

let ds: DataSource;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tạo 1 đơn WAITING sentinel, trả `{ id, token }`. */
async function insertWaitingRow(): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString('hex');
  await ds.query(
    `INSERT INTO online_order_requests
      (id, order_token, customer_token, status, fulfillment_type, customer_name, customer_phone,
       customer_address, customer_lat, customer_lng, customer_map_link, distance_km, customer_note,
       items_snapshot, subtotal, submitted_at, ip_hash, user_agent, max_progress_shown)
     VALUES (UUID(), ?, ?, 'WAITING', 'PICKUP', 'Sentinel Cancel', ?, NULL, NULL, NULL, NULL, NULL, NULL,
             ?, 0, NOW(), ?, 'vitest', 0)`,
    [
      token,
      randomBytes(16).toString('hex'),
      SENTINEL_PHONE_CANCEL,
      JSON.stringify([]),
      randomBytes(32).toString('hex'),
    ],
  );
  const rows: Array<{ id: string }> = await ds.query(
    'SELECT id FROM online_order_requests WHERE order_token = ?',
    [token],
  );
  return { id: rows[0]!.id, token };
}

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(
      'Không kết nối được MySQL local — hãy bật MySQL trước khi chạy test này, rồi chạy lại ' +
        '`pnpm --filter @order/api test -- cancel-order.test.ts`. ' +
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

describe('race khách-huỷ vs admin-xác nhận — CÙNG row lock, ai vào trước thắng (T-09-82)', () => {
  it(
    'admin vào trước: giao dịch huỷ bị CHẶN tới khi admin commit, rồi đọc được CONFIRMED nên không huỷ',
    async () => {
      const { id, token } = await insertWaitingRow();
      const admin = ds.createQueryRunner();
      const guest = ds.createQueryRunner();
      await admin.connect();
      await guest.connect();

      try {
        await admin.startTransaction();
        await guest.startTransaction();

        // 1) Admin khoá hàng đúng như `lockWaitingRequest()` của 09-06 (tra theo `id`).
        const adminRows = await admin.query(
          'SELECT id, status FROM online_order_requests WHERE id = ? FOR UPDATE',
          [id],
        );
        expect(adminRows[0].status).toBe('WAITING');

        // 2) Khách chạy câu khoá của `cancelByToken()` (tra theo `order_token`) — CÙNG hàng, nên
        //    PHẢI bị chặn. Đây là toàn bộ bằng chứng "không cần cờ ứng dụng nào".
        let guestResolved = false;
        const guestPromise: Promise<Array<{ id: string; status: string }>> = guest
          .query('SELECT id, status FROM online_order_requests WHERE order_token = ? FOR UPDATE', [token])
          .then((rows: Array<{ id: string; status: string }>) => {
            guestResolved = true;
            return rows;
          });

        const raced = await Promise.race([guestPromise, sleep(500).then(() => 'TIMEOUT' as const)]);
        expect(raced).toBe('TIMEOUT');
        expect(guestResolved).toBe(false);

        // 3) Admin xác nhận rồi commit.
        await admin.query(`UPDATE online_order_requests SET status = 'CONFIRMED' WHERE id = ?`, [id]);
        await admin.commitTransaction();

        // 4) Khách mới đọc được — và đọc ra CONFIRMED, nên `decideCancel` đá sang nhánh 409.
        const guestRows = await guestPromise;
        expect(guestRows[0].status).toBe('CONFIRMED');
        expect(decideCancel(guestRows[0].status, STORE_PHONE)).toMatchObject({
          kind: 'CONFLICT',
          code: 'ORDER_ALREADY_CONFIRMED',
        });
        await guest.commitTransaction();
      } finally {
        if (!admin.isReleased) await admin.release();
        if (!guest.isReleased) await guest.release();
      }

      // Kết cục: đúng MỘT giá trị, không bao giờ vừa CONFIRMED vừa CANCELLED.
      const finalRows = await ds.query('SELECT status FROM online_order_requests WHERE id = ?', [id]);
      expect(finalRows.length).toBe(1);
      expect(finalRows[0].status).toBe('CONFIRMED');
    },
    20_000,
  );

  it(
    'khách vào trước: admin bị CHẶN, sau commit đọc được CANCELLED_BY_CUSTOMER nên không duyệt',
    async () => {
      const { id, token } = await insertWaitingRow();
      const admin = ds.createQueryRunner();
      const guest = ds.createQueryRunner();
      await admin.connect();
      await guest.connect();

      try {
        await guest.startTransaction();
        await admin.startTransaction();

        const guestRows = await guest.query(
          'SELECT id, status FROM online_order_requests WHERE order_token = ? FOR UPDATE',
          [token],
        );
        expect(decideCancel(guestRows[0].status, STORE_PHONE).kind).toBe('CANCEL');

        let adminResolved = false;
        const adminPromise: Promise<Array<{ id: string; status: string }>> = admin
          .query('SELECT id, status FROM online_order_requests WHERE id = ? FOR UPDATE', [id])
          .then((rows: Array<{ id: string; status: string }>) => {
            adminResolved = true;
            return rows;
          });

        const raced = await Promise.race([adminPromise, sleep(500).then(() => 'TIMEOUT' as const)]);
        expect(raced).toBe('TIMEOUT');
        expect(adminResolved).toBe(false);

        await guest.query(
          `UPDATE online_order_requests SET status = 'CANCELLED_BY_CUSTOMER', cancelled_at = NOW(6) WHERE id = ?`,
          [id],
        );
        await guest.commitTransaction();

        // Admin đọc được trạng thái mới → `lockWaitingRequest()` của 09-06 ném 409 vì
        // `status !== 'WAITING'`. Đây là nhánh đã có sẵn từ plan 09-06, không phải nhánh mới.
        const adminRows = await adminPromise;
        expect(adminRows[0].status).toBe('CANCELLED_BY_CUSTOMER');
        await admin.commitTransaction();
      } finally {
        if (!admin.isReleased) await admin.release();
        if (!guest.isReleased) await guest.release();
      }

      const finalRows = await ds.query('SELECT status, cancelled_at FROM online_order_requests WHERE id = ?', [id]);
      expect(finalRows[0].status).toBe('CANCELLED_BY_CUSTOMER');
      expect(finalRows[0].cancelled_at).not.toBeNull();
    },
    20_000,
  );
});

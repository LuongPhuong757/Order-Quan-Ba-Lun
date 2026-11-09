// Test tích hợp hàng đợi tự xuất hoá đơn trên MySQL THẬT (2026-11-09) — đúng những chỗ chỉ DB thật
// mới chứng minh được: phiếu giữ đơn, ghi kết quả có điều kiện, bấm đúp phát hành lại.
//
// Provider là bản GIẢ — file này KHÔNG BAO GIỜ gọi MISA (gọi thật = hoá đơn thật lên cơ quan thuế).
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../../data-source.js';
import { Order } from '../entities/order.entity.js';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from '../orders.service.js';
import { OrderItem } from '../entities/order-item.entity.js';
import { OrderActivityLog } from '../entities/order-activity-log.entity.js';
import { MenuItem } from '../../menu/entities/menu-item.entity.js';
import { RestaurantTable } from '../../tables/entities/restaurant-table.entity.js';
import { ConsumptionService } from '../../ingredients/consumption.service.js';
import { OrderItemIngredientUsage } from '../../ingredients/entities/order-item-ingredient-usage.entity.js';
import { RecipeLine } from '../../ingredients/entities/recipe-line.entity.js';
import { Ingredient } from '../../ingredients/entities/ingredient.entity.js';
import { noOpPrintingService } from '../../printing/printing.test-double.js';
import type { EInvoiceDraft } from './einvoice-rules.js';
import { EInvoiceService } from './einvoice.service.js';
import { EInvoiceError, type EInvoiceIssueResult, type EInvoiceProvider } from './meinvoice.provider.js';

const PREFIX = 'einv9-';
const LIKE = 'einv9-%';

let ds: DataSource;
let tableId: string;

/** Provider giả: đếm số lần gọi, mỗi lần gọi chạy theo kịch bản do test đưa vào. */
class FakeProvider implements EInvoiceProvider {
  calls: EInvoiceDraft[] = [];
  constructor(private readonly behave: (n: number, d: EInvoiceDraft) => Promise<EInvoiceIssueResult>) {}
  issue(d: EInvoiceDraft): Promise<EInvoiceIssueResult> {
    this.calls.push(d);
    return this.behave(this.calls.length, d);
  }
}

const noLog = { logOrderActivity: async () => undefined } as unknown as OrdersService;
const svcWith = (p: EInvoiceProvider) => new EInvoiceService(ds, p, noLog);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cleanup(): Promise<void> {
  await ds.query(`DELETE oi FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.table_code LIKE ?`, [LIKE]);
  await ds.query('DELETE FROM order_activity_logs WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM orders WHERE table_code LIKE ?', [LIKE]);
  await ds.query('DELETE FROM restaurant_tables WHERE code LIKE ?', [LIKE]);
}

/** Đơn ĐÃ THU chuyển khoản đủ vào mã HKD, đang chờ xuất hoá đơn. */
async function insertPaidHkdOrder(opts: { price?: number; transfer?: number; status?: string } = {}): Promise<string> {
  const id = randomUUID();
  const price = opts.price ?? 40_000;
  await ds.query(
    `INSERT INTO orders (id, table_id, table_code, opened_at, closed_at, is_paid, source, ship_fee,
                         transfer_amount, einvoice_status, einvoice_attempts)
     VALUES (?, ?, ?, NOW(6), NOW(6), 1, 'STAFF', 0, ?, ?, 0)`,
    [id, tableId, `${PREFIX}a`, opts.transfer ?? price, opts.status ?? 'PENDING'],
  );
  await ds.query(
    `INSERT INTO order_items (id, order_id, menu_item_id, menu_item_name, qty, menu_item_price, state, created_at, updated_at)
     VALUES (?, ?, NULL, 'Rau muống xào', 1, ?, 'SERVED', NOW(6), NOW(6))`,
    [randomUUID(), id, price],
  );
  return id;
}

const load = (id: string) => ds.getRepository(Order).findOneByOrFail({ id });

beforeAll(async () => {
  ds = new DataSource({ ...dataSourceOptions, synchronize: false });
  try {
    await ds.initialize();
  } catch (err) {
    throw new Error(`Không kết nối được MySQL local — bật MySQL rồi chạy lại. Lỗi gốc: ${String(err)}`);
  }
}, 20_000);

afterAll(async () => {
  await cleanup();
  await ds.destroy();
}, 20_000);

beforeEach(async () => {
  await cleanup();
  tableId = randomUUID();
  await ds.query(
    `INSERT INTO restaurant_tables (id, code, name, kind, x, y, is_active) VALUES (?, ?, ?, 'dine-in', 0, 0, 1)`,
    [tableId, `${PREFIX}a`, 'Bàn hoá đơn'],
  );
});

describe('EInvoiceService — chống xử lý trùng (HIGH-1)', () => {
  it('nút phát hành ngay và poller chạy CÙNG LÚC → MISA chỉ được gọi MỘT lần, kết quả ISSUED', async () => {
    const id = await insertPaidHkdOrder();
    const provider = new FakeProvider(async () => {
      await sleep(300); // MISA trả lời chậm — đúng khe hở cũ
      return { invoice_no: '00000101' };
    });
    const svc = svcWith(provider);
    await Promise.all([svc.issueNow(id), svc.tick(), svc.issueNow(id)]);
    expect(provider.calls).toHaveLength(1);
    const o = await load(id);
    expect(o.einvoice_status).toBe('ISSUED');
    expect(o.misa_ref).toBe('00000101');
    expect(o.einvoice_claim_id).toBeNull();
  });

  it('lần chạy THUA (phiếu đã hết hạn, bị lần khác nhặt) không đè được kết quả ISSUED của lần thắng', async () => {
    const id = await insertPaidHkdOrder();
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((r) => (releaseFirst = r));
    const provider = new FakeProvider(async (n) => {
      if (n === 1) {
        await firstBlocked; // lần 1 treo lâu…
        throw new EInvoiceError('MISA từ chối: InvalidData'); // …rồi báo lỗi chắc chắn
      }
      return { invoice_no: '00000202' }; // lần 2 (sau khi phiếu hết hạn) thành công
    });
    const svc = svcWith(provider);
    const first = svc.issueNow(id);
    await sleep(100);
    // Giả lập phiếu của lần 1 đã quá hạn 5 phút (tiến trình coi như chết).
    await ds.query(`UPDATE orders SET einvoice_claimed_at = NOW(6) - INTERVAL 10 MINUTE WHERE id = ?`, [id]);
    await svc.issueNow(id);
    expect((await load(id)).einvoice_status).toBe('ISSUED');
    releaseFirst();
    await first;
    const o = await load(id);
    expect(o.einvoice_status).toBe('ISSUED'); // KHÔNG bị lần 1 ghi đè thành FAILED
    expect(o.misa_ref).toBe('00000202');
    expect(provider.calls).toHaveLength(2);
  });

  it('bấm "Phát hành lại" hai lần liền → chỉ một lần chạy, lần kia bị từ chối', async () => {
    const id = await insertPaidHkdOrder({ status: 'FAILED' });
    const provider = new FakeProvider(async () => {
      await sleep(200);
      return { invoice_no: '00000303' };
    });
    const svc = svcWith(provider);
    const actor = { id: randomUUID(), full_name: 'Thu ngân' };
    const results = await Promise.allSettled([svc.retry(id, actor), svc.retry(id, actor)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
    expect((await load(id)).einvoice_status).toBe('ISSUED');
  });
});

describe('EInvoiceService — kết quả cho người đứng quầy (HIGH-2, MEDIUM-1)', () => {
  it('phát hành ngay + MISA từ chối rõ ràng → FAILED ngay (người thu xuất tay được, poller không đụng nữa)', async () => {
    const id = await insertPaidHkdOrder();
    const svc = svcWith(new FakeProvider(async () => {
      throw new EInvoiceError('MISA từ chối: InvalidInvDate');
    }));
    const o = await svc.issueNow(id);
    expect(o.einvoice_status).toBe('FAILED');
    expect(o.einvoice_error).toBe('MISA từ chối: InvalidInvDate');
  });

  it('phát hành ngay + lỗi KHÔNG BIẾT → vẫn PENDING, câu lỗi dặn ĐỪNG xuất tay, phiếu được trả để máy tra lại', async () => {
    const id = await insertPaidHkdOrder();
    const svc = svcWith(new FakeProvider(async () => {
      throw new EInvoiceError('Không kết nối được meInvoice', true);
    }));
    const o = await svc.issueNow(id);
    expect(o.einvoice_status).toBe('PENDING');
    expect(o.einvoice_error).toMatch(/^CHƯA XÁC MINH: .*ĐỪNG xuất tay/);
    expect(o.einvoice_claim_id).toBeNull();
  });

  it('lỗi KHÔNG BIẾT tới hết lượt → FAILED kèm câu dặn kiểm tra meInvoice trước khi xuất tay', async () => {
    const id = await insertPaidHkdOrder();
    const svc = svcWith(new FakeProvider(async () => {
      throw new EInvoiceError('Không kết nối được meInvoice', true);
    }));
    await svc.issueNow(id);
    await svc.tick();
    await svc.tick();
    const o = await load(id);
    expect(o.einvoice_status).toBe('FAILED');
    expect(o.einvoice_attempts).toBe(3);
    expect(o.einvoice_error).toMatch(/^CHƯA XÁC MINH: .*Kiểm tra trên app3\.meinvoice\.vn TRƯỚC khi xuất tay/);
  });

  it('tiền hoá đơn khác tiền chuyển khoản → FAILED, KHÔNG gọi MISA', async () => {
    const id = await insertPaidHkdOrder({ price: 40_000, transfer: 35_000 });
    const provider = new FakeProvider(async () => ({ invoice_no: 'KHONG-DUOC-GOI' }));
    const o = await svcWith(provider).issueNow(id);
    expect(provider.calls).toHaveLength(0);
    expect(o.einvoice_status).toBe('FAILED');
    expect(o.einvoice_error).toMatch(/khác tiền chuyển khoản/);
  });

  it('đơn không ở PENDING (đã xuất / đã xuất tay) → phát hành ngay không làm gì', async () => {
    const id = await insertPaidHkdOrder({ status: 'ISSUED' });
    const provider = new FakeProvider(async () => ({ invoice_no: 'KHONG-DUOC-GOI' }));
    await svcWith(provider).issueNow(id);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('OrdersService — thao tác tay trên đơn có hoá đơn (review v2 2026-11-09)', () => {
  const ordersSvc = () =>
    new OrdersService(
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
      noOpPrintingService(),
    );
  const ADMIN = { id: randomUUID(), full_name: 'Admin' };

  it('đơn LỖI CHƯA XÁC MINH → KHÔNG cho chuyển sang nợ (hoá đơn có thể đã ra)', async () => {
    const id = await insertPaidHkdOrder({ status: 'FAILED' });
    await ds.query(`UPDATE orders SET einvoice_error = 'CHƯA XÁC MINH: mất mạng' WHERE id = ?`, [id]);
    await expect(ordersSvc().markAsDebt(id, 'Anh Tuấn', ADMIN)).rejects.toThrow(/Phát hành lại/);
    expect((await load(id)).is_paid).toBe(true);
  });

  it('đơn LỖI CHẮC CHẮN (MISA từ chối) → chuyển nợ được, trạng thái hoá đơn được xoá', async () => {
    const id = await insertPaidHkdOrder({ status: 'FAILED' });
    await ds.query(`UPDATE orders SET einvoice_error = 'MISA từ chối: InvalidData' WHERE id = ?`, [id]);
    await ordersSvc().markAsDebt(id, 'Anh Tuấn', ADMIN);
    const o = await load(id);
    expect(o.debt_at).not.toBeNull();
    expect(o.einvoice_status).toBeNull();
  });

  it('đơn ĐANG phát hành lại (PENDING) → tick "đã xuất tay" bị chặn, không đè trạng thái', async () => {
    const id = await insertPaidHkdOrder({ status: 'PENDING' });
    await expect(ordersSvc().setMisaCopied(id, true, ADMIN)).rejects.toThrow();
    expect((await load(id)).einvoice_status).toBe('PENDING');
  });
});

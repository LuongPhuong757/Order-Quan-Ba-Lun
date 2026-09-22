// BẰNG CHỨNG cho tính chất quan trọng nhất của cả tính năng: **một giao dịch chỉ được tính một
// lần**, dù SePay bắn lại bao nhiêu lần.
//
// Vì sao phải là integration test chứ không mock được: thứ đang được kiểm là khoá duy nhất
// `uq_bt_gateway_ref` + hành vi `INSERT IGNORE` của MySQL. Một repository giả sẽ "chống trùng"
// bằng đúng đoạn code mà ta đang nghi ngờ, nên chứng minh được mỗi việc là code khớp với chính
// nó. Ở đây dùng thẳng `DataSource` như `open-order-lock.integration.test.ts`.
//
// SePay gửi lại khi không nhận đủ (HTTP 200 + body đúng + trong 30 giây), và job quét bù thì
// CHỦ Ý kéo về cả những giao dịch đã có. Nếu tính hai lần, một đơn khách chuyển thiếu sẽ tự
// thành "đã trả đủ" — sai lặng lẽ, đúng hướng gây thiệt hại.
import 'dotenv/config';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../data-source.js';
import { PaymentsApplyService } from './payments-apply.service.js';
import { PaymentIntent } from './entities/payment-intent.entity.js';
import { BankTransaction } from './entities/bank-transaction.entity.js';
import type { IngestInput } from './sepay-payload.js';

// Sentinel RIÊNG của file này — mỗi file integration một sentinel, xem docblock
// `open-order-lock.integration.test.ts`. Bàn 99 không tồn tại trong dữ liệu thật.
const SENTINEL_CODE = 'BAN99ZZZ';
const SENTINEL_TXN = 'zz-test-sepay-';

const ds = new DataSource(dataSourceOptions);

async function connect() {
  if (!ds.isInitialized) await ds.initialize();
  return ds;
}

async function cleanup() {
  if (!ds.isInitialized) return;
  await ds.getRepository(BankTransaction).createQueryBuilder()
    .delete().where('gateway_txn_id LIKE :p', { p: `${SENTINEL_TXN}%` }).execute();
  await ds.getRepository(PaymentIntent).createQueryBuilder()
    .delete().where('code = :c', { c: SENTINEL_CODE }).execute();
}

function txn(id: string, amount: number, content: string): IngestInput {
  return {
    gateway: 'sepay',
    gatewayTxnId: `${SENTINEL_TXN}${id}`,
    amount,
    content,
    accountNo: '1017588888',
    occurredAt: Date.now(),
    raw: { test: true },
  };
}

describe('webhook SePay — chống trùng và cộng dồn', () => {
  beforeEach(async () => {
    await connect();
    await cleanup();
    await ds.getRepository(PaymentIntent).save({
      code: SENTINEL_CODE,
      code_day: new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10),
      target_type: 'POS',
      target_id: 'zz-test-order',
      amount: 250_000,
      received_amount: 0,
      paid_at: null,
      needs_review: false,
      expires_at: Date.now() + 900_000,
      created_at: Date.now(),
    });
  });

  afterAll(async () => {
    await cleanup();
    if (ds.isInitialized) await ds.destroy();
  });

  it('bắn HAI LẦN cùng một id chỉ ghi MỘT dòng và chỉ cộng tiền MỘT lần', async () => {
    const svc = new PaymentsApplyService(ds);
    const payload = txn('dup', 250_000, `${SENTINEL_CODE} LUONG THUY`);

    expect(await svc.ingest(payload)).toBe(true);   // lần đầu: giao dịch mới
    expect(await svc.ingest(payload)).toBe(false);  // lần hai: đã xử lý

    const rows = await ds.getRepository(BankTransaction).find({
      where: { gateway_txn_id: payload.gatewayTxnId },
    });
    expect(rows).toHaveLength(1);

    const intent = await ds.getRepository(PaymentIntent).findOneByOrFail({ code: SENTINEL_CODE });
    expect(intent.received_amount).toBe(250_000);
    expect(intent.paid_at).not.toBeNull();
  });

  it('chuyển THIẾU thì gắn cờ chứ không đánh dấu đã trả', async () => {
    const svc = new PaymentsApplyService(ds);
    await svc.ingest(txn('short', 200_000, SENTINEL_CODE));

    const intent = await ds.getRepository(PaymentIntent).findOneByOrFail({ code: SENTINEL_CODE });
    expect(intent.received_amount).toBe(200_000);
    expect(intent.paid_at).toBeNull();
    expect(intent.needs_review).toBe(true);
  });

  it('chuyển hai lần cộng dồn thành đủ', async () => {
    const svc = new PaymentsApplyService(ds);
    await svc.ingest(txn('part1', 200_000, SENTINEL_CODE));
    await svc.ingest(txn('part2', 50_000, SENTINEL_CODE));

    const intent = await ds.getRepository(PaymentIntent).findOneByOrFail({ code: SENTINEL_CODE });
    expect(intent.received_amount).toBe(250_000);
    expect(intent.paid_at).not.toBeNull();
  });

  it('nội dung không có mã thì VẪN ghi giao dịch nhưng KHÔNG đoán sang đơn nào', async () => {
    // Mất dấu tiền mới là hỏng; chưa khớp thì người đối soát xử được.
    const svc = new PaymentsApplyService(ds);
    await svc.ingest(txn('nocode', 250_000, 'tra tien'));

    const row = await ds.getRepository(BankTransaction).findOneByOrFail({
      gateway_txn_id: `${SENTINEL_TXN}nocode`,
    });
    expect(row.applied_intent_id).toBeNull();

    const intent = await ds.getRepository(PaymentIntent).findOneByOrFail({ code: SENTINEL_CODE });
    expect(intent.received_amount).toBe(0);
    expect(intent.paid_at).toBeNull();
  });
});

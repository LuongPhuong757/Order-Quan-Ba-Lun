// Bộ chuyển của API KHÁC bộ chuyển của webhook, và đó chính là chỗ dễ sai nhất: dùng nhầm thì
// mọi hàng ra NaN rồi bị loại lặng lẽ, job báo "bù 0 giao dịch" trong khi nó không đọc được gì.
import { describe, expect, it } from 'vitest';
import { __test_fromApiRow as fromApiRow } from './sepay-backfill.job.js';

const row = {
  id: 49051,
  bank_brand_name: 'Vietcombank',
  account_number: '1017588888',
  transaction_date: '2026-09-22 19:42:10',
  amount_out: '0.00',
  amount_in: '250000.00',
  accumulated: '0.00',
  transaction_content: 'BAN05 DH123456 LUONG THUY',
  reference_number: 'FT26012345678',
  code: null,
  sub_account: null,
  bank_account_id: '1',
};

describe('fromApiRow', () => {
  it('đọc đúng tên trường của API (amount_in / transaction_content)', () => {
    expect(fromApiRow(row)).toMatchObject({
      gateway: 'sepay',
      gatewayTxnId: '49051',
      amount: 250000,
      content: 'BAN05 DH123456 LUONG THUY',
      accountNo: '1017588888',
    });
  });

  it('bỏ qua hàng tiền RA', () => {
    expect(fromApiRow({ ...row, amount_in: '0.00', amount_out: '90000.00' })).toBeNull();
  });

  it('không nổ với hàng rác', () => {
    expect(fromApiRow(null)).toBeNull();
    expect(fromApiRow({})).toBeNull();
  });

  it('cùng giờ Việt Nam với bộ chuyển webhook', () => {
    expect(fromApiRow(row)?.occurredAt).toBe(Date.UTC(2026, 8, 22, 12, 42, 10));
  });
});

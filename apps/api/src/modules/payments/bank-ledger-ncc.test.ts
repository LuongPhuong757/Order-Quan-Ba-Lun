import { describe, expect, it } from 'vitest';
import { autoMatchPairs, dayGap, rankNccCandidates, vnDay, dateDay } from './bank-ledger-ncc.js';

// 2026-11-17 01:30 giờ VN = 2026-11-16 18:30 UTC.
const VN_0130_17 = Date.parse('2026-11-16T18:30:00Z');

describe('ngày theo giờ Việt Nam', () => {
  it('khoản CK 01:30 sáng VN tính là ngày 17, không phải ngày 16 của UTC', () => {
    expect(vnDay(VN_0130_17)).toBe(dateDay('2026-11-17'));
  });
  it('lệch ngày tính trị tuyệt đối', () => {
    expect(dayGap({ occurred_at: VN_0130_17 }, { paid_on: '2026-11-16' })).toBe(1);
    expect(dayGap({ occurred_at: VN_0130_17 }, { paid_on: '2026-11-19' })).toBe(2);
  });
});

describe('autoMatchPairs', () => {
  const t = (id: string, amount: number, acc = '9969', at = VN_0130_17) => ({ id, amount, account_no: acc, occurred_at: at });
  const p = (id: string, amount: number, acc = '9969', on = '2026-11-17') => ({ id, amount, account_no: acc, paid_on: on });

  it('khớp khi cùng TK, cùng tiền, trong ±1 ngày', () => {
    expect(autoMatchPairs([t('a', 500_000)], [p('x', 500_000, '9969', '2026-11-16')])).toEqual([
      { txn_id: 'a', payment_id: 'x' },
    ]);
  });

  it('không khớp khi khác tài khoản, khác tiền, hoặc lệch 2 ngày', () => {
    expect(autoMatchPairs([t('a', 500_000)], [p('x', 500_000, '9570')])).toEqual([]);
    expect(autoMatchPairs([t('a', 500_000)], [p('x', 500_001)])).toEqual([]);
    expect(autoMatchPairs([t('a', 500_000)], [p('x', 500_000, '9969', '2026-11-19')])).toEqual([]);
  });

  it('phiếu không có tài khoản nguồn (ghi trước 2026-10-15) thì không tự khớp', () => {
    expect(autoMatchPairs([t('a', 500_000)], [{ id: 'x', amount: 500_000, account_no: null, paid_on: '2026-11-17' }])).toEqual([]);
  });

  it('hai phiếu cùng hợp một khoản → không chọn hộ', () => {
    expect(autoMatchPairs([t('a', 500_000)], [p('x', 500_000), p('y', 500_000)])).toEqual([]);
  });

  it('hai khoản cùng hợp một phiếu → không chọn hộ', () => {
    expect(autoMatchPairs([t('a', 500_000), t('b', 500_000)], [p('x', 500_000)])).toEqual([]);
  });

  it('cặp rõ ràng vẫn khớp dù bên cạnh có cặp lẫn', () => {
    const out = autoMatchPairs(
      [t('a', 500_000), t('b', 500_000), t('c', 820_000)],
      [p('x', 500_000), p('z', 820_000)],
    );
    expect(out).toEqual([{ txn_id: 'c', payment_id: 'z' }]);
  });
});

describe('rankNccCandidates', () => {
  it('đúng tiền + đúng TK lên đầu, rồi lệch tiền ít', () => {
    const txn = { id: 'a', amount: 1_200_000, account_no: '9969', occurred_at: VN_0130_17 };
    const ranked = rankNccCandidates(txn, [
      { id: 'lech50k', amount: 1_250_000, account_no: '9969', paid_on: '2026-11-17' },
      { id: 'dungKhacTK', amount: 1_200_000, account_no: '9570', paid_on: '2026-11-17' },
      { id: 'dung', amount: 1_200_000, account_no: '9969', paid_on: '2026-11-18' },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['dung', 'dungKhacTK', 'lech50k']);
  });
});

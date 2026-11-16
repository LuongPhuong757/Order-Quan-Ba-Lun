// Bất biến duy nhất mà sổ giao dịch phải giữ: dòng TRÊN CÙNG bằng đúng con số "còn phải trả" ở
// đầu màn. Sai chiều cộng dồn thì mọi con số vẫn hiện ra bình thường, chỉ có điều hai chỗ nói hai
// kiểu — và người đang đứng đối chiếu với NCC sẽ tin nhầm chỗ.
import { describe, expect, it } from 'vitest';
import { buildLedger, snapshotDrift, type LedgerDelivery } from './supplier-ledger.ts';

const d = (
  id: string,
  date: string,
  amount: number,
  snapshot: number | null = null,
): LedgerDelivery => ({ id, date, amount, source: 'STAFF', balance_after_snapshot: snapshot });

const p = (id: string, paid_on: string, amount: number) => ({ id, paid_on, amount });

describe('buildLedger', () => {
  it('dòng trên cùng bằng đúng công nợ hiện tại', () => {
    const rows = buildLedger({
      opening_balance: 1_000_000,
      opening_balance_date: '2026-08-01',
      deliveries: [d('a', '2026-08-10', 500_000), d('b', '2026-08-20', 300_000)],
      payments: [p('x', '2026-08-15', 200_000)],
    });
    // 1.000.000 + 500.000 + 300.000 − 200.000
    expect(rows[0].running).toBe(1_600_000);
  });

  it('cộng dồn từ cũ nhất lên, mỗi dòng là số nợ ngay sau nó', () => {
    const rows = buildLedger({
      opening_balance: 1_000_000,
      opening_balance_date: '2026-08-01',
      deliveries: [d('a', '2026-08-10', 500_000), d('b', '2026-08-20', 300_000)],
      payments: [p('x', '2026-08-15', 200_000)],
    });
    expect(rows.map((r) => [r.key, r.running])).toEqual([
      ['db', 1_600_000], // 20/8 nhập 300k
      ['px', 1_300_000], // 15/8 trả 200k
      ['da', 1_500_000], // 10/8 nhập 500k
      ['opening', 1_000_000],
    ]);
  });

  it('trả dư ra số âm chứ không kẹp về 0 — quán ứng trước là chuyện có thật', () => {
    const rows = buildLedger({
      opening_balance: 0,
      opening_balance_date: null,
      deliveries: [d('a', '2026-08-10', 100_000)],
      payments: [p('x', '2026-08-11', 500_000)],
    });
    expect(rows[0].running).toBe(-400_000);
  });

  it('cùng ngày xếp nhập → trả → nợ cũ, nên nợ cũ luôn là dòng đáy', () => {
    const rows = buildLedger({
      opening_balance: 700_000,
      opening_balance_date: '2026-08-10',
      deliveries: [d('a', '2026-08-10', 100_000)],
      payments: [p('x', '2026-08-10', 50_000)],
    });
    expect(rows.map((r) => r.kind)).toEqual(['delivery', 'payment', 'opening']);
    expect(rows[2].running).toBe(700_000);
    expect(rows[0].running).toBe(750_000);
  });

  it('phiếu nhập bù lùi ngày vẫn cộng dồn theo NGÀY phiếu (ca chủ quán báo 2026-11-16)', () => {
    // Nhập vào máy theo thứ tự 28, 29, 01/11, 31/10, 30/10 — số đóng dấu ra 568 ở dòng 30/10.
    const rows = buildLedger({
      opening_balance: 0,
      opening_balance_date: null,
      deliveries: [
        { ...d('a', '2026-10-28', 96_000, 96_000), created_at: 1 },
        { ...d('b', '2026-10-29', 88_000, 184_000), created_at: 2 },
        { ...d('e', '2026-11-01', 112_000, 296_000), created_at: 3 },
        { ...d('d', '2026-10-31', 184_000, 480_000), created_at: 4 },
        { ...d('c', '2026-10-30', 88_000, 568_000), created_at: 5 },
      ],
      payments: [],
    });
    expect(rows.map((r) => [r.date, r.running])).toEqual([
      ['2026-11-01', 568_000],
      ['2026-10-31', 456_000],
      ['2026-10-30', 272_000],
      ['2026-10-29', 184_000],
      ['2026-10-28', 96_000],
    ]);
  });

  it('cùng ngày có giờ nhập thì xếp theo giờ nhập, không theo loại', () => {
    const rows = buildLedger({
      opening_balance: 0,
      opening_balance_date: null,
      // Trả 50k lúc 9h, NHẬP phiếu 100k lúc 10h, trả 20k lúc 11h.
      deliveries: [{ ...d('a', '2026-08-10', 100_000), created_at: 10 }],
      payments: [
        { ...p('x', '2026-08-10', 50_000), created_at: 9 },
        { ...p('y', '2026-08-10', 20_000), created_at: 11 },
      ],
    });
    expect(rows.map((r) => [r.key, r.running])).toEqual([
      ['py', 30_000],
      ['da', 50_000],
      ['px', -50_000],
    ]);
  });

  it('nợ cũ 0đ không sinh dòng', () => {
    const rows = buildLedger({
      opening_balance: 0,
      opening_balance_date: '2026-08-01',
      deliveries: [d('a', '2026-08-10', 100_000)],
      payments: [],
    });
    expect(rows.map((r) => r.kind)).toEqual(['delivery']);
  });

  it('sổ rỗng không nổ', () => {
    expect(
      buildLedger({ opening_balance: 0, opening_balance_date: null, deliveries: [], payments: [] }),
    ).toEqual([]);
  });
});

describe('snapshotDrift', () => {
  const ledger = (deliveries: LedgerDelivery[], payments: Array<ReturnType<typeof p>> = []) =>
    buildLedger({ opening_balance: 0, opening_balance_date: null, deliveries, payments });

  it('im lặng khi số đóng dấu khớp số tính lại', () => {
    const rows = ledger([d('a', '2026-08-10', 100_000, 100_000)]);
    expect(snapshotDrift(rows[0])).toBeNull();
  });

  it('im lặng với phiếu cũ chưa có dấu đóng', () => {
    const rows = ledger([d('a', '2026-08-10', 100_000, null)]);
    expect(snapshotDrift(rows[0])).toBeNull();
  });

  it('báo lệch cả hai phiếu khi có phiếu nhập bù LÙI ngày', () => {
    // Phiếu 'a' lúc nhập là phiếu đầu tiên → đóng dấu 100k. Sau đó nhập bù phiếu 'b' ngày 05/8,
    // tức chen vào TRƯỚC 'a' trong sổ, nên số luỹ kế của 'a' thành 130k.
    const rows = ledger([d('a', '2026-08-10', 100_000, 100_000), d('b', '2026-08-05', 30_000, 130_000)]);
    const a = rows.find((r) => r.key === 'da')!;
    expect(a.running).toBe(130_000);
    expect(snapshotDrift(a)).toBe(100_000);

    // Phiếu nhập bù cũng lệch, và đây là hành vi ĐÚNG chứ không phải sót: sổ xếp theo NGÀY GIAO
    // (05/8 → đáy sổ, luỹ kế 30k) còn dấu đóng theo LÚC NHẬP LIỆU (khi tổng đã là 130k). Hai
    // trục thời gian khác nhau thì con số khác nhau, và ⚠ nói đúng điều đó.
    const b = rows.find((r) => r.key === 'db')!;
    expect(b.running).toBe(30_000);
    expect(snapshotDrift(b)).toBe(130_000);
  });

  it('không báo gì cho dòng trả tiền và nợ cũ', () => {
    const rows = buildLedger({
      opening_balance: 500_000,
      opening_balance_date: '2026-08-01',
      deliveries: [],
      payments: [p('x', '2026-08-05', 100_000)],
    });
    expect(rows.map(snapshotDrift)).toEqual([null, null]);
  });
});

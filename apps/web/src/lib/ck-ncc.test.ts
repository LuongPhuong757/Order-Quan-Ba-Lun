import { describe, it, expect } from 'vitest';
import { buildAccountFlowChart, KHONG_TK, tongTheo } from './ck-ncc.ts';
import type { TraTienRow } from './supplier-stats.ts';

const dong = (o: Partial<TraTienRow>): TraTienRow => ({
  payment_id: 'p',
  paid_on: '2026-10-15',
  supplier_id: 's1',
  supplier_name: 'Chị Lan rau',
  amount: 0,
  method: 'TRANSFER',
  paid_from_account_id: 'vcb',
  paid_from_label: 'VCB Quán',
  note: null,
  created_by_name: 'Chủ',
  ...o,
});

describe('tongTheo', () => {
  const rows = [
    dong({ amount: 300_000 }),
    dong({ amount: 200_000, supplier_id: 's2', supplier_name: 'Anh Tư thịt', paid_from_account_id: 'acb', paid_from_label: 'ACB HKD' }),
    dong({ amount: 500_000, method: 'CASH', paid_from_account_id: null, paid_from_label: null }),
    dong({ amount: 100_000, paid_from_account_id: null, paid_from_label: null }),
  ];

  it('theo NCC: cộng mọi hình thức, sắp tiền giảm dần', () => {
    expect(tongTheo(rows, 'ncc')).toEqual([
      { key: 's1', ten: 'Chị Lan rau', tien: 900_000, lan: 3 },
      { key: 's2', ten: 'Anh Tư thịt', tien: 200_000, lan: 1 },
    ]);
  });

  it('theo tài khoản: bỏ tiền mặt, CK cũ không có TK gom vào nhóm riêng', () => {
    expect(tongTheo(rows, 'tk')).toEqual([
      { key: 'vcb', ten: 'VCB Quán', tien: 300_000, lan: 1 },
      { key: 'acb', ten: 'ACB HKD', tien: 200_000, lan: 1 },
      { key: '', ten: KHONG_TK, tien: 100_000, lan: 1 },
    ]);
  });
});

describe('buildAccountFlowChart', () => {
  it('trải đủ mọi ngày trong kỳ, ngày không có tiền là 0', () => {
    const c = buildAccountFlowChart(
      [
        { day: '2026-10-13', in: 500_000, out: 0 },
        { day: '2026-10-15', in: 200_000, out: 1_000_000 },
      ],
      { from: '2026-10-13', to: '2026-10-15' },
    );
    expect(c.bucket).toBe('day');
    expect(c.labels).toHaveLength(3);
    expect(c.vao).toEqual([500_000, 0, 200_000]);
    expect(c.ra).toEqual([0, 0, 1_000_000]);
    expect(c.tongVao).toBe(700_000);
    expect(c.tongRa).toBe(1_000_000);
  });

  it('không có dữ liệu thì trả biểu đồ rỗng', () => {
    expect(buildAccountFlowChart([], { from: '2026-10-01', to: '2026-10-15' }).labels).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { historyFilterKey, historyQuery, type HistoryFilters } from './history-filter.ts';
import { vnDayEndMs, vnDayStartMs } from './date-range.ts';

const EMPTY: HistoryFilters = {
  table_id: '',
  cashier_user_id: '',
  status: 'all',
  misa: '',
  from: '',
  to: '',
};

describe('historyQuery', () => {
  it('bộ lọc rỗng → không gửi tham số nào', () => {
    expect(historyQuery(EMPTY).toString()).toBe('');
  });

  it('gửi đúng 4 trục lọc khi có', () => {
    const q = historyQuery({
      ...EMPTY,
      table_id: 't1',
      cashier_user_id: 'u9',
      status: 'paid',
      misa: 'copied',
    });
    expect(q.get('table_id')).toBe('t1');
    expect(q.get('cashier_user_id')).toBe('u9');
    expect(q.get('status')).toBe('paid');
    expect(q.get('misa')).toBe('copied');
  });

  it("status 'all' KHÔNG được gửi lên — BE hiểu thiếu tham số là tất cả", () => {
    expect(historyQuery({ ...EMPTY, status: 'all' }).has('status')).toBe(false);
  });

  // Đây là lõi của bug: khoảng ngày phải là mốc giờ VN, không phải giờ máy.
  it('khoảng ngày ra epoch ms theo giờ VN, độc lập múi giờ của máy', () => {
    const q = historyQuery({ ...EMPTY, from: '2026-09-09', to: '2026-09-09' });
    // 2026-09-09T00:00:00+07:00 = 2026-09-08T17:00:00Z
    expect(Number(q.get('start_ms'))).toBe(Date.parse('2026-09-08T17:00:00.000Z'));
    // 2026-09-09T23:59:59.999+07:00 = 2026-09-09T16:59:59.999Z
    expect(Number(q.get('end_ms'))).toBe(Date.parse('2026-09-09T16:59:59.999Z'));
  });

  it('chỉ có `from` thì chỉ gửi start_ms, và ngược lại', () => {
    const a = historyQuery({ ...EMPTY, from: '2026-01-01' });
    expect(a.has('start_ms')).toBe(true);
    expect(a.has('end_ms')).toBe(false);
    const b = historyQuery({ ...EMPTY, to: '2026-01-31' });
    expect(b.has('start_ms')).toBe(false);
    expect(b.has('end_ms')).toBe(true);
  });

  it('cuối ngày không lấn sang ngày sau', () => {
    expect(vnDayEndMs('2026-09-09') + 1).toBe(vnDayStartMs('2026-09-10'));
  });

  it("`cashier: false` bỏ thu ngân — /consumption không nhận tham số đó", () => {
    const q = historyQuery({ ...EMPTY, table_id: 't1', cashier_user_id: 'u9' }, { cashier: false });
    expect(q.has('cashier_user_id')).toBe(false);
    expect(q.get('table_id')).toBe('t1');
  });

  it('phân trang chỉ thêm khi được yêu cầu', () => {
    expect(historyQuery(EMPTY).has('page')).toBe(false);
    const q = historyQuery(EMPTY, { page: { page: 3, page_size: 20 } });
    expect(q.get('page')).toBe('3');
    expect(q.get('page_size')).toBe('20');
  });

  it('cùng bộ lọc → cùng query cho cả 3 endpoint (trừ 2 khác biệt đã khai)', () => {
    const f: HistoryFilters = {
      ...EMPTY,
      table_id: 't1',
      status: 'paid',
      from: '2026-09-01',
      to: '2026-09-09',
    };
    const list = historyQuery(f, { page: { page: 1, page_size: 20 } });
    const stats = historyQuery(f);
    const cons = historyQuery(f, { cashier: false });
    for (const k of ['table_id', 'status', 'start_ms', 'end_ms']) {
      expect(stats.get(k)).toBe(list.get(k));
      expect(cons.get(k)).toBe(list.get(k));
    }
  });
});

describe('historyFilterKey', () => {
  it('đổi trục lọc → đổi khoá (effect phải tải lại)', () => {
    expect(historyFilterKey({ ...EMPTY, from: '2026-09-09' })).not.toBe(historyFilterKey(EMPTY));
    expect(historyFilterKey({ ...EMPTY, status: 'paid' })).not.toBe(historyFilterKey(EMPTY));
  });

  it('khoá KHÔNG chứa phân trang — biểu đồ không được tải lại khi sang trang', () => {
    expect(historyFilterKey(EMPTY)).not.toContain('page');
  });

  it('cùng bộ lọc → cùng khoá', () => {
    const f: HistoryFilters = { ...EMPTY, table_id: 't1', to: '2026-09-09' };
    expect(historyFilterKey(f)).toBe(historyFilterKey({ ...f }));
  });
});

import { describe, it, expect } from 'vitest';
import { historyFilterKey, historyQuery, type HistoryFilters } from './history-filter.ts';
import { shiftStartMs, vnDayEndMs, vnDayStartMs } from './date-range.ts';

const EMPTY: HistoryFilters = {
  table_id: '',
  cashier_user_id: '',
  qr_account_id: '',
  status: 'all',
  misa: '',
  payment: '',
  verified: '',
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

  it('lọc theo tài khoản nhận tiền gửi qr_account_id', () => {
    expect(historyQuery({ ...EMPTY, qr_account_id: 'acc-1' }).get('qr_account_id')).toBe('acc-1');
    expect(historyQuery(EMPTY).has('qr_account_id')).toBe(false);
  });

  // Cùng lý do với thu ngân: /consumption nói về nguyên liệu đã dùng, không về tiền về đâu.
  it("`cashier: false` cũng bỏ luôn tài khoản nhận", () => {
    const q = historyQuery({ ...EMPTY, qr_account_id: 'acc-1' }, { cashier: false });
    expect(q.has('qr_account_id')).toBe(false);
  });

  it('đổi tài khoản nhận thì khoá bộ lọc đổi theo — biểu đồ phải tải lại', () => {
    expect(historyFilterKey({ ...EMPTY, qr_account_id: 'acc-1' })).not.toBe(
      historyFilterKey({ ...EMPTY, qr_account_id: 'acc-2' }),
    );
  });

  it("sort mặc định ('opened') KHÔNG gửi lên — thiếu tham số nghĩa là giờ vào ăn", () => {
    expect(historyQuery(EMPTY).has('sort')).toBe(false);
    expect(historyQuery(EMPTY, { sort: 'opened' }).has('sort')).toBe(false);
  });

  it("sort theo giờ thanh toán gửi sort=paid", () => {
    expect(historyQuery(EMPTY, { sort: 'paid' }).get('sort')).toBe('paid');
  });

  it('sort không đụng tới các trục lọc khác', () => {
    const f: HistoryFilters = { ...EMPTY, table_id: 't1', status: 'paid' };
    const a = historyQuery(f, { sort: 'paid' });
    const b = historyQuery(f);
    expect(a.get('table_id')).toBe(b.get('table_id'));
    expect(a.get('status')).toBe(b.get('status'));
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

  // Sort nằm ở `opts`, không nằm trong `HistoryFilters` — chính là để khoá này không đổi:
  // đổi cách sắp xếp 20 dòng đang xem không được kéo theo 2 request số liệu.
  it('khoá KHÔNG chứa trục sắp xếp — biểu đồ không được tải lại khi đổi sort', () => {
    expect(historyFilterKey(EMPTY)).not.toContain('sort');
  });

  it('cùng bộ lọc → cùng khoá', () => {
    const f: HistoryFilters = { ...EMPTY, table_id: 't1', to: '2026-09-09' };
    expect(historyFilterKey(f)).toBe(historyFilterKey({ ...f }));
  });
});

// ── Lọc theo ca ───────────────────────────────────────────────────────────────────────────
// Ca chạy 12h trưa → 12h trưa (12h VN = 05:00Z).
const SAU_12H = Date.parse('2026-09-07T06:00:00Z'); // 13:00 VN
const TRUOC_12H = Date.parse('2026-09-07T04:30:00Z'); // 11:30 VN — ca mở từ trưa hôm qua

describe('historyQuery — ca đang chạy', () => {
  it('gửi start_ms đúng mốc đầu ca', () => {
    const q = historyQuery({ ...EMPTY, shift: 'current' }, { nowMs: SAU_12H });
    expect(Number(q.get('start_ms'))).toBe(shiftStartMs(SAU_12H));
    expect(Number(q.get('start_ms'))).toBe(Date.parse('2026-09-07T05:00:00.000Z'));
  });

  it('trước 12h trưa thì hỏi từ 12h trưa HÔM QUA', () => {
    const q = historyQuery({ ...EMPTY, shift: 'current' }, { nowMs: TRUOC_12H });
    expect(Number(q.get('start_ms'))).toBe(Date.parse('2026-09-06T05:00:00.000Z'));
  });

  // "Tới bây giờ" cố ý để trống đầu trên — xem ghi chú trong `historyQuery`.
  it('KHÔNG gửi end_ms — đơn mới thanh toán phải hiện ra ngay, không cần bấm lại chip', () => {
    expect(historyQuery({ ...EMPTY, shift: 'current' }, { nowMs: SAU_12H }).has('end_ms')).toBe(false);
  });

  it('cờ ca ĐÈ khoảng ngày — không bao giờ gửi cả hai kiểu mốc cùng lúc', () => {
    const q = historyQuery(
      { ...EMPTY, shift: 'current', from: '2026-01-01', to: '2026-01-31' },
      { nowMs: SAU_12H },
    );
    expect(Number(q.get('start_ms'))).toBe(shiftStartMs(SAU_12H));
    expect(q.has('end_ms')).toBe(false);
  });

  it('các trục lọc khác vẫn đi cùng khoảng ca', () => {
    const q = historyQuery({ ...EMPTY, shift: 'current', table_id: 't1', status: 'paid' }, { nowMs: SAU_12H });
    expect(q.get('table_id')).toBe('t1');
    expect(q.get('status')).toBe('paid');
  });

  it('cả 3 endpoint cùng hỏi một mốc ca', () => {
    const f: HistoryFilters = { ...EMPTY, shift: 'current' };
    const list = historyQuery(f, { nowMs: SAU_12H, page: { page: 1, page_size: 20 } });
    const stats = historyQuery(f, { nowMs: SAU_12H });
    const cons = historyQuery(f, { nowMs: SAU_12H, cashier: false });
    expect(stats.get('start_ms')).toBe(list.get('start_ms'));
    expect(cons.get('start_ms')).toBe(list.get('start_ms'));
  });
});

describe('historyQuery — ca trước (2026-09-16)', () => {
  it('CHẶN CẢ HAI ĐẦU — khác hẳn ca đang chạy', () => {
    const q = historyQuery({ ...EMPTY, shift: 'prev' }, { nowMs: SAU_12H });
    expect(Number(q.get('start_ms'))).toBe(Date.parse('2026-09-06T05:00:00.000Z'));
    expect(Number(q.get('end_ms'))).toBe(Date.parse('2026-09-07T05:00:00.000Z') - 1);
  });

  // Nếu end_ms lấy trọn mốc đầu ca này thì một đơn nằm ở CẢ HAI ca, và tổng hai ca cộng lại
  // vượt thực tế — kiểu sai không ai phát hiện ra bằng mắt.
  it('không chồng lấn ca đang chạy', () => {
    const prev = historyQuery({ ...EMPTY, shift: 'prev' }, { nowMs: SAU_12H });
    const cur = historyQuery({ ...EMPTY, shift: 'current' }, { nowMs: SAU_12H });
    expect(Number(prev.get('end_ms')) + 1).toBe(Number(cur.get('start_ms')));
  });

  it('lúc rạng sáng, ca trước lùi hai ngày lịch', () => {
    const q = historyQuery({ ...EMPTY, shift: 'prev' }, { nowMs: TRUOC_12H });
    expect(Number(q.get('start_ms'))).toBe(Date.parse('2026-09-05T05:00:00.000Z'));
    expect(Number(q.get('end_ms'))).toBe(Date.parse('2026-09-06T05:00:00.000Z') - 1);
  });

  it('cờ ca trước cũng ĐÈ khoảng ngày', () => {
    const q = historyQuery(
      { ...EMPTY, shift: 'prev', from: '2026-01-01', to: '2026-01-31' },
      { nowMs: SAU_12H },
    );
    expect(Number(q.get('start_ms'))).toBe(Date.parse('2026-09-06T05:00:00.000Z'));
    expect(Number(q.get('end_ms'))).toBe(Date.parse('2026-09-07T05:00:00.000Z') - 1);
  });

  it('cả 3 endpoint cùng hỏi một khoảng ca trước', () => {
    const f: HistoryFilters = { ...EMPTY, shift: 'prev' };
    const list = historyQuery(f, { nowMs: SAU_12H, page: { page: 1, page_size: 20 } });
    const cons = historyQuery(f, { nowMs: SAU_12H, cashier: false });
    expect(cons.get('start_ms')).toBe(list.get('start_ms'));
    expect(cons.get('end_ms')).toBe(list.get('end_ms'));
  });
});

describe('historyFilterKey — khoảng ca', () => {
  // Khoá này là deps của effect tải dữ liệu. Nếu nó nhúng `Date.now()` thô thì mỗi lần render
  // ra một khoá mới → effect chạy lại vô tận. Mốc phải snap về đầu ca.
  it('khoá ĐỨNG YÊN trong suốt một ca, dù giờ hiện tại trôi đi', () => {
    const f: HistoryFilters = { ...EMPTY, shift: 'current' };
    const trua = historyFilterKey(f, Date.parse('2026-09-07T06:00:00Z')); // 13:00 VN
    const toi = historyFilterKey(f, Date.parse('2026-09-07T13:00:00Z')); // 20:00 VN
    const dem = historyFilterKey(f, Date.parse('2026-09-07T18:00:00Z')); // 01:00 VN hôm sau
    const sang = historyFilterKey(f, Date.parse('2026-09-08T04:00:00Z')); // 11:00 VN hôm sau
    expect(toi).toBe(trua);
    expect(dem).toBe(trua);
    expect(sang).toBe(trua);
  });

  it('ca trước cũng đứng yên trong suốt ca đang chạy', () => {
    const f: HistoryFilters = { ...EMPTY, shift: 'prev' };
    const trua = historyFilterKey(f, Date.parse('2026-09-07T06:00:00Z'));
    const dem = historyFilterKey(f, Date.parse('2026-09-07T18:00:00Z'));
    expect(dem).toBe(trua);
  });

  it('qua 12h trưa thì khoá ĐỔI — phải tải lại theo ca mới', () => {
    const f: HistoryFilters = { ...EMPTY, shift: 'current' };
    const truoc = historyFilterKey(f, Date.parse('2026-09-07T04:59:59Z'));
    const sau = historyFilterKey(f, Date.parse('2026-09-07T05:00:00Z'));
    expect(sau).not.toBe(truoc);
  });

  it('ca khác hẳn "tất cả thời gian"', () => {
    expect(historyFilterKey({ ...EMPTY, shift: 'current' }, SAU_12H)).not.toBe(
      historyFilterKey(EMPTY, SAU_12H),
    );
  });

  it('hai ca là hai câu hỏi khác nhau — khoá phải khác', () => {
    expect(historyFilterKey({ ...EMPTY, shift: 'current' }, SAU_12H)).not.toBe(
      historyFilterKey({ ...EMPTY, shift: 'prev' }, SAU_12H),
    );
  });
});

describe('lọc theo hình thức thu tiền (2026-09-14)', () => {
  it('không chọn → không gửi tham số, để BE trả mọi hình thức', () => {
    expect(historyQuery(EMPTY).get('payment')).toBeNull();
  });

  it('mỗi hình thức gửi đúng giá trị BE hiểu', () => {
    expect(historyQuery({ ...EMPTY, payment: 'cash' }).get('payment')).toBe('cash');
    expect(historyQuery({ ...EMPTY, payment: 'transfer' }).get('payment')).toBe('transfer');
    expect(historyQuery({ ...EMPTY, payment: 'mixed' }).get('payment')).toBe('mixed');
  });

  it('đổi hình thức làm ĐỔI KHOÁ lọc — nếu không, khối đối soát sẽ không tải lại', () => {
    // Đây chính là thứ khiến "đối soát phải đổi theo bộ lọc" hoạt động: khoá này là deps của
    // effect tải khối đối soát.
    expect(historyFilterKey({ ...EMPTY, payment: 'cash' })).not.toBe(historyFilterKey(EMPTY));
  });

  it('khoá lọc cũng đổi theo thu ngân và khoảng ngày', () => {
    expect(historyFilterKey({ ...EMPTY, cashier_user_id: 'u1' })).not.toBe(historyFilterKey(EMPTY));
    expect(historyFilterKey({ ...EMPTY, from: '2026-09-14', to: '2026-09-14' })).not.toBe(
      historyFilterKey(EMPTY),
    );
  });
});

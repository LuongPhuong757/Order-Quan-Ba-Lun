import { describe, expect, it } from 'vitest';
import {
  KHAC_ID,
  buildSpendChart,
  chonBucket,
  dauTuan,
  gopTheoMon,
  khongDau,
  lietKeBucket,
  locMon,
  locPhieuTheoMon,
  luongGon,
  phanTrang,
  sapXep,
  tienGon,
  tongConPhaiTra,
  type DailyRow,
  type DeliveryStatRow,
  type PairRow,
} from './supplier-stats.ts';

const daily = (over: Partial<DailyRow> & Pick<DailyRow, 'delivery_date' | 'supplier_id'>): DailyRow => ({
  supplier_name: `NCC ${over.supplier_id}`,
  amount: 100_000,
  deliveries: 1,
  ...over,
});

const pair = (over: Partial<PairRow> & Pick<PairRow, 'ingredient_id' | 'supplier_id'>): PairRow => ({
  supplier_name: `NCC ${over.supplier_id}`,
  ingredient_name: `Món ${over.ingredient_id}`,
  base_unit: 'g',
  deliveries: 1,
  qty_base: 1000,
  amount: 100_000,
  last_date: '2026-09-01',
  ...over,
});

describe('chonBucket — chọn ngày/tuần/tháng theo độ dài kỳ', () => {
  it('kỳ ngắn vẽ theo ngày, dài vừa theo tuần, rất dài theo tháng', () => {
    expect(chonBucket(1)).toBe('day');
    expect(chonBucket(62)).toBe('day');
    expect(chonBucket(63)).toBe('week');
    expect(chonBucket(400)).toBe('week');
    expect(chonBucket(401)).toBe('month');
  });
});

describe('dauTuan — tuần bắt đầu thứ Hai', () => {
  it('mọi ngày trong tuần đều quy về đúng thứ Hai của tuần đó', () => {
    // 2026-09-07 là thứ Hai; 2026-09-13 là Chủ nhật cùng tuần.
    expect(dauTuan('2026-09-07')).toBe('2026-09-07');
    expect(dauTuan('2026-09-10')).toBe('2026-09-07');
    expect(dauTuan('2026-09-13')).toBe('2026-09-07');
    // Chủ nhật KHÔNG được mở tuần mới — đây là chỗ dễ sai nhất của phép %7.
    expect(dauTuan('2026-09-14')).toBe('2026-09-14');
  });
});

describe('lietKeBucket — bucket rỗng vẫn phải có mặt', () => {
  it('liệt kê đủ từng ngày kể cả ngày không nhập hàng', () => {
    expect(lietKeBucket('2026-09-01', '2026-09-04', 'day')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ]);
  });

  it('mức tháng đi qua ranh giới năm', () => {
    expect(lietKeBucket('2026-11-20', '2027-02-03', 'month')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('khoảng ngược hoặc thiếu đầu mút thì rỗng, không văng lỗi', () => {
    expect(lietKeBucket('2026-09-10', '2026-09-01', 'day')).toEqual([]);
    expect(lietKeBucket('', '2026-09-01', 'day')).toEqual([]);
  });
});

describe('buildSpendChart', () => {
  it('mỗi NCC một đường, ngày không nhập là 0 chứ không bị bỏ qua', () => {
    const c = buildSpendChart(
      [
        daily({ delivery_date: '2026-09-01', supplier_id: 'a', amount: 300_000 }),
        daily({ delivery_date: '2026-09-03', supplier_id: 'b', amount: 200_000 }),
      ],
      { from: '2026-09-01', to: '2026-09-03' },
    );
    expect(c.bucket).toBe('day');
    expect(c.labels).toEqual(['01/09', '02/09', '03/09']);
    const a = c.series.find((s) => s.supplier_id === 'a')!;
    expect(a.values).toEqual([300_000, 0, 0]);
    expect(c.total).toBe(500_000);
  });

  it('cộng dồn nhiều phiếu cùng NCC trong cùng một bucket tuần', () => {
    const rows: DailyRow[] = [];
    // 70 ngày ⇒ gộp theo tuần.
    for (let i = 0; i < 70; i++) {
      const d = new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString().slice(0, 10);
      rows.push(daily({ delivery_date: d, supplier_id: 'a', amount: 10_000 }));
    }
    const c = buildSpendChart(rows, { from: '2026-06-01', to: '2026-08-09' });
    expect(c.bucket).toBe('week');
    expect(c.series).toHaveLength(1);
    expect(c.series[0].total).toBe(700_000);
    // Tổng qua các bucket phải bằng tổng thô — không được rơi rớt ngày nào.
    expect(c.series[0].values.reduce((s, v) => s + v, 0)).toBe(700_000);
  });

  it('quá topN thì phần đuôi gộp thành một đường "Khác", không sinh thêm màu', () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      daily({ delivery_date: '2026-09-01', supplier_id: `s${i}`, amount: (11 - i) * 1000 }),
    );
    const c = buildSpendChart(rows, { from: '2026-09-01', to: '2026-09-01' }, 8);
    expect(c.series).toHaveLength(9);
    const khac = c.series[8];
    expect(khac.supplier_id).toBe(KHAC_ID);
    expect(khac.supplier_name).toBe('Khác (3 NCC)');
    // 3 NCC nhỏ nhất: 3000 + 2000 + 1000.
    expect(khac.total).toBe(6000);
    // Gộp không được làm mất tiền.
    expect(c.total).toBe(rows.reduce((s, r) => s + r.amount, 0));
  });

  it('kỳ "tất cả" lấy hai đầu từ chính dữ liệu, không kéo tới hôm nay', () => {
    const c = buildSpendChart(
      [
        daily({ delivery_date: '2026-09-01', supplier_id: 'a' }),
        daily({ delivery_date: '2026-09-02', supplier_id: 'a' }),
      ],
      { from: '', to: '' },
    );
    expect(c.labels).toEqual(['01/09', '02/09']);
  });

  it('không có phiếu nào thì trả biểu đồ rỗng', () => {
    expect(buildSpendChart([], { from: '', to: '' })).toEqual({
      bucket: 'day',
      labels: [],
      series: [],
      total: 0,
    });
  });
});

describe('gopTheoMon', () => {
  it('cùng một món mua từ 3 NCC gộp thành 1 dòng, đếm đúng số NCC và lấy ngày mới nhất', () => {
    const rows = gopTheoMon([
      pair({ ingredient_id: 'ca', supplier_id: 'a', amount: 100, qty_base: 10, deliveries: 2, last_date: '2026-09-01' }),
      pair({ ingredient_id: 'ca', supplier_id: 'b', amount: 200, qty_base: 20, deliveries: 1, last_date: '2026-09-05' }),
      pair({ ingredient_id: 'ca', supplier_id: 'c', amount: 300, qty_base: 30, deliveries: 3, last_date: '2026-09-03' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ingredient_id: 'ca',
      amount: 600,
      qty_base: 60,
      deliveries: 6,
      suppliers: 3,
      last_date: '2026-09-05',
    });
  });

  it('hai món khác nhau vẫn là hai dòng', () => {
    expect(gopTheoMon([pair({ ingredient_id: 'ca', supplier_id: 'a' }), pair({ ingredient_id: 'rau', supplier_id: 'a' })])).toHaveLength(2);
  });
});

describe('tìm kiếm theo món', () => {
  const phieu = (id: string, items: string[]): DeliveryStatRow => ({
    delivery_id: id,
    delivery_date: '2026-09-01',
    supplier_id: 'a',
    supplier_name: 'Trâu Tươi',
    note: null,
    amount: 1000,
    lines: items.length,
    items,
  });

  it('gõ không dấu vẫn ra món có dấu', () => {
    expect(khongDau('Cá Đù')).toBe('ca du');
    expect(locMon([{ ingredient_name: 'Cá Đù' }, { ingredient_name: 'Rau muống' }], 'ca d')).toEqual([
      { ingredient_name: 'Cá Đù' },
    ]);
  });

  it('bảng phiếu: gõ tên món ra đúng những phiếu CÓ món đó', () => {
    const rows = [phieu('p1', ['Cá đù', 'Hành']), phieu('p2', ['Rau muống']), phieu('p3', ['Cá lóc'])];
    expect(locPhieuTheoMon(rows, 'ca').map((r) => r.delivery_id)).toEqual(['p1', 'p3']);
  });

  it('không khớp tên NCC — ô lọc NCC là chỗ riêng cho việc đó', () => {
    const rows = [phieu('p1', ['Hành'])];
    expect(locPhieuTheoMon(rows, 'trau')).toEqual([]);
  });

  it('chuỗi rỗng = không lọc', () => {
    const rows = [phieu('p1', ['Hành'])];
    expect(locPhieuTheoMon(rows, '  ')).toHaveLength(1);
  });

  it('nhận cả kiểu phiếu của tab "Phiếu nhập" (chỉ cần có `items`)', () => {
    const rows = [
      { id: 'd1', status: 'CONFIRMED', items: ['Cá đù'] },
      { id: 'd2', status: 'CANCELLED', items: ['Rau muống'] },
    ];
    expect(locPhieuTheoMon(rows, 'ca').map((r) => r.id)).toEqual(['d1']);
  });
});

describe('tongConPhaiTra', () => {
  it('cộng các khoản còn nợ', () => {
    expect(tongConPhaiTra([{ balance: 300_000 }, { balance: 1_200_000 }])).toBe(1_500_000);
  });

  it('KHÔNG bù trừ khoản đã trả dư — tiền dư ở NCC này không trả nợ NCC kia được', () => {
    expect(tongConPhaiTra([{ balance: 1_000_000 }, { balance: -400_000 }])).toBe(1_000_000);
  });

  it('không có NCC nào thì bằng 0', () => {
    expect(tongConPhaiTra([])).toBe(0);
  });
});

describe('sapXep', () => {
  it('sắp theo số, hai chiều', () => {
    const rows = [{ v: 3 }, { v: 1 }, { v: 2 }];
    expect(sapXep(rows, (r) => r.v, 'desc').map((r) => r.v)).toEqual([3, 2, 1]);
    expect(sapXep(rows, (r) => r.v, 'asc').map((r) => r.v)).toEqual([1, 2, 3]);
  });

  it('không sửa mảng gốc', () => {
    const rows = [{ v: 3 }, { v: 1 }];
    sapXep(rows, (r) => r.v, 'asc');
    expect(rows.map((r) => r.v)).toEqual([3, 1]);
  });

  it('chữ tiếng Việt sắp theo locale chứ không theo mã Unicode', () => {
    const rows = [{ n: 'Ớt' }, { n: 'Cá' }, { n: 'Bún' }];
    expect(sapXep(rows, (r) => r.n, 'asc').map((r) => r.n)).toEqual(['Bún', 'Cá', 'Ớt']);
  });
});

describe('phanTrang', () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);

  it('cắt đúng trang', () => {
    expect(phanTrang(rows, 2, 10).rows).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(phanTrang(rows, 3, 10).totalPages).toBe(3);
  });

  it('đang ở trang cuối rồi lọc còn ít kết quả thì KẸP lại, không trả bảng trắng', () => {
    const kq = phanTrang([1, 2, 3], 7, 10);
    expect(kq.page).toBe(1);
    expect(kq.rows).toEqual([1, 2, 3]);
  });

  it('rỗng vẫn là 1 trang', () => {
    expect(phanTrang([], 1, 10)).toEqual({ rows: [], page: 1, totalPages: 1, total: 0 });
  });
});

describe('định dạng', () => {
  it('tiền rút gọn cho trục biểu đồ', () => {
    expect(tienGon(0)).toBe('0');
    expect(tienGon(950)).toBe('950');
    expect(tienGon(12_000)).toBe('12k');
    expect(tienGon(1_000_000)).toBe('1tr');
    expect(tienGon(1_250_000)).toBe('1,3tr');
    expect(tienGon(2_000_000_000)).toBe('2 tỷ');
  });

  it('khối lượng: DB lưu g/ml nên số to phải đổi sang kg/l', () => {
    expect(luongGon(2500, 'g')).toBe('2,5 kg');
    expect(luongGon(1500, 'ml')).toBe('1,5 l');
    expect(luongGon(300, 'g')).toBe('300 g');
    // Đơn vị đếm tự nó là gốc (memory: đơn vị tính tuỳ ý) — không được quy đổi.
    expect(luongGon(5000, 'cái')).toBe('5.000 cái');
  });
});

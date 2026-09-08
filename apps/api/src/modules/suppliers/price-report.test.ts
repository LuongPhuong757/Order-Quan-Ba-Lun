// Test THUẦN, không cần MySQL.
import { describe, expect, it } from 'vitest';
import { aggregateByPair, buildPriceMatrix, type ReportLine } from './price-report.js';

let clock = 0;
function line(over: Partial<ReportLine> = {}): ReportLine {
  return {
    supplier_id: 'ncc-a',
    supplier_name: 'NCC A',
    ingredient_id: 'thit',
    ingredient_name: 'Thịt ba chỉ',
    base_unit: 'g',
    purchase_unit: 'kg',
    delivery_date: '2026-09-01',
    created_at: ++clock,
    qty_base: 10_000,
    amount: 1_350_000,
    unit_price: 135_000,
    unit_price_base: 135,
    prev_unit_price_base: null,
    ...over,
  };
}

describe('aggregateByPair', () => {
  // Nhóm này chặn đúng vụ chủ quán báo 2026-09-07: "Trâu Tươi 250.000 lên 260.000 nhưng không
  // thấy ở màn Biến động giá". Nguyên nhân là màn NCC bỏ bộ lọc tháng (2026-09-06) nên kỳ =
  // toàn bộ lịch sử, dòng đầu tiên không có gì đứng trước nó, `prev_unit_price_base` NULL, và
  // cả mặt hàng bị coi là không đổi giá.
  describe('không có giá kỳ trước thì so với lần nhập LIỀN TRƯỚC trong kỳ', () => {
    it('250k, 250k rồi 260k → tăng 4%, không phải "không đổi giá"', () => {
      const rows = aggregateByPair([
        line({ delivery_date: '2026-08-23', unit_price_base: 250_000, prev_unit_price_base: null }),
        line({ delivery_date: '2026-08-25', unit_price_base: 250_000 }),
        line({ delivery_date: '2026-09-06', unit_price_base: 260_000 }),
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].prev_base).toBe(250_000);
      expect(rows[0].change_pct).toBe(4);
    });

    it('giá kỳ trước CÓ thật thì vẫn ưu tiên nó — mức đổi giá của cả kỳ, không phải của lần cuối', () => {
      const rows = aggregateByPair([
        line({ delivery_date: '2026-09-01', unit_price_base: 200, prev_unit_price_base: 100 }),
        line({ delivery_date: '2026-09-02', unit_price_base: 300 }),
      ]);
      // So với 100 (cuối kỳ trước) → +200%. Nếu lùi về dòng liền trước (200) thì chỉ ra +50%.
      expect(rows[0].prev_base).toBe(100);
      expect(rows[0].change_pct).toBe(200);
    });

    it('mặt hàng mới nhập đúng một lần thì vẫn NULL — thật sự không có gì để so', () => {
      const rows = aggregateByPair([line({ unit_price_base: 250_000, prev_unit_price_base: null })]);
      expect(rows[0].prev_base).toBeNull();
      expect(rows[0].change_pct).toBeNull();
    });

    it('hai lần nhập cùng giá thì change_pct = 0, không phải NULL', () => {
      const rows = aggregateByPair([
        line({ delivery_date: '2026-09-01', unit_price_base: 250_000, prev_unit_price_base: null }),
        line({ delivery_date: '2026-09-02', unit_price_base: 250_000 }),
      ]);
      expect(rows[0].change_pct).toBe(0);
    });

    // Lùi về lần ĐẦU của kỳ, không phải lần liền trước: chủ quán báo 2026-09-08 "Tôm nhà Sơn
    // Tôm Ếch không thấy ở màn Biến động giá". Hai lần nhập cuối tình cờ cùng giá thì mốc "liền
    // trước" bằng đúng giá cuối, ra 0% và cả mặt hàng bị lọc bỏ — dù giá đã tăng 20% trong kỳ.
    it('250k → 300k → 300k vẫn là tăng 20% trong kỳ, không phải "không đổi giá"', () => {
      const rows = aggregateByPair([
        line({ delivery_date: '2026-09-01', unit_price_base: 250_000, prev_unit_price_base: null }),
        line({ delivery_date: '2026-09-03', unit_price_base: 300_000 }),
        line({ delivery_date: '2026-09-05', unit_price_base: 300_000 }),
      ]);
      expect(rows[0].prev_base).toBe(250_000);
      expect(rows[0].change_pct).toBe(20);
    });

    it('tiền ảnh hưởng tính theo giá lùi về, không còn là 0', () => {
      const rows = aggregateByPair([
        line({
          delivery_date: '2026-09-01',
          unit_price_base: 100,
          qty_base: 10,
          prev_unit_price_base: null,
        }),
        line({ delivery_date: '2026-09-02', unit_price_base: 120, qty_base: 10 }),
      ]);
      // (120 - 100) × tổng lượng 20 = 400.
      expect(rows[0].impact_amount).toBe(400);
    });
  });

  it('gộp theo cặp (NCC, mặt hàng) — cùng mặt hàng khác NCC là hai dòng', () => {
    const rows = aggregateByPair([
      line(),
      line({ supplier_id: 'ncc-b', supplier_name: 'NCC B', unit_price_base: 150 }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('giá bình quân là bình quân GIA QUYỀN theo lượng, không phải trung bình cộng đơn giá', () => {
    // 200kg giá 100đ/g + 5kg giá 200đ/g. Trung bình cộng đơn giá cho ra 150 — một con số không
    // mô tả đồng nào có thật. Bình quân gia quyền phải nghiêng hẳn về 100.
    const rows = aggregateByPair([
      line({ qty_base: 200_000, amount: 20_000_000, unit_price_base: 100 }),
      line({ qty_base: 5_000, amount: 1_000_000, unit_price_base: 200, delivery_date: '2026-09-02' }),
    ]);
    expect(rows[0].avg_unit_price_base).toBeCloseTo(102.44, 2);
    expect(rows[0].avg_unit_price_base).toBeLessThan(150);
  });

  it('giá kỳ trước lấy từ dòng ĐẦU kỳ, giá hiện tại lấy từ dòng CUỐI kỳ', () => {
    const rows = aggregateByPair([
      line({ delivery_date: '2026-09-01', unit_price_base: 140, prev_unit_price_base: 135 }),
      line({ delivery_date: '2026-09-10', unit_price_base: 145, prev_unit_price_base: 140 }),
      line({ delivery_date: '2026-09-20', unit_price_base: 150, prev_unit_price_base: 145 }),
    ]);
    expect(rows[0].prev_base).toBe(135); // chốt sẵn trên dòng đầu, không phải truy vấn ngược
    expect(rows[0].last_base).toBe(150);
    expect(rows[0].change_pct).toBeCloseTo(11.11, 2);
  });

  it('không tin thứ tự DB trả về — tự sắp theo ngày rồi mới lấy đầu/cuối', () => {
    const rows = aggregateByPair([
      line({ delivery_date: '2026-09-20', unit_price_base: 150, prev_unit_price_base: 145 }),
      line({ delivery_date: '2026-09-01', unit_price_base: 140, prev_unit_price_base: 135 }),
    ]);
    expect(rows[0].prev_base).toBe(135);
    expect(rows[0].last_base).toBe(150);
    expect(rows[0].trend).toEqual([140, 150]);
  });

  it('hai phiếu CÙNG NGÀY vẫn phân biệt được cái nào sau', () => {
    const rows = aggregateByPair([
      { ...line({ unit_price_base: 150, prev_unit_price_base: 140 }), created_at: 200 },
      { ...line({ unit_price_base: 140, prev_unit_price_base: 135 }), created_at: 100 },
    ]);
    expect(rows[0].last_base).toBe(150);
    expect(rows[0].prev_base).toBe(135);
  });

  it('tiền ảnh hưởng = chênh giá × lượng nhập trong kỳ', () => {
    const rows = aggregateByPair([
      line({ qty_base: 245_000, unit_price_base: 145, prev_unit_price_base: 135 }),
    ]);
    // (145 − 135) đ/g × 245.000 g = 2.450.000đ — đúng con số ví dụ trong spec.
    expect(rows[0].impact_amount).toBe(2_450_000);
  });

  it('mặt hàng nhập lần đầu: không có % và không tính tiền ảnh hưởng', () => {
    const rows = aggregateByPair([line({ prev_unit_price_base: null })]);
    expect(rows[0].change_pct).toBeNull();
    expect(rows[0].impact_amount).toBe(0);
  });

  it('tăng % nhỏ trên mặt hàng lớn ăn đứt tăng % to trên mặt hàng vặt', () => {
    // Cả lý do sắp bảng theo TIỀN chứ không theo % gói trong một phép so.
    const rows = aggregateByPair([
      line({
        ingredient_id: 'ca-chua',
        ingredient_name: 'Cà chua',
        qty_base: 30_000,
        unit_price_base: 28,
        prev_unit_price_base: 22,
      }),
      line({
        ingredient_id: 'thit',
        qty_base: 245_000,
        unit_price_base: 145,
        prev_unit_price_base: 135,
      }),
    ]);
    const caChua = rows.find((r) => r.ingredient_id === 'ca-chua')!;
    const thit = rows.find((r) => r.ingredient_id === 'thit')!;
    expect(caChua.change_pct).toBeGreaterThan(thit.change_pct!); // 27% > 7%
    expect(thit.impact_amount).toBeGreaterThan(caChua.impact_amount); // nhưng tốn tiền hơn nhiều
  });

  it('lượng bằng 0 không làm vỡ bảng bằng NaN', () => {
    const rows = aggregateByPair([line({ qty_base: 0, amount: 0 })]);
    expect(rows[0].avg_unit_price_base).toBe(0);
  });
});

describe('buildPriceMatrix — so giá giữa các NCC (mục 4.2)', () => {
  const cell = (over: Record<string, unknown> = {}) => ({
    ingredient_id: 'rau',
    ingredient_name: 'Rau muống',
    base_unit: 'bó',
    supplier_id: 'ncc-a',
    supplier_name: 'NCC A',
    unit_price_base: 12_000,
    purchase_unit: 'bó',
    unit_price: 12_000,
    last_delivery_date: '2026-09-05',
    ...over,
  });

  it('chỉ ra NCC rẻ nhất và mức chênh', () => {
    const rows = buildPriceMatrix([
      cell({ supplier_id: 'a', supplier_name: 'A', unit_price_base: 12_000 }),
      cell({ supplier_id: 'b', supplier_name: 'B', unit_price_base: 9_500 }),
      cell({ supplier_id: 'c', supplier_name: 'C', unit_price_base: 11_000 }),
    ]);
    expect(rows[0].cheapest_supplier_id).toBe('b');
    expect(rows[0].spread_pct).toBeCloseTo(26.32, 2);
    expect(rows[0].cells.map((c) => c.supplier_id)).toEqual(['b', 'c', 'a']); // rẻ trước
  });

  it('BỎ mặt hàng chỉ một NCC bán — không có gì để so', () => {
    const rows = buildPriceMatrix([cell({ supplier_id: 'a' })]);
    expect(rows).toHaveLength(0);
  });

  it('sắp theo mức chênh giảm dần — việc đáng đàm phán trước nằm trên', () => {
    const rows = buildPriceMatrix([
      cell({ ingredient_id: 'rau', supplier_id: 'a', unit_price_base: 10_000 }),
      cell({ ingredient_id: 'rau', supplier_id: 'b', unit_price_base: 20_000 }), // chênh 100%
      cell({ ingredient_id: 'thit', ingredient_name: 'Thịt', supplier_id: 'a', unit_price_base: 145 }),
      cell({ ingredient_id: 'thit', ingredient_name: 'Thịt', supplier_id: 'b', unit_price_base: 152 }), // ~4,8%
    ]);
    expect(rows.map((r) => r.ingredient_id)).toEqual(['rau', 'thit']);
  });

  it('so được cả khi hai NCC báo giá theo đơn vị mua khác nhau', () => {
    // NCC A bán theo thùng, NCC B bán theo chai — quy về đồng/ml mới so được (M3.D-38).
    const rows = buildPriceMatrix([
      cell({
        ingredient_id: 'mam',
        ingredient_name: 'Nước mắm',
        base_unit: 'ml',
        supplier_id: 'a',
        purchase_unit: 'thùng',
        unit_price: 180_000,
        unit_price_base: 15,
      }),
      cell({
        ingredient_id: 'mam',
        ingredient_name: 'Nước mắm',
        base_unit: 'ml',
        supplier_id: 'b',
        purchase_unit: 'chai',
        unit_price: 16_000,
        unit_price_base: 32,
      }),
    ]);
    expect(rows[0].cheapest_supplier_id).toBe('a');
  });
});

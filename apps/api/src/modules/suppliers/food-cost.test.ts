// Test THUẦN, không cần MySQL.
import { describe, expect, it } from 'vitest';
import { computeFoodCost, ingredientPrices, overheadReferencePct } from './food-cost.js';

const BUN_CHA = { id: 'm1', name: 'Bún chả', price: 40_000 };

// 1 phần bún chả: 150g thịt ba chỉ + 200g bún + 50ml nước mắm.
const recipe = [
  { menu_item_id: 'm1', ingredient_id: 'thit', ingredient_name: 'Thịt ba chỉ', base_unit: 'g', qty_per_serving: 150 },
  { menu_item_id: 'm1', ingredient_id: 'bun', ingredient_name: 'Bún tươi', base_unit: 'g', qty_per_serving: 200 },
  { menu_item_id: 'm1', ingredient_id: 'mam', ingredient_name: 'Nước mắm', base_unit: 'ml', qty_per_serving: 50 },
];

const prices = [
  { ingredient_id: 'thit', unit_price_base: 135, source: 'avg' as const }, // 135.000đ/kg
  { ingredient_id: 'bun', unit_price_base: 18, source: 'avg' as const },
  { ingredient_id: 'mam', unit_price_base: 15, source: 'avg' as const },
];

describe('computeFoodCost', () => {
  it('nhân định lượng với đơn giá rồi cộng lại', () => {
    // 150×135 + 200×18 + 50×15 = 20.250 + 3.600 + 750 = 24.600
    const [row] = computeFoodCost([BUN_CHA], recipe, prices);
    expect(row.cost).toBe(24_600);
    expect(row.complete).toBe(true);
    expect(row.margin_amount).toBe(15_400);
    expect(row.margin_pct).toBeCloseTo(38.5, 1);
  });

  it('chỉ ra nguyên liệu nào ngốn nhiều tiền nhất — để biết đàm phán cái gì trước', () => {
    const [row] = computeFoodCost([BUN_CHA], recipe, prices);
    const thit = row.components.find((c) => c.ingredient_id === 'thit')!;
    expect(thit.share_pct).toBeCloseTo(82.3, 1);
  });

  it('NCC tăng giá thịt 7% thì giá vốn và biên lợi nhuận đổi theo', () => {
    // Chính là câu hỏi mở đầu của cả milestone.
    const after = computeFoodCost([BUN_CHA], recipe, [
      { ingredient_id: 'thit', unit_price_base: 145, source: 'avg' },
      ...prices.slice(1),
    ]);
    expect(after[0].cost).toBe(26_100);
    expect(after[0].margin_pct!).toBeLessThan(38.5);
  });

  it('THIẾU giá một nguyên liệu → đánh dấu chưa đầy đủ và KHÔNG tính biên lợi nhuận', () => {
    // Kiểu sai nguy hiểm nhất của tính năng này: cộng đại phần biết được rồi hiển thị như một
    // con số hoàn chỉnh. Nó luôn cho giá vốn THẤP hơn thật → biên lợi nhuận đẹp hơn thật → chủ
    // quán yên tâm với một món đang lỗ.
    const [row] = computeFoodCost([BUN_CHA], recipe, prices.slice(0, 2));
    expect(row.complete).toBe(false);
    expect(row.missing).toEqual(['Nước mắm']);
    expect(row.margin_pct).toBeNull();
    expect(row.margin_amount).toBeNull();
    // `cost` vẫn cộng phần biết được, nhưng người đọc đã được cảnh báo là nó thiếu.
    expect(row.cost).toBe(23_850);
  });

  it('món CHƯA KHAI công thức thì không xuất hiện — khác hẳn với "khai rồi mà thiếu giá"', () => {
    const rows = computeFoodCost([BUN_CHA, { id: 'm2', name: 'Trà đá', price: 5_000 }], recipe, prices);
    expect(rows.map((r) => r.menu_item_id)).toEqual(['m1']);
  });

  it('giá bán 0 (món tặng, ghi chú) không làm vỡ phép chia', () => {
    const [row] = computeFoodCost([{ id: 'm1', name: 'Món tặng', price: 0 }], recipe, prices);
    expect(row.margin_pct).toBeNull();
  });
});

describe('ingredientPrices — bình quân gia quyền theo lượng', () => {
  it('mua nhiều giá thấp + mua ít giá cao thì bình quân nghiêng về giá thấp', () => {
    // Lấy giá LẦN CUỐI ở đây sẽ ra 200 — một lần mua lẻ lúc hết hàng kéo giá vốn cả tháng lên.
    const out = ingredientPrices(
      [
        { ingredient_id: 'thit', qty_base: 200_000, amount: 20_000_000 }, // 100đ/g
        { ingredient_id: 'thit', qty_base: 5_000, amount: 1_000_000 }, // 200đ/g
      ],
      [],
    );
    expect(out[0].unit_price_base).toBeCloseTo(102.44, 2);
    expect(out[0].source).toBe('avg');
  });

  it('nguyên liệu không nhập trong kỳ thì dùng giá gần nhất và ĐÁNH DẤU là số cũ', () => {
    const out = ingredientPrices([], [{ ingredient_id: 'mam', unit_price_base: 15 }]);
    expect(out).toEqual([{ ingredient_id: 'mam', unit_price_base: 15, source: 'last' }]);
  });

  it('có nhập trong kỳ thì KHÔNG rơi về giá cũ', () => {
    const out = ingredientPrices(
      [{ ingredient_id: 'mam', qty_base: 1_000, amount: 20_000 }],
      [{ ingredient_id: 'mam', unit_price_base: 15 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].unit_price_base).toBe(20);
  });

  it('lượng 0 không sinh ra giá vô nghĩa', () => {
    const out = ingredientPrices([{ ingredient_id: 'x', qty_base: 0, amount: 5_000 }], []);
    expect(out).toHaveLength(0);
  });
});

// Chủ quán chốt 2026-10-19: "Thịt bò" của hai NCC là hai dòng riêng trong công thức, mỗi dòng
// lấy giá lần nhập gần nhất của đúng NCC đó — không gộp, không bình quân chung.
describe('computeFoodCost — nguyên liệu tách theo NCC', () => {
  const PHO = { id: 'm2', name: 'Phở bò', price: 60_000 };
  const bo = { menu_item_id: 'm2', ingredient_id: 'bo', ingredient_name: 'Thịt bò', base_unit: 'g' };
  // Bình quân chung của "Thịt bò" (cách tính cũ) = 275đ/g.
  const avg = [{ ingredient_id: 'bo', unit_price_base: 275, source: 'avg' as const }];
  const supplierPrices = [
    { ingredient_id: 'bo', supplier_id: 'A', unit_price_base: 250 },
    { ingredient_id: 'bo', supplier_id: 'B', unit_price_base: 300 },
  ];

  it('dòng đã chọn NCC lấy giá của đúng NCC đó', () => {
    const [row] = computeFoodCost(
      [PHO],
      [{ ...bo, qty_per_serving: 100, supplier_id: 'B', supplier_name: 'Chợ Bến Thành' }],
      avg,
      supplierPrices,
    );
    expect(row.cost).toBe(30_000);
    expect(row.components[0].ingredient_name).toBe('Thịt bò · Chợ Bến Thành');
  });

  it('một món dùng cả hai NCC: hai dòng, mỗi dòng một giá', () => {
    const [row] = computeFoodCost(
      [PHO],
      [
        { ...bo, qty_per_serving: 100, supplier_id: 'A', supplier_name: 'NCC A' },
        { ...bo, qty_per_serving: 50, supplier_id: 'B', supplier_name: 'NCC B' },
      ],
      avg,
      supplierPrices,
    );
    // 100×250 + 50×300 = 25.000 + 15.000
    expect(row.cost).toBe(40_000);
    expect(row.components).toHaveLength(2);
  });

  it('dòng chưa chọn NCC giữ giá bình quân như cũ', () => {
    const [row] = computeFoodCost([PHO], [{ ...bo, qty_per_serving: 100, supplier_id: null }], avg, supplierPrices);
    expect(row.cost).toBe(27_500);
    expect(row.components[0].ingredient_name).toBe('Thịt bò');
  });

  it('NCC đã chọn chưa có giá thì rơi về giá chung, không báo thiếu giá', () => {
    const [row] = computeFoodCost(
      [PHO],
      [{ ...bo, qty_per_serving: 100, supplier_id: 'C', supplier_name: 'NCC C' }],
      avg,
      supplierPrices,
    );
    expect(row.cost).toBe(27_500);
    expect(row.complete).toBe(true);
  });
});

// Nguyên liệu chính / phụ + % phụ cộng vào giá vốn (2026-10-22).
describe('computeFoodCost — nguyên liệu phụ và % phụ', () => {
  // Hành lá 5g/bát, đánh dấu PHỤ: vẫn nằm trong công thức để trừ kho, nhưng tiền của nó đi vào
  // giá vốn qua % chung — cộng cả hai là tính hai lần.
  const withHanh = [
    ...recipe,
    { menu_item_id: 'm1', ingredient_id: 'hanh', ingredient_name: 'Hành lá', base_unit: 'g', qty_per_serving: 5, is_secondary: true },
  ];

  it('nguyên liệu phụ KHÔNG cộng vào giá vốn trực tiếp', () => {
    const [row] = computeFoodCost([BUN_CHA], withHanh, [...prices, { ingredient_id: 'hanh', unit_price_base: 40, source: 'avg' }]);
    expect(row.cost_main).toBe(24_600);
    expect(row.cost).toBe(24_600);
    const hanh = row.components.find((c) => c.ingredient_id === 'hanh')!;
    expect(hanh.is_secondary).toBe(true);
    expect(hanh.cost).toBe(200); // vẫn hiện để tham khảo
    expect(hanh.share_pct).toBeNull();
  });

  it('nguyên liệu phụ thiếu giá không làm giá vốn "chưa đầy đủ"', () => {
    const [row] = computeFoodCost([BUN_CHA], withHanh, prices);
    expect(row.complete).toBe(true);
    expect(row.missing).toEqual([]);
  });

  it('% phụ tính trên tiền nguyên liệu chính, và biên lãi theo giá vốn đầy đủ', () => {
    // 24.600 × 10% = 2.460 → đầy đủ 27.060; lãi 40.000 − 27.060 = 12.940.
    const [row] = computeFoodCost([BUN_CHA], withHanh, prices, [], 10);
    expect(row.cost_main).toBe(24_600);
    expect(row.overhead_amount).toBe(2_460);
    expect(row.cost).toBe(27_060);
    expect(row.margin_amount).toBe(12_940);
  });

  it('chưa đặt % (0) thì giá vốn y hệt trước khi có tính năng', () => {
    const [row] = computeFoodCost([BUN_CHA], recipe, prices, [], 0);
    expect(row.overhead_amount).toBe(0);
    expect(row.cost).toBe(row.cost_main);
  });

  it('% âm hoặc rác bị coi như 0', () => {
    const [row] = computeFoodCost([BUN_CHA], recipe, prices, [], Number.NaN);
    expect(row.cost).toBe(24_600);
    const [neg] = computeFoodCost([BUN_CHA], recipe, prices, [], -5);
    expect(neg.cost).toBe(24_600);
  });
});

describe('computeFoodCost — hàng bán nguyên (2026-10-28)', () => {
  const BIA = { id: 'm2', name: 'Bia Tiger lon', price: 20_000 };
  const COMBO = { id: 'm3', name: 'Rượu dừa + lạc', price: 150_000 };
  const lines = [
    { menu_item_id: 'm2', ingredient_id: 'bia', ingredient_name: 'Bia Tiger', base_unit: 'lon', qty_per_serving: 1, is_resale: true },
    { menu_item_id: 'm3', ingredient_id: 'ruou', ingredient_name: 'Rượu dừa', base_unit: 'quả', qty_per_serving: 1, is_resale: true },
    { menu_item_id: 'm3', ingredient_id: 'lac', ingredient_name: 'Lạc', base_unit: 'g', qty_per_serving: 100 },
  ];
  const giá = [
    { ingredient_id: 'bia', unit_price_base: 13_800, source: 'avg' as const },
    { ingredient_id: 'ruou', unit_price_base: 35_000, source: 'avg' as const },
    { ingredient_id: 'lac', unit_price_base: 400, source: 'avg' as const },
  ];

  it('món chỉ toàn hàng bán nguyên: giá vốn = giá nhập, KHÔNG cộng % phụ', () => {
    const [row] = computeFoodCost([BIA], lines, giá, [], 10);
    expect(row.cost_main).toBe(0);
    expect(row.cost_resale).toBe(13_800);
    expect(row.overhead_amount).toBe(0);
    expect(row.cost).toBe(13_800);
  });

  it('món trộn: % phụ chỉ nhân trên phần nguyên liệu chính', () => {
    // Lạc 100g × 400 = 40.000 chính; rượu 35.000 bán nguyên; 10% × 40.000 = 4.000.
    const [row] = computeFoodCost([COMBO], lines, giá, [], 10);
    expect(row.cost_main).toBe(40_000);
    expect(row.cost_resale).toBe(35_000);
    expect(row.overhead_amount).toBe(4_000);
    expect(row.cost).toBe(79_000);
  });

  it('hàng bán nguyên thiếu giá thì giá vốn CHƯA đầy đủ (tiền nó cộng thẳng vào)', () => {
    const [row] = computeFoodCost([BIA], lines, [], [], 0);
    expect(row.complete).toBe(false);
    expect(row.missing).toEqual(['Bia Tiger']);
  });

  it('dòng lỡ mang cả hai cờ thì coi là PHỤ — không cộng hai lần', () => {
    const both = [{ ...lines[0], is_secondary: true }];
    const [row] = computeFoodCost([BIA], both, giá, [], 0);
    expect(row.cost).toBe(0);
    expect(row.components[0].is_resale).toBe(false);
  });
});

describe('overheadReferencePct', () => {
  it('= tiền phụ ÷ tiền chính', () => {
    expect(
      overheadReferencePct([
        { amount: 1_000_000, is_secondary: false },
        { amount: 74_000, is_secondary: true },
      ]),
    ).toBe(7.4);
  });

  it('hàng bán nguyên KHÔNG nằm trong mẫu số', () => {
    // 74k phụ ÷ 1tr chính = 7,4% — 500k bia không được kéo con số xuống 4,9%.
    expect(
      overheadReferencePct([
        { amount: 1_000_000, is_secondary: false },
        { amount: 500_000, is_secondary: false, is_resale: true },
        { amount: 74_000, is_secondary: true },
      ]),
    ).toBe(7.4);
  });

  it('kỳ chưa mua nguyên liệu chính thì không có số', () => {
    expect(overheadReferencePct([{ amount: 50_000, is_secondary: true }])).toBeNull();
    expect(overheadReferencePct([])).toBeNull();
  });
});

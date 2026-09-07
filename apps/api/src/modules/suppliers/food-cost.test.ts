// Test THUẦN, không cần MySQL.
import { describe, expect, it } from 'vitest';
import { computeFoodCost, ingredientPrices } from './food-cost.js';

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

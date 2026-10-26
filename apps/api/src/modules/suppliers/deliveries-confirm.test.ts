// Duyệt phiếu chờ phải hỏi giá (chủ quán chốt 2026-10-26).
//
// Trước đó nút Duyệt duyệt thẳng: phiếu nháp của role Báo cáo và phiếu NCC tự gửi không có popup
// đổi giá lúc lập, nên giá tăng/giảm vào sổ mà không ai thấy. Hai hàm dưới đây quyết định dòng
// nào phải hỏi — sai một nhánh là popup im lặng đúng lúc cần nói.
import { describe, expect, it } from 'vitest';
import { chuaDongYGia, dongThanhInput, type PriceChange } from './deliveries.service.js';

const doi = (ingredient_id: string, level: PriceChange['level']): PriceChange => ({
  ingredient_id,
  ingredient_name: ingredient_id,
  base_unit: 'g',
  purchase_unit: 'KG',
  prev_unit_price: 100_000,
  unit_price: 120_000,
  prev_unit_price_base: '100',
  unit_price_base: '120',
  price_change_pct: '20',
  level,
  pack_size_changed: false,
  prev_qty_base_per_unit: '1000',
  qty_base_per_unit: '1000',
});

describe('chuaDongYGia', () => {
  it('chưa bấm đồng ý gì thì trả mọi dòng vượt ngưỡng, bỏ dòng bình thường', () => {
    const r = chuaDongYGia([doi('thit', 'warn'), doi('rau', 'none'), doi('ca', 'strict')]);
    expect(r.map((c) => c.ingredient_id)).toEqual(['thit', 'ca']);
  });

  it('dòng đã đồng ý thì không hỏi lại', () => {
    const r = chuaDongYGia([doi('thit', 'warn'), doi('ca', 'strict')], ['thit']);
    expect(r.map((c) => c.ingredient_id)).toEqual(['ca']);
  });

  it('đồng ý đủ thì rỗng — nhịp hai được duyệt', () => {
    expect(chuaDongYGia([doi('thit', 'warn'), doi('ca', 'strict')], ['thit', 'ca'])).toEqual([]);
  });

  it('không có dòng lệch thì nhịp một duyệt luôn', () => {
    expect(chuaDongYGia([doi('rau', 'none')])).toEqual([]);
  });
});

describe('dongThanhInput', () => {
  it('đổi chuỗi decimal của mysql2 về số, giữ đơn vị mua đã lưu', () => {
    expect(
      dongThanhInput({
        ingredient_id: 'ing-1',
        purchase_unit_snapshot: 'THÙNG',
        qty_base_per_unit_snapshot: '24.000',
        qty_purchase: '2.500',
        unit_price: 180_000,
      }),
    ).toEqual({
      ingredient_id: 'ing-1',
      purchase_unit: 'THÙNG',
      qty_base_per_unit: 24,
      qty_purchase: 2.5,
      unit_price: 180_000,
    });
  });
});

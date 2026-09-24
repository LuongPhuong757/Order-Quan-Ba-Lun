// Giá vốn công thức — đây là phép tính TIỀN, nên mỗi ca dưới đây đều tương ứng một cách con số
// có thể sai mà không có lỗi nào nổ ra.
import { describe, it, expect } from 'vitest';
import { servingsPerPurchaseUnit, lineCost, summarizeCost } from './recipe-cost.ts';

const tomSu = {
  cost_unit_price_base: 250, // 250đ/g = 250.000đ/kg
  cost_purchase_unit: 'kg',
  cost_qty_base_per_unit: 1000,
  cost_as_of: '2026-09-18',
};

describe('servingsPerPurchaseUnit', () => {
  it('1 kg tôm, công thức 250 g/phần → 4 phần', () => {
    expect(servingsPerPurchaseUnit(1000, 250)).toBe(4);
  });

  it('ra số lẻ thì giữ nguyên, không làm tròn ở tầng tính', () => {
    // 1000 / 150 = 6,67. Làm tròn là việc của chỗ hiển thị; làm tròn sớm ở đây thì hai màn hiện
    // hai con số khác nhau cho cùng một công thức.
    expect(servingsPerPurchaseUnit(1000, 150)).toBeCloseTo(6.667, 3);
  });

  it('đơn vị đếm: 1 con gà, công thức 0,5 con/phần → 2 phần', () => {
    expect(servingsPerPurchaseUnit(1, 0.5)).toBe(2);
  });

  it('chưa có giá nhập (hệ số null) → null', () => {
    expect(servingsPerPurchaseUnit(null, 250)).toBeNull();
  });

  it('định lượng 0 → null, KHÔNG phải Infinity', () => {
    // Để lọt Infinity thì màn hình hiện "1 kg ≈ ∞ phần".
    expect(servingsPerPurchaseUnit(1000, 0)).toBeNull();
  });

  it('số âm → null', () => {
    expect(servingsPerPurchaseUnit(1000, -250)).toBeNull();
    expect(servingsPerPurchaseUnit(-1000, 250)).toBeNull();
  });
});

describe('lineCost', () => {
  it('250 g tôm × 250đ/g = 62.500đ', () => {
    expect(lineCost(tomSu, 250)).toBe(62_500);
  });

  it('nguyên liệu chưa từng nhập → null chứ không phải 0', () => {
    // 0 đọc lên là "dòng này không tốn tiền" — sai hẳn nghĩa so với "chưa biết giá".
    expect(
      lineCost({ cost_unit_price_base: null, cost_purchase_unit: null, cost_qty_base_per_unit: null }, 250),
    ).toBeNull();
  });

  it('nguyên liệu không có trong danh mục (đã bị đánh dấu gia vị) → null', () => {
    expect(lineCost(undefined, 250)).toBeNull();
  });
});

describe('summarizeCost', () => {
  it('cộng các dòng có giá, đếm riêng dòng thiếu giá', () => {
    const got = summarizeCost([
      { qty_per_serving: 250, cost: tomSu }, // 62.500
      { qty_per_serving: 100, cost: { ...tomSu, cost_unit_price_base: 62, cost_as_of: '2026-09-16' } }, // 6.200
      { qty_per_serving: 2, cost: undefined }, // thiếu giá
    ]);
    expect(got.total).toBe(68_700);
    expect(got.missing).toBe(1);
  });

  it('asOf lấy ngày MỚI NHẤT trong các nguồn giá đã dùng', () => {
    const got = summarizeCost([
      { qty_per_serving: 1, cost: { ...tomSu, cost_as_of: '2026-09-16' } },
      { qty_per_serving: 1, cost: { ...tomSu, cost_as_of: '2026-10-01' } },
      { qty_per_serving: 1, cost: { ...tomSu, cost_as_of: '2026-09-30' } },
    ]);
    // Chốt luôn định dạng: so chuỗi chỉ ra đúng thứ tự khi mọi ngày đủ 10 ký tự 'YYYY-MM-DD'.
    // Nếu ai đó để lọt '2026-9-5' thì nó sẽ lớn hơn '2026-10-01' và mốc thời gian hiện ra sai.
    expect(got.asOf).toBe('2026-10-01');
  });

  it('dòng thiếu giá KHÔNG kéo asOf về null', () => {
    const got = summarizeCost([
      { qty_per_serving: 250, cost: tomSu },
      { qty_per_serving: 2, cost: undefined },
    ]);
    expect(got.asOf).toBe('2026-09-18');
    expect(got.total).toBe(62_500);
  });

  it('không dòng nào có giá → total 0, asOf null, missing đếm đủ', () => {
    // Màn hình dựa vào `total > 0` để quyết định có hiện thanh giá vốn hay không — ca này phải
    // cho ra đúng 0 để thanh đó ẩn đi thay vì hiện "0đ".
    const got = summarizeCost([
      { qty_per_serving: 250, cost: undefined },
      { qty_per_serving: 100, cost: undefined },
    ]);
    expect(got).toEqual({ total: 0, missing: 2, asOf: null });
  });
});

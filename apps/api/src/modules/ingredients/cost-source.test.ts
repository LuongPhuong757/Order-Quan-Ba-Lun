// Chọn nguồn giá vốn (M6.D-07) — lần nhập GẦN NHẤT, không phải nơi rẻ nhất.
//
// Cái bẫy mà bộ test này canh: `loadSuppliers` trả mảng đã xếp RẺ NHẤT TRƯỚC (để màn hình gợi ý
// chỗ mua), nên lấy `suppliers[0]` làm giá vốn là trông vẫn chạy với dữ liệu thật — chỉ sai khi
// nơi rẻ nhất không phải nơi mua gần nhất. Đúng loại sai không có lỗi nào nổ ra.
import { describe, it, expect } from 'vitest';
import { pickCostSource, type IngredientSupplierInfo } from './ingredients.service.js';

function sup(name: string, price_base: number, date: string): IngredientSupplierInfo {
  return {
    supplier_id: `id-${name}`,
    supplier_name: name,
    purchase_unit: 'kg',
    qty_base_per_unit: 1000,
    last_unit_price: price_base * 1000,
    last_unit_price_base: price_base,
    last_delivery_date: date,
  };
}

describe('pickCostSource', () => {
  it('chưa từng nhập → null, KHÔNG phải 0đ', () => {
    // Màn hình phải ẩn số đi. Trả 0 thì giá vốn món hiện "0đ" và trông như món không tốn gì.
    expect(pickCostSource([])).toBeNull();
  });

  it('một nơi bán → lấy chính nơi đó', () => {
    const got = pickCostSource([sup('Ba Lún', 250, '2026-09-18')]);
    expect(got?.supplier_name).toBe('Ba Lún');
    expect(got?.last_unit_price_base).toBe(250);
  });

  it('lấy lần nhập GẦN NHẤT chứ không phải nơi rẻ nhất', () => {
    // Dữ liệu thật trên dev: tôm sú Ba Lún 250.000đ/kg ngày 18/09, Cô Tám 262.000đ/kg ngày 16/09.
    // Ở đây đảo lại để nơi rẻ nhất là nơi mua CŨ hơn — lấy nhầm phần tử đầu mảng là lộ ra ngay.
    const got = pickCostSource([
      sup('Đà Lạt Xanh', 11_000, '2026-09-15'), // rẻ nhất, đứng đầu mảng
      sup('Chị Hằng', 12_500, '2026-09-17'), // mua gần nhất
    ]);
    expect(got?.supplier_name).toBe('Chị Hằng');
    expect(got?.last_unit_price_base).toBe(12_500);
  });

  it('nơi mua gần nhất tình cờ cũng là nơi rẻ nhất', () => {
    const got = pickCostSource([
      sup('Ba Lún', 250, '2026-09-18'),
      sup('Cô Tám', 262, '2026-09-16'),
    ]);
    expect(got?.supplier_name).toBe('Ba Lún');
  });

  it('hoà ngày → lấy dòng đứng trước, tức là nơi rẻ hơn', () => {
    // Mảng vào đã xếp rẻ-trước, nên hoà ngày cho ra giá vốn thấp hơn. Chọn phía này vì phần trăm
    // lãi hiện ra sẽ thấp hơn thực tế, không ru ngủ người đọc.
    const got = pickCostSource([
      sup('Rẻ', 100, '2026-09-20'),
      sup('Đắt', 130, '2026-09-20'),
    ]);
    expect(got?.supplier_name).toBe('Rẻ');
  });

  it('so ngày theo THỜI GIAN, không theo độ dài chuỗi', () => {
    // 'YYYY-MM-DD' so chuỗi ra đúng thứ tự thời gian, nhưng chỉ khi mọi ngày đều đủ 10 ký tự.
    // Test này chốt định dạng đó: `loadSuppliers` cắt `.slice(0, 10)` cho cả hai kiểu driver trả
    // về (Date và string), nếu ai đó bỏ bước chuẩn hoá thì '2026-9-5' sẽ lớn hơn '2026-10-01'.
    const got = pickCostSource([
      sup('Tháng 9', 100, '2026-09-30'),
      sup('Tháng 10', 200, '2026-10-01'),
    ]);
    expect(got?.supplier_name).toBe('Tháng 10');
  });
});

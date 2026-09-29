// Ràng buộc chủ quán chốt 2026-09-29: nguyên liệu BẮT BUỘC thuộc một nhà cung cấp, và phải có
// đơn vị mua + giá tiền.
//
// Trước thay đổi này, khai công thức mà gõ một cái tên chưa có là BE lặng lẽ tạo một `Ingredient`
// trần — không NCC, không đơn vị mua, không giá. Nguyên liệu kiểu đó không bao giờ tính được ra
// tiền, nên món chứa nó luôn thiếu giá vốn mà không ai biết vì sao. Đó là đường DUY NHẤT sinh ra
// nguyên liệu mồ côi, và test này canh đúng chỗ đó.
//
// Test thuần trên logic quyết định, không đụng DB: phần ghi đã có test tích hợp riêng.
import { describe, it, expect } from 'vitest';
import { requireSupplierForNew, type NewIngredientInput } from './recipe-supplier-rule.js';

const ok: NewIngredientInput = { supplier_id: 'sup-1', purchase_unit: 'kg', unit_price: 80000 };

describe('nguyên liệu mới bắt buộc có nhà cung cấp', () => {
  it('nguyên liệu ĐÃ CÓ trong danh mục thì không đòi gì thêm', () => {
    expect(requireSupplierForNew(false, undefined)).toBeNull();
  });

  it('nguyên liệu MỚI mà không khai gì thì bị từ chối', () => {
    const err = requireSupplierForNew(true, undefined);
    expect(err?.code).toBe('SUPPLIER_REQUIRED');
  });

  it('thiếu nhà cung cấp thì bị từ chối', () => {
    expect(requireSupplierForNew(true, { ...ok, supplier_id: '' })?.code).toBe('SUPPLIER_REQUIRED');
  });

  it('thiếu đơn vị mua thì bị từ chối', () => {
    expect(requireSupplierForNew(true, { ...ok, purchase_unit: '  ' })?.code).toBe('PURCHASE_UNIT_REQUIRED');
  });

  it('giá 0 hoặc âm bị từ chối — giá vốn 0 làm món trông như lãi 100%', () => {
    expect(requireSupplierForNew(true, { ...ok, unit_price: 0 })?.code).toBe('PRICE_REQUIRED');
    expect(requireSupplierForNew(true, { ...ok, unit_price: -5 })?.code).toBe('PRICE_REQUIRED');
  });

  it('khai đủ ba thứ thì cho qua', () => {
    expect(requireSupplierForNew(true, ok)).toBeNull();
  });

  it('giá lẻ theo đồng vẫn hợp lệ — có nguyên liệu bán theo gram giá vài chục đồng', () => {
    expect(requireSupplierForNew(true, { ...ok, unit_price: 45 })).toBeNull();
  });
});

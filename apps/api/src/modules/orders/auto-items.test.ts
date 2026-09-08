import { describe, expect, it } from 'vitest';
import { khongDau, pickAutoItem } from './auto-items.js';

const menu = [
  { id: 'm1', name: 'Ba Chỉ Cháy Cạnh' },
  { id: 'm2', name: 'KHĂN ƯỚT' },
  { id: 'm3', name: 'Khăn ướt lạnh cao cấp' },
];

describe('khongDau', () => {
  it('bỏ dấu và hạ chữ thường', () => {
    expect(khongDau('KHĂN ƯỚT')).toBe('khan uot');
    expect(khongDau('Khăn  Ướt ')).toBe('khan uot');
  });
  it('đổi đ/Đ thành d — chữ này NFD không tách ra được', () => {
    expect(khongDau('Đá viên')).toBe('da vien');
  });
});

describe('pickAutoItem', () => {
  it('bàn ăn tại chỗ → thêm khăn ướt 5 phần', () => {
    expect(pickAutoItem('dine-in', menu)).toEqual({ menu_item_id: 'm2', qty: 5 });
  });

  it.each([['takeaway'], ['delivery']])(
    'bàn %s → KHÔNG thêm gì (thêm là thu thừa tiền của khách)',
    (kind) => {
      expect(pickAutoItem(kind, menu)).toBeNull();
    },
  );

  it('nhiều món cùng trúng → lấy tên NGẮN NHẤT, không lấy biến thể đắt hơn', () => {
    const r = pickAutoItem('dine-in', [
      { id: 'x', name: 'Khăn ướt lạnh cao cấp' },
      { id: 'y', name: 'Khăn ướt' },
    ]);
    expect(r?.menu_item_id).toBe('y');
  });

  it('menu KHÔNG có khăn ướt → null, mở bàn vẫn phải chạy được', () => {
    expect(pickAutoItem('dine-in', [{ id: 'm1', name: 'Ba Chỉ Cháy Cạnh' }])).toBeNull();
  });

  it('món đã tắt (is_active=false) thì không dùng', () => {
    expect(pickAutoItem('dine-in', [{ id: 'z', name: 'Khăn ướt', is_active: false }])).toBeNull();
  });
});

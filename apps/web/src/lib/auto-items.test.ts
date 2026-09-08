import { describe, expect, it } from 'vitest';
import { khongDau, pickAutoItem } from './auto-items.ts';

/** Bảng giá THẬT của quán, đọc từ DB 2026-09-08 — không có "khăn ướt", chỉ có "Khăn Lạnh". */
const menuThat = [
  { id: 'sp1137', name: 'Khăn Lạnh' },
  { id: 'sp1141', name: 'Khăn Lạnh 5 Cái' },
  { id: 'sp0682', name: 'Khấu Đuôi Chiên Móc Mật' },
];

describe('khongDau', () => {
  it('bỏ dấu và hạ chữ thường', () => {
    expect(khongDau('KHĂN LẠNH')).toBe('khan lanh');
    expect(khongDau('Khăn  Lạnh ')).toBe('khan lanh');
  });
  it('đổi đ/Đ thành d — chữ này NFD không tách ra được', () => {
    expect(khongDau('Đá viên')).toBe('da vien');
  });
});

describe('pickAutoItem', () => {
  it('bàn tại chỗ MỚI TINH → gợi Khăn Lạnh 5 phần', () => {
    expect(pickAutoItem('dine-in', true, menuThat)).toEqual({ item: menuThat[0], qty: 5 });
  });

  it('bàn ĐANG ĂN DỞ → không gợi gì; mỗi lần mở giỏ lại nhét 5 khăn là sẽ trôi vào bill', () => {
    expect(pickAutoItem('dine-in', false, menuThat)).toBeNull();
  });

  it.each([['takeaway'], ['delivery']])('bàn %s → không gợi (thu thừa tiền của khách)', (kind) => {
    expect(pickAutoItem(kind, true, menuThat)).toBeNull();
  });

  it('KHÔNG chọn gói "Khăn Lạnh 5 Cái" — nhân 5 lần nữa là tính tiền 25 chiếc', () => {
    expect(pickAutoItem('dine-in', true, menuThat)?.item.id).not.toBe('sp1141');
  });

  it('có cả hai tên thì "khăn ướt" được ưu tiên trước "khăn lạnh"', () => {
    const r = pickAutoItem('dine-in', true, [
      { id: 'a', name: 'Khăn Lạnh' },
      { id: 'b', name: 'Khăn ướt' },
    ]);
    expect(r?.item.id).toBe('b');
  });

  it('món đang HẾT thì bỏ qua — gợi sẵn món không bán được chỉ tổ ăn lỗi lúc báo bếp', () => {
    const r = pickAutoItem('dine-in', true, [{ id: 'x', name: 'Khăn Lạnh', is_out_of_stock: true }]);
    expect(r).toBeNull();
  });

  it('menu không có khăn nào → null, màn gọi món vẫn phải mở được', () => {
    expect(pickAutoItem('dine-in', true, [{ id: 'm1', name: 'Ba Chỉ Cháy Cạnh' }])).toBeNull();
  });
});

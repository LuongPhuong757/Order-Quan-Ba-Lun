import { describe, expect, it } from 'vitest';
import { filterOrdersBySearch, orderMatchesSearch } from './online-order-search.ts';

const row = (name: string, phone: string, items: string[]) => ({
  customer_name: name,
  customer_phone: phone,
  items: items.map((n) => ({ name: n })),
});

const ORDERS = [
  row('Nguyễn Thị Lan', '0912345678', ['Khoai tây lắc', 'Trà đào cam sả']),
  row('Trần Văn Đức', '0987 654 321', ['Cà phê sữa đá']),
  row('Lê Hoàng', '0333222111', ['Cánh giữa chiên giòn', 'Khoai tây chiên']),
];

const names = (q: string) => filterOrdersBySearch(ORDERS, q).map((r) => r.customer_name);

describe('tìm theo tên khách', () => {
  it('gõ có dấu', () => {
    expect(names('Lan')).toEqual(['Nguyễn Thị Lan']);
  });

  it('gõ không dấu vẫn khớp', () => {
    expect(names('nguyen thi')).toEqual(['Nguyễn Thị Lan']);
    expect(names('duc')).toEqual(['Trần Văn Đức']); // 'đ' → 'd'
  });
});

describe('tìm theo SĐT', () => {
  it('khớp đoạn giữa số', () => {
    expect(names('2345')).toEqual(['Nguyễn Thị Lan']);
  });

  it('SĐT lưu có khoảng trắng vẫn tìm được liền mạch', () => {
    expect(names('654321')).toEqual(['Trần Văn Đức']);
  });

  it('token số không khớp SĐT nào → loại', () => {
    expect(names('9999')).toEqual([]);
  });
});

describe('tìm theo món trong đơn', () => {
  it('tên món không dấu', () => {
    expect(names('khoai tay')).toEqual(['Nguyễn Thị Lan', 'Lê Hoàng']);
  });

  it('AND giữa token: tên khách + món', () => {
    expect(names('lan khoai')).toEqual(['Nguyễn Thị Lan']);
    expect(names('hoang khoai')).toEqual(['Lê Hoàng']);
  });
});

describe('biên', () => {
  it('query rỗng / toàn khoảng trắng → giữ nguyên mảng gốc (cùng reference)', () => {
    expect(filterOrdersBySearch(ORDERS, '')).toBe(ORDERS);
    expect(filterOrdersBySearch(ORDERS, '   ')).toBe(ORDERS);
  });

  it('không xáo trộn thứ tự khi nhiều đơn cùng khớp', () => {
    expect(names('0')).toEqual(ORDERS.map((r) => r.customer_name)); // mọi SĐT đều chứa 0
  });

  it('orderMatchesSearch với query rỗng luôn true', () => {
    expect(orderMatchesSearch(ORDERS[0], '')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { PublicMenuGroup } from '@order/schemas';
import { buildReorderLines, reorderNotice } from './reorder.ts';

// "Đặt lại" (2026-08-06). Mỗi block bám một ranh giới ghi ở docblock reorder.ts: giá LIVE chứ
// không phải giá đơn cũ, món hết hàng KHÔNG vào giỏ, và không có gì bị bỏ đi trong im lặng.

const MENU: PublicMenuGroup[] = [
  {
    id: 'g1',
    code: 'LAU',
    name: 'Lẩu',
    icon: null,
    items: [
      {
        id: 'mi-lau-bo',
        code: 'L01',
        name: 'Lẩu bò (đổi tên mới)',
        price: 180_000, // giá HÔM NAY, đơn cũ mua 150.000
        unit: 'nồi',
        images: ['/uploads/lau.webp'],
        is_out_of_stock: false,
      },
      {
        id: 'mi-tra-da',
        code: 'T01',
        name: 'Trà đá',
        price: 5_000,
        unit: 'ly',
        images: [],
        is_out_of_stock: true,
      },
    ],
  },
];

describe('buildReorderLines — giá/tên/ảnh lấy từ menu HIỆN HÀNH', () => {
  it('không dùng lại giá của đơn cũ, và giữ ghi chú từng món', () => {
    const result = buildReorderLines(
      [{ menu_item_id: 'mi-lau-bo', name: 'Lẩu bò', qty: 2, note: 'ít cay' }],
      MENU,
    );
    expect(result.lines).toEqual([
      {
        menu_item_id: 'mi-lau-bo',
        code: 'L01',
        name: 'Lẩu bò (đổi tên mới)',
        unit_price: 180_000,
        qty: 2,
        note: 'ít cay',
        image: '/uploads/lau.webp',
      },
    ]);
    expect(result.outOfStock).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

describe('buildReorderLines — món không thêm được thì phải nói ra', () => {
  it('món hết hàng KHÔNG vào giỏ (không tạo dòng unavailable) nhưng được liệt kê', () => {
    const result = buildReorderLines(
      [
        { menu_item_id: 'mi-lau-bo', name: 'Lẩu bò', qty: 1 },
        { menu_item_id: 'mi-tra-da', name: 'Trà đá', qty: 3 },
      ],
      MENU,
    );
    expect(result.lines.map((l) => l.menu_item_id)).toEqual(['mi-lau-bo']);
    expect(result.outOfStock).toEqual(['Trà đá']);
  });

  it('món đã bị xoá khỏi menu và món thêm tay (id null) vào nhóm "không còn bán"', () => {
    const result = buildReorderLines(
      [
        { menu_item_id: 'mi-da-xoa', name: 'Món cũ', qty: 1 },
        { menu_item_id: null, name: 'Thêm bát', qty: 1 },
      ],
      MENU,
    );
    expect(result.lines).toEqual([]);
    expect(result.missing).toEqual(['Món cũ', 'Thêm bát']);
  });

  it('menu rỗng (chưa tải xong / lỗi mạng) không sinh dòng nào — thà không đặt lại còn hơn đặt sai', () => {
    const result = buildReorderLines([{ menu_item_id: 'mi-lau-bo', name: 'Lẩu bò', qty: 1 }], []);
    expect(result.lines).toEqual([]);
    expect(result.missing).toEqual(['Lẩu bò']);
  });
});

describe('reorderNotice', () => {
  it('mọi món vào giỏ trọn vẹn → không có câu nào (im lặng là đúng)', () => {
    expect(reorderNotice({ lines: [], outOfStock: [], missing: [] })).toBeNull();
  });

  it('gộp cả 2 nhóm vào một câu', () => {
    const notice = reorderNotice({ lines: [], outOfStock: ['Trà đá'], missing: ['Món cũ'] });
    expect(notice).toContain('Trà đá');
    expect(notice).toContain('Món cũ');
  });
});

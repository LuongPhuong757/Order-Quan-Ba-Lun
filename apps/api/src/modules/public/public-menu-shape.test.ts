import { describe, expect, it } from 'vitest';
import { PublicMenuItem } from '@order/schemas';
import { toPublicMenuItem, toPublicMenuGroup } from './public-menu.mapper.js';
import type { MenuItem } from '../menu/entities/menu-item.entity.js';
import type { MenuGroup } from '../menu/entities/menu-group.entity.js';

// T-08-33 / M2.D-43 (success criterion 5 của phase 8) — khoá hình dạng response công khai
// của GET /api/public/menu: ĐÚNG 7 field mỗi món, không leak field nội bộ nào.

// Entity giả — cố ý thêm field nội bộ (unit_cost không có thật trong entity nhưng mô phỏng
// trường hợp ai đó thêm cột mới; created_at, is_active, group đã có thật trong entity) để
// chứng minh mapper không spread.
function fakeMenuItem(overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'LAU-BO',
    name: 'Lẩu bò',
    group: 'food',
    price: 150000,
    unit: 'phần',
    image_url: '/uploads/menu/x.webp',
    is_out_of_stock: false,
    is_active: true,
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  } as MenuItem;
}

function fakeMenuGroup(overrides: Partial<MenuGroup> = {}): MenuGroup {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    code: 'food',
    name: 'Món chính',
    icon: '🍜',
    kitchen_type: 'cook',
    sort_order: 0,
    is_active: true,
    created_at: 1700000000000,
    ...overrides,
  } as MenuGroup;
}

describe('toPublicMenuItem — chỉ đúng 7 field', () => {
  it('output có đúng 7 key, không hơn không kém', () => {
    const result = toPublicMenuItem(fakeMenuItem());
    expect(Object.keys(result).sort()).toEqual(
      ['code', 'id', 'images', 'is_out_of_stock', 'name', 'price', 'unit'].sort(),
    );
  });

  it('image_url có giá trị → images = [image_url] (D-09)', () => {
    const result = toPublicMenuItem(fakeMenuItem({ image_url: '/uploads/menu/x.webp' }));
    expect(result.images).toEqual(['/uploads/menu/x.webp']);
  });

  it('image_url null → images = [] (mảng rỗng, không phải null) (D-09)', () => {
    const result = toPublicMenuItem(fakeMenuItem({ image_url: null }));
    expect(result.images).toEqual([]);
  });

  it('field nội bộ (created_at, is_active, group) không xuất hiện trong output', () => {
    const result = toPublicMenuItem(fakeMenuItem()) as Record<string, unknown>;
    expect(result.created_at).toBeUndefined();
    expect(result.is_active).toBeUndefined();
    expect(result.group).toBeUndefined();
    expect(result.updated_at).toBeUndefined();
  });

  it('PublicMenuItem.strict().parse(mapperOutput) không throw', () => {
    const result = toPublicMenuItem(fakeMenuItem());
    expect(() => PublicMenuItem.strict().parse(result)).not.toThrow();
  });

  it('PublicMenuItem.strict().parse với field lạ (created_at) THROW — lớp assert bắt được leak nếu mapper bị sửa thành spread', () => {
    const result = toPublicMenuItem(fakeMenuItem());
    expect(() => PublicMenuItem.strict().parse({ ...result, created_at: 123 })).toThrow();
  });

  it('món hết hàng (is_out_of_stock: true) VẪN có trong output — BE không ẩn (M2.D-31)', () => {
    const result = toPublicMenuItem(fakeMenuItem({ is_out_of_stock: true }));
    expect(result.is_out_of_stock).toBe(true);
  });
});

describe('toPublicMenuGroup — chỉ đúng 5 field', () => {
  it('output có đúng 5 key, không hơn không kém', () => {
    const item = toPublicMenuItem(fakeMenuItem());
    const result = toPublicMenuGroup(fakeMenuGroup(), [item]);
    expect(Object.keys(result).sort()).toEqual(['code', 'icon', 'id', 'items', 'name'].sort());
  });

  it('field nội bộ (kitchen_type, sort_order, is_active) không xuất hiện trong output', () => {
    const item = toPublicMenuItem(fakeMenuItem());
    const result = toPublicMenuGroup(fakeMenuGroup(), [item]) as Record<string, unknown>;
    expect(result.kitchen_type).toBeUndefined();
    expect(result.sort_order).toBeUndefined();
    expect(result.is_active).toBeUndefined();
  });
});

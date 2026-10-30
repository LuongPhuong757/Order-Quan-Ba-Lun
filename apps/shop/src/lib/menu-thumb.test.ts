import { describe, expect, it } from 'vitest';
import { menuThumbUrl } from './menu-thumb.ts';

describe('menuThumbUrl', () => {
  it('ảnh món ở /uploads/menu → cùng tên file trong thư mục thumb', () => {
    expect(menuThumbUrl('/uploads/menu/1730000000000-abc123.webp')).toBe(
      '/uploads/menu/thumb/1730000000000-abc123.webp',
    );
  });

  it('URL không phải ảnh món giữ nguyên', () => {
    expect(menuThumbUrl('https://example.com/a.webp')).toBe('https://example.com/a.webp');
    expect(menuThumbUrl('/uploads/deliveries/a.webp')).toBe('/uploads/deliveries/a.webp');
    expect(menuThumbUrl('/logo.jpg')).toBe('/logo.jpg');
  });

  it('URL đã là thumbnail không bị lồng thêm thumb/', () => {
    expect(menuThumbUrl('/uploads/menu/thumb/a.webp')).toBe('/uploads/menu/thumb/a.webp');
  });
});

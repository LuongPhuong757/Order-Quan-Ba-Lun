import { describe, expect, it } from 'vitest';
import { buildMapsUrl } from './maps-link.ts';

// Bộ test `parseMapsLink` (16 ca) đã xoá cùng lúc gỡ ô dán link Google Maps (2026-08-11) — xem
// `maps-link.ts`. Giữ lại test cho một hàm không còn ai gọi là dựng một hàng rào quanh chỗ trống:
// nó vẫn xanh mãi mãi và không nói được điều gì về trang khách.

// ── buildMapsUrl (2026-08-05) — đường để khách TỰ KIỂM TRA vị trí vừa chia sẻ ──
describe('buildMapsUrl', () => {
  it('dựng link Maps URLs API từ toạ độ số', () => {
    expect(buildMapsUrl(10.762622, 106.660172)).toBe(
      'https://www.google.com/maps/search/?api=1&query=10.762622,106.660172',
    );
  });

  it('toạ độ âm giữ nguyên dấu', () => {
    expect(buildMapsUrl(-33.86, 151.2)).toBe('https://www.google.com/maps/search/?api=1&query=-33.86,151.2');
  });

  it('link mở ra ĐÚNG cặp toạ độ sắp gửi cho quán, không làm tròn', () => {
    expect(buildMapsUrl(21.028511, 105.804817)).toContain('query=21.028511,105.804817');
  });
});

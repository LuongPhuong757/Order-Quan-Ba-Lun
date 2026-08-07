import { describe, expect, it } from 'vitest';
import { PublicTopDish } from '@order/schemas';
import { normalizeWindow, toPublicTopDish, windowStartMs } from './public-top-dishes.mapper.js';

// Khoá hình dạng response công khai của GET /api/public/top-dishes — cùng vai trò với
// `public-menu-shape.test.ts` (T-08-33): field nội bộ lọt thêm vào row là test đỏ ngay.

const ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Lẩu bò',
  unit: 'phần',
  price: '150000', // cột số qua getRawMany() có thể là string
  image_url: '/uploads/menu/x.webp',
  qty: '42', // SQL SUM() trả string
  is_out_of_stock: 0, // MySQL trả boolean là 0/1
};

describe('toPublicTopDish — đúng 7 field, không hơn', () => {
  it('output có đúng 7 key', () => {
    const result = toPublicTopDish(ROW);
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'images', 'is_out_of_stock', 'name', 'price', 'qty', 'unit'].sort(),
    );
  });

  // Cờ hết hàng quyết định nút "+" trên bảng xếp hạng có bấm được không — ép sai kiểu ở đây là
  // mời khách đặt món quán không làm được (hoặc khoá nút của món còn hàng).
  it('is_out_of_stock: 0/1 và "0"/"1" của driver đều ra boolean đúng', () => {
    expect(toPublicTopDish(ROW).is_out_of_stock).toBe(false);
    expect(toPublicTopDish({ ...ROW, is_out_of_stock: 1 }).is_out_of_stock).toBe(true);
    expect(toPublicTopDish({ ...ROW, is_out_of_stock: '0' }).is_out_of_stock).toBe(false);
    expect(toPublicTopDish({ ...ROW, is_out_of_stock: '1' }).is_out_of_stock).toBe(true);
    expect(toPublicTopDish({ ...ROW, is_out_of_stock: true }).is_out_of_stock).toBe(true);
  });

  it('qty/price string từ SQL → number', () => {
    expect(toPublicTopDish(ROW).qty).toBe(42);
    expect(toPublicTopDish(ROW).price).toBe(150000);
  });

  it('image_url có giá trị → images = [url]; null → [] (D-09)', () => {
    expect(toPublicTopDish(ROW).images).toEqual(['/uploads/menu/x.webp']);
    expect(toPublicTopDish({ ...ROW, image_url: null }).images).toEqual([]);
  });

  it('schema strict() chặn field thừa — hàng rào nếu ai đó đổi mapper sang spread', () => {
    const dirty = { ...toPublicTopDish(ROW), price_cost: 9999 };
    expect(() => PublicTopDish.strict().parse(dirty)).toThrow();
  });
});

describe('normalizeWindow — giá trị DB rác rơi về all', () => {
  it('giữ nguyên 4 giá trị hợp lệ', () => {
    for (const w of ['all', '30d', '7d', 'today'] as const) {
      expect(normalizeWindow(w)).toBe(w);
    }
  });
  it('giá trị lạ → all, không throw', () => {
    expect(normalizeWindow('last_year')).toBe('all');
    expect(normalizeWindow('')).toBe('all');
  });
});

describe('windowStartMs — mốc bắt đầu đếm', () => {
  // 2026-08-04 10:30 giờ VN = 2026-08-04T03:30:00Z
  const NOW = Date.UTC(2026, 7, 4, 3, 30);

  it("'all' → null (không giới hạn)", () => {
    expect(windowStartMs('all', NOW)).toBeNull();
  });

  it("'30d'/'7d' → lùi đúng số ngày", () => {
    expect(windowStartMs('30d', NOW)).toBe(NOW - 30 * 24 * 3600 * 1000);
    expect(windowStartMs('7d', NOW)).toBe(NOW - 7 * 24 * 3600 * 1000);
  });

  it("'today' → 00:00 giờ Việt Nam (UTC+7), không phải 00:00 UTC", () => {
    // 00:00 04/08 giờ VN = 2026-08-03T17:00:00Z
    expect(windowStartMs('today', NOW)).toBe(Date.UTC(2026, 7, 3, 17, 0));
  });
});

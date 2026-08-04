import { z } from 'zod';

// Hợp đồng công khai của GET /api/public/top-dishes — bảng xếp hạng món bán chạy
// trên trang khách (chỉ đạo chủ dự án 2026-08-04, Task.md dòng "Xem top các món ăn").
//
// Số `qty` là SUM số suất ĐÃ PHỤC VỤ THẬT (order_items SERVED của đơn đã thanh toán,
// cả POS lẫn online) — DESIGN.md apps/shop cấm số liệu bán hàng bịa, nên hợp đồng này
// cố ý KHÔNG có chỗ cho "số cộng thêm". Khoảng thời gian đếm do admin chọn qua
// setting `top_dishes_window`.
//
// Hợp đồng ĐÓNG như PublicMenuItem (M2.D-43): dựng object literal tường minh phía BE
// rồi `.strict().parse()` — không spread entity.
export const TOP_DISHES_WINDOWS = ['all', '30d', '7d', 'today'] as const;
export type TopDishesWindow = (typeof TOP_DISHES_WINDOWS)[number];

export const PublicTopDish = z.object({
  id: z.string().uuid(),
  name: z.string(),
  unit: z.string(),
  // Giá bán hiện hành (VND) — vốn đã công khai qua /api/public/menu, lặp lại ở đây để
  // hàng xếp hạng trên mobile đủ thông tin quyết định mà không phải bấm sang menu.
  price: z.number().int().nonnegative(),
  // Giống D-09 của public-menu: 0..1 phần tử từ menu_item.image_url.
  images: z.array(z.string()).max(1),
  qty: z.number().int().nonnegative(),
});
export type PublicTopDish = z.infer<typeof PublicTopDish>;

export const PublicTopDishes = z.object({
  // false = chủ quán tạm ẩn bảng xếp hạng (setting `top_dishes_enabled`) — khi đó
  // `items` luôn rỗng, FE hiện thông báo thay vì bảng.
  enabled: z.boolean(),
  window: z.enum(TOP_DISHES_WINDOWS),
  items: z.array(PublicTopDish),
});
export type PublicTopDishes = z.infer<typeof PublicTopDishes>;

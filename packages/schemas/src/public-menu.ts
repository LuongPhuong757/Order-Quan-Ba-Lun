import { z } from 'zod';

// M2.D-43 — hợp đồng công khai của /api/public/menu.
// ĐÚNG 7 field, KHÔNG HƠN: id, code, name, price, unit, images, is_out_of_stock.
// Đây là hợp đồng ĐÓNG — nếu cần thêm field, phải sửa 08-RESEARCH.md M2.D-43 trước.
// KHÔNG tự spread `...entity` từ menu_item entity nội bộ — mọi field nội bộ
// (giá vốn, thời điểm tạo, cờ kích hoạt admin...) KHÔNG BAO GIỜ được lộ ra đây,
// xem threat T-08-02 trong threat model của 08-01-PLAN.md.
export const PublicMenuItem = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  price: z.number().int().nonnegative(),
  unit: z.string(),
  // D-09: map 0..1 phần tử từ menu_item.image_url (có ảnh → [url]; NULL → []).
  // Chừa chỗ cho nhiều ảnh/món sau này mà không phải đổi shape.
  images: z.array(z.string()).max(1),
  is_out_of_stock: z.boolean(),
});
export type PublicMenuItem = z.infer<typeof PublicMenuItem>;

export const PublicMenuGroup = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  items: z.array(PublicMenuItem),
});
export type PublicMenuGroup = z.infer<typeof PublicMenuGroup>;

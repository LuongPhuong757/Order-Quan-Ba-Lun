import type { MenuItem } from '../menu/entities/menu-item.entity.js';
import type { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { PublicMenuItem, PublicMenuGroup } from '@order/schemas';

// T-08-33 (M2.D-43, success criterion 5 của phase 8) — đây là HÀNG RÀO DUY NHẤT giữa entity
// nội bộ (`MenuItem`/`MenuGroup`, có giá vốn, cờ kích hoạt, thời điểm tạo, v.v.) và response
// công khai `GET /api/public/menu`. Mọi field mới thêm vào `menu_items`/`menu_groups` sau
// này sẽ TỰ ĐỘNG không lọt ra ngoài, vì cả 2 hàm dưới đây dựng object literal tường minh
// (KHÔNG BAO GIỜ dùng cú pháp trải toán tử trên entity) rồi chạy qua `.strict().parse()`.
// Nếu ai đó sau này sửa lại theo hướng đó thì `public-menu-shape.test.ts` đỏ ngay lập tức.

/** D-09: images[] map 0..1 phần tử từ `image_url` (có ảnh → [url]; NULL → []). Không đổi
 * schema DB, chừa chỗ cho nhiều ảnh/món sau này mà FE không phải sửa hợp đồng. */
export function toPublicMenuItem(m: MenuItem): PublicMenuItem {
  const out: PublicMenuItem = {
    id: m.id,
    code: m.code,
    name: m.name,
    price: m.price,
    unit: m.unit,
    images: m.image_url ? [m.image_url] : [],
    is_out_of_stock: m.is_out_of_stock,
  };
  return PublicMenuItem.strict().parse(out);
}

/** Món hết hàng (M2.D-31) VẪN nằm trong `items` — BE không ẩn, FE làm mờ (D-20).
 * Nhận `Pick` thay vì toàn bộ entity vì controller cần tạo 1 nhóm tổng hợp `other`
 * (món có `group` không khớp nhóm active nào) không có hàng thật trong `menu_groups`. */
export function toPublicMenuGroup(
  g: Pick<MenuGroup, 'id' | 'code' | 'name' | 'icon'>,
  items: PublicMenuItem[],
): PublicMenuGroup {
  const out: PublicMenuGroup = {
    id: g.id,
    code: g.code,
    name: g.name,
    icon: g.icon,
    items,
  };
  return PublicMenuGroup.strict().parse(out);
}

import {
  AUTO_ITEM_NAME_KEYS,
  khongDau,
  PublicTopDish,
  TOP_DISHES_WINDOWS,
  type TopDishesWindow,
} from '@order/schemas';

/**
 * Món QUÁN TỰ THÊM (khăn lạnh) — phải LOẠI khỏi bảng xếp hạng "món bán chạy".
 *
 * Đo trên DB thật 2026-10-05: Khăn Lạnh **195 suất**, món đứng thứ hai (Bia Tiger) **23 suất**.
 * Nó thắng gấp 8 lần không phải vì khách thích, mà vì `pickAutoItem` tự bỏ 5 cái vào MỌI bàn ăn
 * tại chỗ lúc báo bếp lần đầu. Nó không phải món ai CHỌN, nên nó không trả lời được câu hỏi mà
 * bảng xếp hạng sinh ra để trả lời: "quán này món nào ngon?".
 *
 * Hai chỗ hỏng vì nó, cả hai đều im lặng:
 *   - Trang khách: ô số 1 của bảng xếp hạng là cái khăn.
 *   - Nhân vật ở thực đơn tại bàn lấy top-5 để khen "món hot nhất quán" (MenuMascot) — nên có
 *     lúc nó khen cái khăn lạnh.
 *
 * Dùng LẠI `AUTO_ITEM_NAME_KEYS` + `khongDau` chứ không gõ lại tên: đó đúng là lý do luật nằm ở
 * `@order/schemas` (xem docblock auto-items.ts). Quán đổi tên món trong bảng giá thì sửa một
 * chỗ, và chỗ THÊM khăn với chỗ LỌC khăn không bao giờ lệch nhau.
 *
 * KHÔNG lọc bia/nước: bia bán chạy là sự thật, và là món khách tự chọn.
 */
export function isAutoAddedDish(name: string): boolean {
  const k = khongDau(name);
  return AUTO_ITEM_NAME_KEYS.some((key) => k.includes(key));
}

// Hàng rào giữa row SQL thô (GROUP BY trên order_items × menu_items) và hợp đồng
// công khai `PublicTopDish` — cùng kỹ thuật với `public-menu.mapper.ts` (T-08-33):
// object literal tường minh + `.strict().parse()`, không spread. Field mới thêm vào
// query sau này tự động KHÔNG lọt ra response.

/** Row thô từ getRawMany(): mọi số SQL trả về có thể là string. */
export type TopDishRawRow = {
  id: string;
  name: string;
  unit: string;
  price: string | number;
  image_url: string | null;
  qty: string | number;
  /** MySQL trả cột boolean là 0/1 (có driver trả '0'/'1') — ép ở mapper, đừng tin kiểu. */
  is_out_of_stock: boolean | number | string;
};

export function toPublicTopDish(row: TopDishRawRow): PublicTopDish {
  const out: PublicTopDish = {
    id: row.id,
    name: row.name,
    unit: row.unit,
    price: Number(row.price) || 0,
    // D-09 (dùng lại của public-menu): 0..1 phần tử từ image_url.
    images: row.image_url ? [row.image_url] : [],
    qty: Number(row.qty) || 0,
    // `Number(...) === 1` chứ không `Boolean(...)`: chuỗi '0' là truthy trong JS, và nếu driver
    // đổi kiểu trả về thì món CÒN HÀNG sẽ bị dán nhãn hết hàng ở mọi dòng.
    is_out_of_stock: Number(row.is_out_of_stock) === 1,
  };
  return PublicTopDish.strict().parse(out);
}

/** Giá trị setting `top_dishes_window` đi từ DB dạng string tự do → thu về union hợp lệ.
 * Giá trị rác (admin cũ ghi tay, DB sửa tay...) rơi về 'all' thay vì làm 500 trang khách. */
export function normalizeWindow(raw: string): TopDishesWindow {
  return (TOP_DISHES_WINDOWS as readonly string[]).includes(raw) ? (raw as TopDishesWindow) : 'all';
}

const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Mốc bắt đầu đếm (epoch ms) theo window; null = không giới hạn ('all').
 * 'today' tính theo 00:00 giờ Việt Nam (UTC+7 cố định, không DST) — cùng cách cộng
 * offset thủ công như `OrdersService.stats()` để không lệ thuộc timezone table MySQL. */
export function windowStartMs(window: TopDishesWindow, nowMs: number): number | null {
  switch (window) {
    case '30d':
      return nowMs - 30 * DAY_MS;
    case '7d':
      return nowMs - 7 * DAY_MS;
    case 'today':
      return Math.floor((nowMs + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
    case 'all':
    default:
      return null;
  }
}

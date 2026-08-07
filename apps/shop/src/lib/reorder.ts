import type { PublicMenuGroup } from '@order/schemas';
import type { CartLine } from './cart-store.ts';

/**
 * "Đặt lại" — dựng lại giỏ hàng từ một đơn cũ (2026-08-06).
 *
 * Dùng ở 2 chỗ: card trong "Đơn của tôi" (`/history`) và trang theo dõi một đơn đã xong
 * (`/o/:token`). Cả hai đều chỉ có `menu_item_id` + `qty` của đơn cũ; MỌI thứ còn lại (giá, tên,
 * ảnh, còn hàng hay không) tra LIVE từ `/api/public/menu`.
 *
 * Vì sao không dùng lại giá đã lưu trong đơn cũ: đơn tháng trước có giá tháng trước. Nạp giỏ theo
 * giá đó là hiện cho khách một mức giá không còn tồn tại, để rồi `applyMenuSync` (D-07) sửa lại
 * ngay ở lần mở menu kế tiếp kèm banner "giá đã cập nhật" — một cú đổi giá ngay trước mắt khách,
 * do chính ta tạo ra.
 *
 * Món hết hàng bị BỎ QUA chứ không thêm vào giỏ dạng `unavailable`: dòng `unavailable` sinh ra cho
 * món ĐANG trong giỏ thì hết hàng (D-07 — giữ lại để khách biết mình mất gì), còn ở đây khách chưa
 * có gì để mất. Thêm vào rồi khoá nút TIẾP TỤC là bắt họ dọn một mớ mà chính ta vừa bày ra. Tên
 * món bỏ qua được trả về để chỗ gọi nói thẳng, không im lặng.
 *
 * Module thuần: không đụng localStorage/DOM, test được bằng object literal.
 */

export type ReorderSourceItem = {
  /** `null` với món nhân viên thêm tay ở bàn — không có đường nào tra lại trong menu. */
  menu_item_id: string | null;
  name: string;
  qty: number;
  note?: string | null;
};

export type ReorderResult = {
  /** Dòng giỏ hàng dựng từ menu HIỆN HÀNH — chỗ gọi tự quyết cộng dồn hay thay cả giỏ. */
  lines: Array<Omit<CartLine, 'unavailable'>>;
  /** Tên món đang hết hàng — có trong đơn cũ nhưng KHÔNG được thêm vào giỏ. */
  outOfStock: string[];
  /** Tên món không còn trong menu (quán bỏ bán, hoặc món thêm tay không gắn menu). */
  missing: string[];
};

export function buildReorderLines(
  items: ReorderSourceItem[],
  groups: PublicMenuGroup[],
): ReorderResult {
  const byId = new Map(groups.flatMap((g) => g.items).map((item) => [item.id, item]));

  const lines: ReorderResult['lines'] = [];
  const outOfStock: string[] = [];
  const missing: string[] = [];

  for (const source of items) {
    const menuItem = source.menu_item_id === null ? undefined : byId.get(source.menu_item_id);
    if (!menuItem) {
      missing.push(source.name);
      continue;
    }
    if (menuItem.is_out_of_stock) {
      outOfStock.push(menuItem.name);
      continue;
    }
    lines.push({
      menu_item_id: menuItem.id,
      code: menuItem.code,
      name: menuItem.name,
      unit_price: menuItem.price,
      qty: source.qty,
      // Ghi chú cũ ("ít cay") đi theo món: khách đặt lại đúng đơn cũ thì lời dặn cũ cũng phải
      // theo, nếu không họ phải nhớ và gõ lại từng dòng.
      note: source.note ?? null,
      image: menuItem.images[0] ?? null,
    });
  }

  return { lines, outOfStock, missing };
}

/** Câu báo cho khách sau khi đặt lại — `null` khi mọi món đều vào giỏ trọn vẹn (không nói gì cả). */
export function reorderNotice(result: ReorderResult): string | null {
  const parts: string[] = [];
  if (result.outOfStock.length > 0) parts.push(`${result.outOfStock.join(', ')} đang hết hàng`);
  if (result.missing.length > 0) parts.push(`${result.missing.join(', ')} quán không còn bán`);
  if (parts.length === 0) return null;
  return `${parts.join('; ')} — chưa thêm vào giỏ.`;
}

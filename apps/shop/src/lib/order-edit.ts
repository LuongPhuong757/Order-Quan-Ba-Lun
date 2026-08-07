import type { PublicOrderStatus } from '@order/schemas';
import type { CartLine } from './cart-store.ts';

/**
 * Phiên "đang sửa đơn" (M2.D-44 nửa sửa, chốt 2026-08-06).
 *
 * Ý tưởng: KHÔNG dựng một màn sửa đơn riêng. Khách bấm "Sửa đơn" ở `/o/:token` thì món của đơn
 * được nạp vào ĐÚNG cái giỏ hàng quen thuộc, và mọi thứ đã có sẵn tự chạy — tăng giảm số lượng,
 * ghi chú từng món, "+ THÊM MÓN" quay về menu. `/cart` chỉ đổi đúng 2 thứ: một banner nói đang
 * sửa đơn nào, và nút CTA gọi `PATCH` thay vì đi tiếp sang `/checkout`.
 *
 * ── Vì sao phải nhớ `prev_lines`/`prev_note` ──
 * Nạp đơn vào giỏ là GHI ĐÈ giỏ hiện có. Khách hoàn toàn có thể đang chọn dở món cho lần đặt sau
 * thì mở link theo dõi đơn cũ và bấm Sửa. Không cất giỏ cũ đi thì cú bấm đó xoá trắng công chọn
 * món của họ mà không hỏi một câu — đúng loại mất dữ liệu im lặng không ai báo lỗi được. Thoát chế
 * độ sửa (xong hoặc huỷ) là trả lại nguyên vẹn.
 */

export const EDIT_SESSION_KEY = 'qbl.edit_order.v1';

/** Cùng 24h với giỏ hàng (`isCartExpired`): phiên sửa treo lâu hơn giỏ thì banner "đang sửa đơn"
 * sống dai hơn chính món nó đang sửa. */
const MAX_AGE_MS = 24 * 3600_000;

export type EditSession = {
  order_token: string;
  prev_lines: CartLine[];
  prev_note: string;
  started_at_ms: number;
};

export function readEditSession(nowMs: number = Date.now()): EditSession | null {
  try {
    const raw = window.localStorage.getItem(EDIT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditSession>;
    if (
      typeof parsed.order_token !== 'string' ||
      typeof parsed.started_at_ms !== 'number' ||
      !Array.isArray(parsed.prev_lines)
    ) {
      return null;
    }
    if (nowMs - parsed.started_at_ms > MAX_AGE_MS) return null;
    return {
      order_token: parsed.order_token,
      prev_lines: parsed.prev_lines as CartLine[],
      prev_note: typeof parsed.prev_note === 'string' ? parsed.prev_note : '',
      started_at_ms: parsed.started_at_ms,
    };
  } catch {
    // localStorage không đọc được (Safari private mode) — coi như không có phiên sửa nào.
    return null;
  }
}

export function startEditSession(session: EditSession): void {
  try {
    window.localStorage.setItem(EDIT_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ghi hỏng thì chế độ sửa không sống qua reload. Chấp nhận: `/cart` không thấy phiên nên
    // hiện nút "TIẾP TỤC" bình thường — khách đặt thành đơn mới, không có gì hỏng im lặng.
  }
}

export function clearEditSession(): void {
  try {
    window.localStorage.removeItem(EDIT_SESSION_KEY);
  } catch {
    // Xoá hỏng — phiên tự hết hạn sau 24h.
  }
}

/**
 * Món của đơn → dòng giỏ hàng.
 *
 * `menu_item_id` null (món quán thêm tay ở bàn) bị LOẠI: `PATCH` chỉ nhận `menu_item_id`, giữ lại
 * cũng không gửi lên được. Chuyện này chỉ xảy ra với đơn ĐÃ duyệt — mà đơn đã duyệt thì không vào
 * được chế độ sửa — nên trên thực tế danh sách không mất dòng nào.
 *
 * `code` để rỗng: giỏ hàng chỉ dùng nó làm nhãn phụ, còn `PATCH` thì không cần (BE tra lại từ
 * `menu_item_id`). Bịa một mã món ở đây mới là thứ nguy hiểm.
 */
export function orderItemsToCartLines(items: PublicOrderStatus['items']): CartLine[] {
  return items
    .filter((it): it is typeof it & { menu_item_id: string } => it.menu_item_id !== null)
    .map((it) => ({
      menu_item_id: it.menu_item_id,
      code: '',
      name: it.name,
      unit_price: it.unit_price,
      qty: it.qty,
      note: it.note,
      image: it.image,
    }));
}

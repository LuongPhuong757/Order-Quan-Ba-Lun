// Badge số MÓN ĐANG CHỜ BẾP trên nút "Bếp" ở nav dưới (2026-09-07).
//
// "Chờ bếp" = dòng order_item ở state KITCHEN của đơn chưa đóng — CÙNG định nghĩa với cột
// "Đã order" mà `KitchenPage` vẽ (xem `countKitchenPendingItems` ở BE). Cùng định nghĩa là bắt
// buộc: badge hiện 5 mà cột "Đã order" chỉ có 4 thẻ thì bếp mất tin vào cả hai.
//
// Đếm DÒNG, không nhân `qty`: một dòng "3 phần bún" vẫn là MỘT thẻ bếp phải xử lý.
//
// Giống badge bàn đang mở: không có SSE cho luồng bếp (stream duy nhất của hệ là hàng chờ đơn
// online) nên đây là POLL. Nhịp 5s bằng badge "Order" — món mới gọi mà bếp biết muộn nửa phút là
// khách chờ thêm nửa phút. Gọi `/orders/kitchen-count` (1 câu COUNT) chứ không kéo cả `/orders`:
// badge sống ở mọi trang, kéo toàn bộ món của mọi bàn mỗi 5 giây chỉ để lấy 1 con số là lãng phí.
// Khi bếp ĐANG đứng ở màn Bếp, chính màn đó `publish` số nó vừa đếm (nhịp 2s) nên store không
// fetch thêm lần nào.

import { api } from './api.ts';
import { createNavBadgeCount, useNavBadgeCount } from './nav-badge-count.ts';

/** Nhịp poll — bằng badge "Order": poll là nguồn duy nhất, không có SSE đỡ. */
const KITCHEN_PENDING_POLL_MS = 5_000;

export const kitchenPendingStore = createNavBadgeCount({
  fetchCount: async () => {
    const res = await api.get<{ data: { count: number } }>('/orders/kitchen-count');
    return res.data.data.count;
  },
  pollMs: KITCHEN_PENDING_POLL_MS,
});

/**
 * Số món đang chờ bếp làm, cập nhật liên tục. Dùng ở shell để vẽ badge nav.
 * `enabled=false` → trả `null` và KHÔNG mở timer nào — chỉ role thấy nút "Bếp" (admin, kitchen)
 * mới bật, role `order` không có nút này nên không tốn request.
 */
export function useKitchenPendingCount(enabled: boolean): number | null {
  return useNavBadgeCount(kitchenPendingStore, enabled);
}

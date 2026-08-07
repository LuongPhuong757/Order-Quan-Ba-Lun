// Badge số BÀN ĐANG MỞ trên nút "Order" ở nav dưới (chỉ đạo 2026-08-06: "tương tự như online").
//
// "Bàn đang mở" = order chưa checkout và còn ≥1 món chưa huỷ — CÙNG định nghĩa với danh sách
// `/orders` mà màn Order vẽ (xem `countOpenOrders` ở BE). Cùng định nghĩa là điều kiện bắt buộc:
// badge hiện 5 mà màn Order liệt kê 4 bàn thì nhân viên mất tin vào cả hai.
//
// KHÔNG có SSE cho bàn/order (stream duy nhất của hệ là hàng chờ đơn online), nên đây là POLL —
// nhịp dày hơn badge online vì poll là nguồn duy nhất, không phải lưới an toàn.
//
// Gọi `/orders/open-count` (1 câu COUNT) chứ KHÔNG phải `/orders`: badge sống ở mọi trang, kéo cả
// đơn + toàn bộ món của mọi bàn mỗi 5 giây trên mọi máy chỉ để lấy 1 con số là lãng phí băng
// thông của quán. Khi nhân viên ĐANG ở màn Order, chính màn đó `publish` số nó vừa đếm (nhịp 2s)
// nên store không fetch thêm lần nào.

import { api } from './api.ts';
import { createNavBadgeCount, useNavBadgeCount } from './nav-badge-count.ts';

/** Nhịp poll. Dày hơn badge online (20s) vì không có SSE đỡ, nhưng vẫn thưa hơn nhịp 2s của màn
 * Order — badge chỉ cần "có mấy bàn", không cần theo từng món. */
const OPEN_TABLES_POLL_MS = 5_000;

export const openTablesStore = createNavBadgeCount({
  fetchCount: async () => {
    const res = await api.get<{ data: { count: number } }>('/orders/open-count');
    return res.data.data.count;
  },
  pollMs: OPEN_TABLES_POLL_MS,
});

/**
 * Số bàn đang mở, cập nhật liên tục. Dùng ở shell để vẽ badge nav.
 * `enabled=false` → trả `null` và KHÔNG mở timer nào.
 */
export function useOpenTablesCount(enabled: boolean): number | null {
  return useNavBadgeCount(openTablesStore, enabled);
}

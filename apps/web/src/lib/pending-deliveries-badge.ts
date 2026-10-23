// Badge số PHIẾU NHẬP CHỜ DUYỆT trên mục "NCC" ở nav admin (2026-10-23).
//
// Sinh ra cùng lúc với phiếu nháp của role Báo cáo: người nhận hàng lập phiếu xong là hết việc
// của họ, còn phiếu chỉ vào kho và công nợ khi admin bấm Duyệt. Không có con số này thì phiếu
// nằm chờ mà không ai biết — đúng cái khiến công nợ NCC lệch với hoá đơn trong tay.
//
// POLL thưa: không có SSE cho phiếu nhập, mà phiếu nháp cũng không gấp như đơn khách — trễ vài
// chục giây không ai thiệt. Gọi `/supplier-deliveries/pending-count` (1 câu COUNT) chứ không kéo
// cả danh sách phiếu, cùng lý do với `open-tables-badge.ts`.

import { api } from './api.ts';
import { createNavBadgeCount, useNavBadgeCount } from './nav-badge-count.ts';

const PENDING_DELIVERIES_POLL_MS = 60_000;

export const pendingDeliveriesStore = createNavBadgeCount({
  fetchCount: async () => {
    const res = await api.get<{ data: { count: number } }>('/supplier-deliveries/pending-count');
    return res.data.data.count;
  },
  pollMs: PENDING_DELIVERIES_POLL_MS,
});

/**
 * Số phiếu nhập đang chờ admin duyệt. `enabled=false` → trả `null` và KHÔNG mở timer nào —
 * chỉ admin bật, vì chỉ admin duyệt được.
 */
export function usePendingDeliveriesCount(enabled: boolean): number | null {
  return useNavBadgeCount(pendingDeliveriesStore, enabled);
}

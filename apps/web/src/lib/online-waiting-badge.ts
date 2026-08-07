// Đếm đơn online đang CHỜ DUYỆT cho badge trên nav dưới (Task.md dòng 25).
//
// Badge phải hiện Ở MỌI TRANG, nhưng SSE + logic tải hàng chờ nằm trong `QueueView` — chỉ sống
// khi đứng ở màn Đơn hàng online. Nếu shell tự mở `EventSource` riêng thì lúc đứng ở màn hàng
// chờ, MỖI MÁY giữ 2 kết nối SSE (nhân ~3-5 máy của quán, và HTTP/1.1 chỉ cho 6 kết nối/origin).
//
// Giải: 1 KÊNH SSE dùng chung, fan-out theo refcount. Shell subscribe (qua `useOnlineWaitingCount`)
// để đếm; `QueueView` subscribe CÙNG kênh (qua `subscribeQueueStream`) để reload danh sách + reo
// chuông. Kết nối chỉ mở khi có ≥1 listener, đóng khi hết (logout → shell unmount → refcount 0).
//
// Số đơn KHÔNG lấy từ payload SSE (payload cố tình tối giản — D-06): mỗi event/lần nối lại thì
// gọi lại GET list, đọc `status_counts.WAITING`. Đây là fetch RIÊNG với `loadQueue` của trang —
// trùng 1 GET mỗi event khi đang đứng ở màn hàng chờ, đổi lấy việc 2 bên không phụ thuộc nhau.
//
// SSE là đường NHANH, KHÔNG phải đường duy nhất. Bản đầu chỉ fetch lại khi có event SSE nên khi
// stream chết im lặng (proxy đóng, iPad khoá màn hình, wifi rớt mà `onerror` không bắn) badge
// đứng yên ở số cũ — đúng cái "thỉnh thoảng sai" user báo 2026-08-06. Lưới an toàn (poll thưa +
// fetch lại khi quay lại tab / có mạng lại) nằm trong `createNavBadgeCount`.

import type { AdminOnlineOrderList } from '@order/schemas';
import { api } from './api.ts';
import { createNavBadgeCount, useNavBadgeCount } from './nav-badge-count.ts';
import { subscribeOnlineOrders, type SseHandlers } from './online-orders-sse.ts';

// ── Kênh SSE dùng chung (refcount) ──────────────────────────────────────────

let channelStop: (() => void) | null = null;
let channelOpen = false;
const channelHandlers = new Set<SseHandlers>();

/**
 * Subscribe kênh SSE hàng chờ dùng chung — thay cho gọi thẳng `subscribeOnlineOrders`.
 * Trả về hàm dọn dẹp, `useEffect` PHẢI gọi khi unmount (T-09-57).
 *
 * Listener vào SAU khi kết nối đã mở được PHÁT LẠI `onOpen` ngay — thiếu bước này thì
 * `QueueView` (mount khi shell đã giữ kết nối) mãi tưởng mình đang "nối lại" và hiện banner
 * mất kết nối oan, dù heartbeat vẫn đều.
 */
export function subscribeQueueStream(handlers: SseHandlers): () => void {
  channelHandlers.add(handlers);
  if (!channelStop) {
    channelStop = subscribeOnlineOrders({
      // Copy ra mảng trước khi lặp: handler có thể unsubscribe ngay trong lúc được gọi.
      onOpen: () => {
        channelOpen = true;
        for (const h of [...channelHandlers]) h.onOpen();
      },
      onError: () => {
        channelOpen = false;
        for (const h of [...channelHandlers]) h.onError();
      },
      onEvent: (ev) => { for (const h of [...channelHandlers]) h.onEvent(ev); },
    });
  } else if (channelOpen) {
    handlers.onOpen();
  }
  return () => {
    channelHandlers.delete(handlers);
    if (channelHandlers.size === 0 && channelStop) {
      channelStop();
      channelStop = null;
      channelOpen = false;
    }
  };
}

// ── Store đếm đơn WAITING ───────────────────────────────────────────────────

/** Nhịp poll dự phòng. Thưa CÓ CHỦ ĐÍCH: SSE lo phần realtime, đây chỉ để bắt trường hợp stream
 * chết im lặng. 20s là mức tệ nhất nhân viên phải chờ khi SSE đã chết — vẫn nhanh hơn hẳn việc
 * badge treo vô hạn, mà không tạo tải đáng kể (1 GET/20s/máy). */
const WAITING_POLL_MS = 20_000;

export const onlineWaitingStore = createNavBadgeCount({
  fetchCount: async () => {
    const res = await api.get<{ data: AdminOnlineOrderList }>('/admin/online-orders?status=WAITING');
    return res.data.data.status_counts.WAITING;
  },
  pollMs: WAITING_POLL_MS,
  subscribe: (signal) =>
    subscribeQueueStream({
      onOpen: signal,
      onError: () => {
        /* mất kết nối → giữ số cuối; màn hàng chờ mới là nơi báo đứt kết nối */
      },
      onEvent: (ev) => {
        if (ev.type !== 'heartbeat') signal();
      },
    }),
});

/**
 * Số đơn online đang chờ duyệt, cập nhật realtime qua SSE (kèm poll dự phòng). Dùng ở shell để vẽ
 * badge nav. `enabled=false` (chưa đăng nhập / không có role) → trả `null` và KHÔNG mở kết nối
 * nào — cả 3 role đều xem được hàng chờ (D-02) nên có role là bật được.
 */
export function useOnlineWaitingCount(enabled: boolean): number | null {
  return useNavBadgeCount(onlineWaitingStore, enabled);
}

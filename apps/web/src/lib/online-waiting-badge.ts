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

import { useEffect, useState } from 'react';
import type { AdminOnlineOrderList } from '@order/schemas';
import { api } from './api.ts';
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

/** `null` = chưa tải được lần nào → không hiện badge (thà không có số còn hơn hiện số sai). */
let waitingCount: number | null = null;
const countListeners = new Set<(n: number | null) => void>();
let stopChannel: (() => void) | null = null;
/** Đánh dấu lần fetch mới nhất — kết quả của lần cũ về muộn thì BỎ, không ghi đè số mới. */
let fetchSeq = 0;

function broadcast(n: number | null): void {
  waitingCount = n;
  for (const l of [...countListeners]) l(n);
}

async function refetchCount(): Promise<void> {
  const seq = ++fetchSeq;
  try {
    const res = await api.get<{ data: AdminOnlineOrderList }>(
      '/admin/online-orders?status=WAITING',
    );
    if (seq !== fetchSeq) return;
    broadcast(res.data.data.status_counts.WAITING);
  } catch {
    // Lỗi thoáng qua → GIỮ số cũ, event SSE kế tiếp (hoặc lần nối lại) sẽ fetch lại.
  }
}

/**
 * Số đơn online đang chờ duyệt, cập nhật realtime qua SSE. Dùng ở shell để vẽ badge nav.
 * `enabled=false` (chưa đăng nhập / không có role) → trả `null` và KHÔNG mở kết nối nào —
 * cả 3 role đều xem được hàng chờ (D-02) nên có role là bật được.
 */
export function useOnlineWaitingCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(enabled ? waitingCount : null);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return;
    }
    setCount(waitingCount);
    countListeners.add(setCount);
    if (countListeners.size === 1) {
      stopChannel = subscribeQueueStream({
        onOpen: () => void refetchCount(),
        onError: () => {
          /* mất kết nối → giữ số cuối; màn hàng chờ mới là nơi báo đứt kết nối */
        },
        onEvent: (ev) => {
          if (ev.type !== 'heartbeat') void refetchCount();
        },
      });
      void refetchCount();
    }
    return () => {
      countListeners.delete(setCount);
      if (countListeners.size === 0 && stopChannel) {
        stopChannel();
        stopChannel = null;
        // Đăng nhập lại là phiên mới — số của phiên trước không còn đáng tin.
        waitingCount = null;
      }
    };
  }, [enabled]);

  return count;
}

// Client SSE cho trang Hàng chờ duyệt + phân loại trạng thái kết nối (D-06, D-07).
//
// Vấn đề gốc cần giải: SSE chết IM LẶNG. Proxy đóng kết nối, wifi rớt, laptop sleep — trang vẫn
// trông bình thường, chỉ là không bao giờ có đơn mới nữa (T-09-55). Nên BE gửi heartbeat mỗi 15s
// (plan 09-07) và ở đây ta đo khoảng lặng để phân biệt 4 trạng thái, rồi trang hiện chấm màu +
// banner CHIẾM CHỖ khi mất kết nối.
//
// `connectionStateFrom` là hàm THUẦN — đó là phần được test. Phần bọc `EventSource` không test được
// bằng vitest thuần nên phải giữ càng mỏng càng tốt.
//
// KHÔNG dùng replay theo id của event cuối, KHÔNG replay buffer — D-06 đã chốt ngược lại: mỗi lần
// mở hoặc nối lại, trang tự gọi lại `GET /admin/online-orders?status=WAITING`. DB là nguồn sự thật
// duy nhất, đúng cả khi API vừa restart hay dữ liệu bị sửa tay.

import { OnlineOrderStreamEvent } from '@order/schemas';

/** Quá mốc này mà không nhận được gì (hoặc đang mất kết nối) → coi là ĐỨT: chấm đỏ + banner.
 * D-07 gợi ý "~10s"; con số chính xác chốt tại đây. Phải NHỎ HƠN 2 chu kỳ heartbeat để nhân viên
 * biết sớm, nhưng đủ lớn để không báo động vì 1 lần mạng chớp. */
export const SSE_DEAD_MS = 10_000;

/** Nhịp heartbeat của BE (plan 09-07). Khai lại ở đây CÓ CHỦ ĐÍCH — đây là kỳ vọng của client về
 * BE; đổi nhịp ở BE mà không sửa chỗ này thì trạng thái `stale` sẽ sai. */
const HEARTBEAT_MS = 15_000;

/** Kết nối còn mở nhưng lặng quá 2 nhịp heartbeat = có gì đó sai dù socket chưa đóng. */
const STALE_MS = 2 * HEARTBEAT_MS;

export type SseConnState = 'connected' | 'stale' | 'reconnecting' | 'dead';

export function connectionStateFrom(input: {
  open: boolean;
  lastMessageMs: number | null;
  startedMs: number;
  nowMs: number;
}): SseConnState {
  const { open, lastMessageMs, startedMs, nowMs } = input;

  // Mở được socket nhưng CHƯA BAO GIỜ nhận được byte nào quá ngưỡng → proxy đang chặn
  // `text/event-stream` (buffer thay vì flush). Trông như "đã kết nối" nhưng vô dụng.
  if (lastMessageMs === null && nowMs - startedMs > SSE_DEAD_MS) return 'dead';

  if (!open) {
    const silentFor = nowMs - (lastMessageMs ?? startedMs);
    return silentFor > SSE_DEAD_MS ? 'dead' : 'reconnecting';
  }

  if (lastMessageMs !== null && nowMs - lastMessageMs > STALE_MS) return 'stale';

  return 'connected';
}

/** Backoff nối lại khi lỗi LIÊN TIẾP: 2s → 5s → 15s → 30s rồi giữ 30s.
 * Bản cũ (1s → 2s → 5s → 10s) + reset bậc ngay ở `onopen` khiến API lỗi 500 / stream mở rồi sập
 * ngay bị gõ cửa ~2s/lần mãi (2026-11-11) — mỗi máy trực ca nhân thêm tải lên đúng cái API đang
 * ốm. Trần 30s vì quán mở cả ca, nhân viên không bấm F5: vẫn phải thử tiếp mãi, nhưng thưa;
 * poll dự phòng 20s của badge (`online-waiting-badge.ts`) lo phần số đếm trong lúc chờ. */
const RECONNECT_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000] as const;

/**
 * Độ trễ trước lần mở lại thứ `failCount` (đếm từ 1 = lần lỗi đầu tiên). Hàm THUẦN để test được.
 * `failCount` ≤ 0 hoặc không phải số hữu hạn → coi như lần đầu (2s), không bao giờ trả 0 để tránh
 * vòng lặp gõ cửa liên tục.
 */
export function reconnectDelayMs(failCount: number): number {
  const last = RECONNECT_BACKOFF_MS.length - 1;
  if (!Number.isFinite(failCount) || failCount < 1) return RECONNECT_BACKOFF_MS[0];
  return RECONNECT_BACKOFF_MS[Math.min(Math.floor(failCount) - 1, last)];
}

export type SseHandlers = {
  onEvent(ev: OnlineOrderStreamEvent): void;
  onOpen(): void;
  onError(): void;
};

/**
 * Mở `EventSource` tới stream hàng chờ. Trả về hàm dọn dẹp — `useEffect` PHẢI gọi nó khi unmount,
 * thiếu bước này là rò 1 `EventSource` + 1 timer mỗi lần điều hướng vào trang (T-09-57).
 *
 * Không truyền `withCredentials`: stream cùng origin nên cookie phiên tự đi kèm, và `EventSource`
 * không set được header nên không có cách nào gửi token kiểu khác.
 */
export function subscribeOnlineOrders(handlers: SseHandlers): () => void {
  let es: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Số lần lỗi liên tiếp chưa xen bởi 1 message thành công — quyết định bậc backoff. */
  let failCount = 0;
  let closed = false;

  const isHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

  const clearRetry = (): void => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const closeEs = (): void => {
    try {
      es?.close();
    } catch {
      // ignore
    }
    es = null;
  };

  const open = (): void => {
    if (closed || es) return;
    // Tab ẩn (iPad khoá màn hình, chuyển app) → KHÔNG mở lại: không ai nhìn, mà mỗi lần mở là 1
    // request tới API. `visibilitychange` bên dưới sẽ mở lại ngay khi tab hiện lại.
    if (isHidden()) return;
    try {
      es = new EventSource('/admin/online-orders/stream');
    } catch {
      es = null;
      failCount += 1;
      scheduleRetry();
      return;
    }

    es.onopen = () => {
      // KHÔNG reset `failCount` ở đây: API ốm hay trả 200 rồi sập ngay → reset ở `onopen` chính là
      // cái làm vòng nối lại kẹt ở bậc thấp nhất. Chỉ reset khi có message thật (heartbeat 15s/lần).
      handlers.onOpen();
    };

    es.onmessage = (msg: MessageEvent) => {
      failCount = 0;
      // Payload lạ (BE đổi shape, proxy chèn rác) → BỎ QUA, không làm sập trang đang trực ca.
      try {
        const parsed = OnlineOrderStreamEvent.safeParse(JSON.parse(String(msg.data)));
        if (parsed.success) handlers.onEvent(parsed.data);
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      handlers.onError();
      // `EventSource` tự nối lại theo `retry` của server (mặc định ~vài giây), không backoff và
      // không báo trạng thái → PHẢI close() rồi tự hẹn giờ, không thì 2 vòng nối lại chồng nhau.
      closeEs();
      failCount += 1;
      scheduleRetry();
    };
  };

  const scheduleRetry = (): void => {
    if (closed || retryTimer || isHidden()) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, reconnectDelayMs(failCount));
  };

  /** Mở lại NGAY (bỏ qua bậc backoff đang chờ) — dùng khi tab hiện lại / có mạng lại: đó là lúc
   * nhân viên đang nhìn màn hình, đợi tới 30s mới thấy đơn là quá lâu. */
  const reopenNow = (): void => {
    if (closed || es || isHidden()) return;
    clearRetry();
    open();
  };

  const onVisibility = (): void => {
    if (isHidden()) {
      // Ẩn tab thì huỷ hẹn giờ đang chờ; kết nối đang sống thì cứ để (đóng/mở lại tốn hơn giữ).
      clearRetry();
      return;
    }
    reopenNow();
  };

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  if (typeof window !== 'undefined') window.addEventListener('online', reopenNow);

  open();

  return () => {
    closed = true;
    clearRetry();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('online', reopenNow);
    closeEs();
  };
}

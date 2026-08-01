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

/** Backoff nối lại: 1s → 2s → 5s → 10s rồi giữ 10s. Không backoff vô hạn — quán mở cả ca, nhân
 * viên không bấm F5; sau 10s vẫn phải thử tiếp mãi. */
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

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
  let attempt = 0;
  let closed = false;

  const open = (): void => {
    if (closed) return;
    try {
      es = new EventSource('/admin/online-orders/stream');
    } catch {
      scheduleRetry();
      return;
    }

    es.onopen = () => {
      attempt = 0;
      handlers.onOpen();
    };

    es.onmessage = (msg: MessageEvent) => {
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
      // `EventSource` tự nối lại, nhưng nó không backoff và không báo cho ta biết trạng thái —
      // tự quản để chấm màu/banner phản ánh đúng thực tế.
      try {
        es?.close();
      } catch {
        // ignore
      }
      es = null;
      scheduleRetry();
    };
  };

  const scheduleRetry = (): void => {
    if (closed || retryTimer) return;
    const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)];
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  };

  open();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    try {
      es?.close();
    } catch {
      // ignore
    }
    es = null;
  };
}

// Store đếm-sống dùng chung cho badge trên nav dưới (số đơn online chờ duyệt, số bàn đang mở).
//
// Vì sao phải có lớp này thay vì mỗi badge tự `useEffect` + fetch:
//
// 1. Badge sống ở SHELL nên nó hiện ở mọi trang, nhưng chỉ có MỘT con số cho cả app. Nếu để
//    component tự fetch thì mỗi lần điều hướng là một vòng fetch mới, và 2 nav (admin/order/bếp
//    render 3 nhánh JSX khác nhau) có thể đếm lệch nhau.
//
// 2. NGUỒN CẬP NHẬT REALTIME LUÔN CÓ THỂ CHẾT IM LẶNG. Badge đơn online bản đầu chỉ fetch lại khi
//    có event SSE, nên đúng lúc mất tín hiệu là nó ĐỨNG YÊN ở số cũ mà trông vẫn bình thường →
//    chính là "thỉnh thoảng sai". Ở đây realtime chỉ là đường NHANH; lưới an toàn nằm trong
//    `attachRefreshTriggers` (xem chú thích ở đó).
//
// 3. Tiết kiệm request: `publish()` cho trang đang mở (đã tự fetch danh sách với nhịp riêng) đẩy
//    số vào store và HOÃN nhịp poll — đứng ở màn đó thì store không fetch thêm lần nào.

import { useEffect, useState } from 'react';
import { attachRefreshTriggers, type RefreshTriggers } from './refresh-triggers.ts';

export type NavBadgeCount = {
  /** Đăng ký nhận số mới. Trả hàm dọn dẹp; listener đầu tiên mở nguồn, listener cuối đóng lại. */
  subscribe(listener: (n: number | null) => void): () => void;
  /** Số hiện tại — `null` = chưa tải được lần nào (không vẽ badge). */
  get(): number | null;
  /** Trang đang mở đẩy số nó vừa fetch được vào store — badge khớp ngay và nhịp poll được hoãn. */
  publish(n: number): void;
  /** Ép fetch lại ngay (gọi sau thao tác vừa làm đổi con số). No-op khi không ai đang nghe. */
  refetch(): void;
};

export function createNavBadgeCount(opts: {
  /** Fetch số hiện tại. Throw = lỗi thoáng qua → giữ số cũ. */
  fetchCount(): Promise<number>;
  /** Nhịp poll. Có realtime → để thưa (chỉ là lưới an toàn); không có → để dày. */
  pollMs: number;
  /** Nguồn realtime (SSE...). Gọi `signal()` mỗi khi số CÓ THỂ đã đổi. Trả hàm dọn dẹp. */
  subscribe?: (signal: () => void) => () => void;
}): NavBadgeCount {
  /** `null` = chưa tải được lần nào → không vẽ badge (thà không có số còn hơn hiện số sai). */
  let count: number | null = null;
  const listeners = new Set<(n: number | null) => void>();

  /** Đánh dấu lần fetch mới nhất — kết quả về muộn của lần cũ bị BỎ, không ghi đè số mới. Cũng
   * là cách vô hiệu hoá mọi fetch đang bay khi teardown/publish. */
  let fetchSeq = 0;
  let triggers: RefreshTriggers | null = null;
  let stopRealtime: (() => void) | null = null;

  function broadcast(n: number | null): void {
    count = n;
    for (const l of [...listeners]) l(n);
  }

  async function doFetch(): Promise<void> {
    const seq = ++fetchSeq;
    // Đường nào tải cũng tính là "vừa mới" — poll dự phòng nhờ vậy chỉ chạy khi thật sự không
    // còn đường nào khác hoạt động.
    triggers?.noteFresh();
    try {
      const n = await opts.fetchCount();
      if (seq !== fetchSeq) return;
      broadcast(n);
    } catch {
      // Lỗi thoáng qua → GIỮ số cũ; nhịp poll kế tiếp sẽ thử lại.
    }
  }

  function start(): void {
    triggers = attachRefreshTriggers({ refresh: () => void doFetch(), pollMs: opts.pollMs });
    if (opts.subscribe) {
      // Tín hiệu SSE đi qua cùng cửa throttle với poll/visibility — 5 event trong 1 giây vẫn
      // chỉ 1 lượt GET.
      stopRealtime = opts.subscribe(() => triggers?.fire());
    }
    void doFetch();
  }

  function stop(): void {
    if (stopRealtime) {
      stopRealtime();
      stopRealtime = null;
    }
    triggers?.stop();
    triggers = null;
    // Đăng nhập lại là phiên mới — số của phiên trước không còn đáng tin. Bump `fetchSeq` để
    // fetch đang bay không hồi sinh nó.
    fetchSeq++;
    count = null;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    get: () => count,
    publish(n) {
      // Bump seq: số vừa publish MỚI HƠN mọi fetch đang bay, không cho chúng ghi đè.
      fetchSeq++;
      broadcast(n);
      // Trang đang mở tự nuôi số này → hoãn nhịp poll, khỏi fetch trùng.
      triggers?.noteFresh();
    },
    refetch() {
      if (listeners.size > 0) void doFetch();
    },
  };
}

/**
 * Hook đọc store cho shell. `enabled=false` (chưa đăng nhập / không có role) → trả `null` và
 * KHÔNG mở kết nối hay timer nào.
 */
export function useNavBadgeCount(store: NavBadgeCount, enabled: boolean): number | null {
  const [value, setValue] = useState<number | null>(enabled ? store.get() : null);

  useEffect(() => {
    if (!enabled) {
      setValue(null);
      return;
    }
    setValue(store.get());
    return store.subscribe(setValue);
  }, [store, enabled]);

  return value;
}

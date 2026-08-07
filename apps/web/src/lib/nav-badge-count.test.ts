// Test cho store đếm badge nav. Trọng tâm là các đường KHÔNG dễ thấy khi bấm tay:
// nguồn realtime chết im lặng, kết quả fetch cũ về muộn, tab ẩn cả tiếng.
//
// Store chạm `document`/`window` (visibilitychange, focus, online) nhưng vitest ở đây chạy env
// `node` — nên stub 2 đối tượng đó bằng bản tối giản đủ để đo listener. Không đổi env sang jsdom
// vì cả bộ test web hiện là hàm thuần, thêm jsdom là chậm toàn bộ vì 1 file.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNavBadgeCount } from './nav-badge-count.ts';

type Handler = () => void;

/** `document`/`window` giả: giữ handler theo tên event để test tự bắn. */
function installDomStubs() {
  const docHandlers = new Map<string, Set<Handler>>();
  const winHandlers = new Map<string, Set<Handler>>();
  const state = { hidden: false };

  const bind = (store: Map<string, Set<Handler>>) => ({
    addEventListener: (type: string, h: Handler) => {
      if (!store.has(type)) store.set(type, new Set());
      store.get(type)!.add(h);
    },
    removeEventListener: (type: string, h: Handler) => {
      store.get(type)?.delete(h);
    },
  });

  vi.stubGlobal('document', {
    ...bind(docHandlers),
    get hidden() {
      return state.hidden;
    },
  });
  vi.stubGlobal('window', bind(winHandlers));

  return {
    state,
    fire(type: string, where: 'doc' | 'win' = 'doc') {
      const store = where === 'doc' ? docHandlers : winHandlers;
      for (const h of [...(store.get(type) ?? [])]) h();
    },
    countListeners(type: string, where: 'doc' | 'win' = 'doc') {
      const store = where === 'doc' ? docHandlers : winHandlers;
      return store.get(type)?.size ?? 0;
    },
  };
}

let dom: ReturnType<typeof installDomStubs>;

beforeEach(() => {
  vi.useFakeTimers();
  dom = installDomStubs();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createNavBadgeCount', () => {
  it('listener đầu tiên → fetch ngay và phát số về', async () => {
    const fetchCount = vi.fn().mockResolvedValue(3);
    const store = createNavBadgeCount({ fetchCount, pollMs: 5_000 });
    const seen: Array<number | null> = [];

    store.subscribe((n) => seen.push(n));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchCount).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([3]);
    expect(store.get()).toBe(3);
  });

  it('poll theo nhịp — đây là lưới an toàn khi realtime chết im lặng', async () => {
    // Nguồn realtime "chết": subscribe xong không bao giờ gọi `signal`. Bản cũ của badge online
    // chỉ fetch theo event SSE nên tình huống này là badge treo ở số cũ mãi mãi.
    const fetchCount = vi.fn().mockResolvedValueOnce(1).mockResolvedValue(2);
    const store = createNavBadgeCount({
      fetchCount,
      pollMs: 5_000,
      subscribe: () => () => {},
    });

    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get()).toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchCount).toHaveBeenCalledTimes(2);
    expect(store.get()).toBe(2);
  });

  it('tab ẩn → KHÔNG poll; hiện lại → fetch ngay', async () => {
    const fetchCount = vi.fn().mockResolvedValue(1);
    const store = createNavBadgeCount({ fetchCount, pollMs: 5_000 });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCount).toHaveBeenCalledTimes(1);

    dom.state.hidden = true;
    await vi.advanceTimersByTimeAsync(20_000); // 4 nhịp poll trôi qua
    expect(fetchCount).toHaveBeenCalledTimes(1);

    dom.state.hidden = false;
    dom.fire('visibilitychange');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCount).toHaveBeenCalledTimes(2);
  });

  it('có mạng lại → fetch ngay, không đợi hết nhịp poll', async () => {
    const fetchCount = vi.fn().mockResolvedValue(1);
    const store = createNavBadgeCount({ fetchCount, pollMs: 60_000 });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(1_000);

    dom.fire('online', 'win');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCount).toHaveBeenCalledTimes(2);
  });

  it('tín hiệu realtime dồn dập → gộp thành 1 fetch', async () => {
    const fetchCount = vi.fn().mockResolvedValue(1);
    let signal: (() => void) | null = null;
    const store = createNavBadgeCount({
      fetchCount,
      pollMs: 60_000,
      subscribe: (s) => {
        signal = s;
        return () => {};
      },
    });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchCount).toHaveBeenCalledTimes(1);

    signal!();
    signal!();
    signal!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCount).toHaveBeenCalledTimes(2);
  });

  it('kết quả fetch CŨ về muộn không ghi đè số mới hơn', async () => {
    let resolveSlow: ((n: number) => void) | null = null;
    const fetchCount = vi
      .fn()
      .mockImplementationOnce(() => new Promise<number>((r) => { resolveSlow = r; }))
      .mockResolvedValue(9);
    const store = createNavBadgeCount({ fetchCount, pollMs: 5_000 });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    // Nhịp poll kế tiếp về trước, rồi lần fetch đầu mới trả về số cũ.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.get()).toBe(9);
    resolveSlow!(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get()).toBe(9);
  });

  it('fetch lỗi → GIỮ số cũ, không xoá badge', async () => {
    const fetchCount = vi
      .fn()
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(5);
    const store = createNavBadgeCount({ fetchCount, pollMs: 5_000 });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get()).toBe(4);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.get()).toBe(4);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(store.get()).toBe(5);
  });

  it('publish từ trang đang mở: số vào ngay và HOÃN nhịp poll (không fetch trùng)', async () => {
    const fetchCount = vi.fn().mockResolvedValue(1);
    const store = createNavBadgeCount({ fetchCount, pollMs: 5_000 });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCount).toHaveBeenCalledTimes(1);

    // Trang tự fetch nhịp 2s và publish → tới mốc 5s store vẫn chưa cần fetch lần 2.
    await vi.advanceTimersByTimeAsync(2_000);
    store.publish(7);
    expect(store.get()).toBe(7);
    await vi.advanceTimersByTimeAsync(2_000);
    store.publish(8);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchCount).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(8);
  });

  it('publish thắng fetch đang bay', async () => {
    let resolveSlow: ((n: number) => void) | null = null;
    const fetchCount = vi.fn(() => new Promise<number>((r) => { resolveSlow = r; }));
    const store = createNavBadgeCount({ fetchCount, pollMs: 60_000 });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    store.publish(7);
    resolveSlow!(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get()).toBe(7);
  });

  it('listener cuối rời → dọn timer, huỷ realtime, quên số của phiên cũ', async () => {
    const fetchCount = vi.fn().mockResolvedValue(1);
    const stopRealtime = vi.fn();
    const store = createNavBadgeCount({
      fetchCount,
      pollMs: 5_000,
      subscribe: () => stopRealtime,
    });

    const offA = store.subscribe(() => {});
    const offB = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    // 2 listener nhưng CHỈ 1 nguồn: kết nối/timer mở theo refcount, không nhân theo listener.
    expect(fetchCount).toHaveBeenCalledTimes(1);
    expect(dom.countListeners('visibilitychange')).toBe(1);

    offA();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchCount).toHaveBeenCalledTimes(2); // còn B → vẫn chạy

    offB();
    expect(stopRealtime).toHaveBeenCalledTimes(1);
    expect(dom.countListeners('visibilitychange')).toBe(0);
    // Đăng nhập lại là phiên mới — số cũ không còn đáng tin.
    expect(store.get()).toBeNull();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchCount).toHaveBeenCalledTimes(2);
  });

  it('fetch đang bay lúc teardown không hồi sinh số cũ', async () => {
    let resolveSlow: ((n: number) => void) | null = null;
    const fetchCount = vi.fn(() => new Promise<number>((r) => { resolveSlow = r; }));
    const store = createNavBadgeCount({ fetchCount, pollMs: 60_000 });
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    off();
    resolveSlow!(6);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get()).toBeNull();
  });

  it('refetch() không làm gì khi không ai đang nghe', async () => {
    const fetchCount = vi.fn().mockResolvedValue(1);
    const store = createNavBadgeCount({ fetchCount, pollMs: 5_000 });
    store.refetch();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchCount).not.toHaveBeenCalled();
  });
});

// Test cho lưới an toàn dùng chung. Case quan trọng nhất — và là bug thật 2026-08-06 — là
// "SSE chết im lặng": không có tín hiệu nào nữa thì poll PHẢI tự tải lại. Trước khi có lớp này,
// badge nav treo số cũ và màn hàng chờ hiện "không có đơn nào" trong khi DB có đơn thật.
//
// `document`/`window` stub vì vitest ở đây chạy env `node` — xem lý do ở `nav-badge-count.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachRefreshTriggers } from './refresh-triggers.ts';

type Handler = () => void;

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
    total() {
      let n = 0;
      for (const s of docHandlers.values()) n += s.size;
      for (const s of winHandlers.values()) n += s.size;
      return n;
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

describe('attachRefreshTriggers', () => {
  it('không có tín hiệu nào (SSE chết im lặng) → poll vẫn tự tải lại', () => {
    const refresh = vi.fn();
    const t = attachRefreshTriggers({ refresh, pollMs: 15_000 });

    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    t.stop();
  });

  it('noteFresh (SSE vẫn sống) → DỜI nhịp poll, không tải trùng', () => {
    const refresh = vi.fn();
    const t = attachRefreshTriggers({ refresh, pollMs: 15_000 });

    // SSE đẩy về đều đặn mỗi 10s → poll 15s không bao giờ tới hạn.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(10_000);
      t.noteFresh();
    }
    expect(refresh).not.toHaveBeenCalled();

    // SSE ngừng → 15s sau poll vào việc.
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    t.stop();
  });

  it('tab ẩn → không poll; hiện lại → tải ngay', () => {
    const refresh = vi.fn();
    const t = attachRefreshTriggers({ refresh, pollMs: 5_000 });

    dom.state.hidden = true;
    vi.advanceTimersByTime(20_000);
    expect(refresh).not.toHaveBeenCalled();

    dom.state.hidden = false;
    dom.fire('visibilitychange');
    expect(refresh).toHaveBeenCalledTimes(1);

    t.stop();
  });

  it('focus lại cửa sổ / có mạng lại → tải ngay, không đợi hết nhịp', () => {
    const refresh = vi.fn();
    const t = attachRefreshTriggers({ refresh, pollMs: 60_000 });

    dom.fire('focus', 'win');
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    dom.fire('online', 'win');
    expect(refresh).toHaveBeenCalledTimes(2);

    t.stop();
  });

  it('tín hiệu dồn dập trong cửa sổ throttle → gộp thành 1 lần tải', () => {
    const refresh = vi.fn();
    const t = attachRefreshTriggers({ refresh, pollMs: 60_000, minGapMs: 400 });

    t.fire();
    t.fire();
    t.fire();
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(400);
    t.fire();
    expect(refresh).toHaveBeenCalledTimes(2);

    t.stop();
  });

  it('stop() gỡ sạch listener + timer', () => {
    const refresh = vi.fn();
    const t = attachRefreshTriggers({ refresh, pollMs: 5_000 });
    expect(dom.total()).toBe(3); // visibilitychange + focus + online

    t.stop();
    expect(dom.total()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

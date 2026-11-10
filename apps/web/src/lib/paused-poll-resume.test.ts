import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPausedPollResume, PAUSED_RETRY_MS } from './paused-poll-resume';

/** `window`/`document` giả: EventTarget thật của Node + cờ `hidden`. */
function fakeEnv(hidden = false) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden });
  return { win, doc };
}

describe('attachPausedPollResume — màn Bếp tự nối lại sau khi rớt mạng', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('đang poll bình thường → KHÔNG thử gì thêm (không tăng request)', async () => {
    const probe = vi.fn(async () => true);
    const { win, doc } = fakeEnv();
    const stop = attachPausedPollResume({ isPaused: () => false, probe, resume: vi.fn(), win, doc });
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(PAUSED_RETRY_MS * 3);
    expect(probe).not.toHaveBeenCalled();
    stop();
  });

  it('đang tạm dừng + có mạng lại → thử ngay; thử được thì bật lại poll', async () => {
    let paused = true;
    const probe = vi.fn(async () => true);
    const resume = vi.fn(() => {
      paused = false;
    });
    const { win, doc } = fakeEnv();
    const stop = attachPausedPollResume({ isPaused: () => paused, probe, resume, win, doc });
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    stop();
  });

  it('không có sự kiện "online" (API khởi động lại, wifi chập) → vẫn tự thử lại theo nhịp chậm', async () => {
    let paused = true;
    const probe = vi.fn(async () => probe.mock.calls.length >= 2); // lần 1 hỏng, lần 2 được
    const resume = vi.fn(() => {
      paused = false;
    });
    const { win, doc } = fakeEnv();
    const stop = attachPausedPollResume({ isPaused: () => paused, probe, resume, win, doc });
    await vi.advanceTimersByTimeAsync(PAUSED_RETRY_MS);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PAUSED_RETRY_MS);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PAUSED_RETRY_MS * 3);
    expect(probe).toHaveBeenCalledTimes(2); // đã chạy lại bình thường → thôi thử
    stop();
  });

  it('quay lại tab / bấm vào màn hình → thử ngay', async () => {
    const probe = vi.fn(async () => false);
    const { win, doc } = fakeEnv();
    const stop = attachPausedPollResume({ isPaused: () => true, probe, resume: vi.fn(), win, doc });
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(2);
    stop();
  });

  it('tab đang ẩn → không thử (đợi lúc hiện lại)', async () => {
    const probe = vi.fn(async () => true);
    const { win, doc } = fakeEnv(true);
    const stop = attachPausedPollResume({ isPaused: () => true, probe, resume: vi.fn(), win, doc });
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(PAUSED_RETRY_MS * 2);
    expect(probe).not.toHaveBeenCalled();
    stop();
  });

  it('không chồng 2 lần thử cùng lúc khi tín hiệu dồn dập', async () => {
    let release: (v: boolean) => void = () => {};
    const probe = vi.fn(() => new Promise<boolean>((r) => (release = r)));
    const { win, doc } = fakeEnv();
    const stop = attachPausedPollResume({ isPaused: () => true, probe, resume: vi.fn(), win, doc });
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    release(false);
    stop();
  });

  it('stop() gỡ hết listener + timer', async () => {
    const probe = vi.fn(async () => false);
    const { win, doc } = fakeEnv();
    const stop = attachPausedPollResume({ isPaused: () => true, probe, resume: vi.fn(), win, doc });
    stop();
    win.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(PAUSED_RETRY_MS * 3);
    expect(probe).not.toHaveBeenCalled();
  });
});

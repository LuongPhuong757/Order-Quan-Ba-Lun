/**
 * M7.D-12 / §3.7 — chống đọc lặp, 5 lớp.
 *
 * Màn bếp poll 2 giây, nên một lượt gọi chưa ai bấm "Đã nghe" sẽ xuất hiện trong MỌI nhịp.
 * Không có lớp này thì trình duyệt đọc "Bàn 5 gọi thêm đồ" 30 lần mỗi phút.
 */

const KEY = 'qbl.voice.spoken.v1';

/** Nhắc lại tối đa 2 lần, cách nhau 60 giây — R7 (nhân viên quên duyệt/quên nghe). Lần thứ ba
 *  thì thôi: nhắc mãi thành tiếng ồn nền và người ta học cách lờ đi. */
export const MAX_SPEAKS = 2;
export const REPEAT_AFTER_MS = 60_000;

type Entry = { count: number; lastAt: number };
type Store = Record<string, Entry>;

/** ⚠ localStorage trên Safari riêng tư NÉM LỖI CẢ KHI ĐỌC, không chỉ khi ghi. Mọi ngả phải
 *  bọc try/catch, và hỏng thì rơi về Set trong RAM chứ không được làm chết màn bếp. */
let memory: Store = {};

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return memory;
    const parsed = JSON.parse(raw) as Store;
    return typeof parsed === 'object' && parsed !== null ? parsed : memory;
  } catch {
    return memory;
  }
}

function save(store: Store): void {
  memory = store;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* RAM là đủ cho phiên hiện tại */
  }
}

/**
 * @param acked lượt đã có người bấm "Đã nghe" — không đọc nữa, kể cả chưa đủ 2 lần.
 * @returns true nếu LẦN NÀY nên đọc. Gọi hàm này đã tính là đã đọc (tăng bộ đếm).
 */
export function shouldSpeak(callId: string, acked: boolean, nowMs: number): boolean {
  if (acked) return false;
  const store = load();
  const e = store[callId];
  if (!e) {
    save({ ...store, [callId]: { count: 1, lastAt: nowMs } });
    return true;
  }
  if (e.count >= MAX_SPEAKS) return false;
  if (nowMs - e.lastAt < REPEAT_AFTER_MS) return false;
  save({ ...store, [callId]: { count: e.count + 1, lastAt: nowMs } });
  return true;
}

/** Dọn các lượt đã biến mất khỏi payload để bộ nhớ không phình mãi sau nhiều ca. */
export function pruneSpoken(aliveIds: readonly string[]): void {
  const store = load();
  const alive = new Set(aliveIds);
  const next: Store = {};
  for (const [k, v] of Object.entries(store)) if (alive.has(k)) next[k] = v;
  save(next);
}

/** Chỉ dùng trong test — xoá sạch trạng thái giữa các ca. */
export function __resetSpoken(): void {
  memory = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* bỏ qua */
  }
}

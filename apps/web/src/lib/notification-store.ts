// Notification queue lưu localStorage — toast nào quan trọng push vào đây để user
// xem lại sau (vì toast trên UI biến mất sau vài giây).
//
// Không lưu DB để giữ nhẹ. Audit log server-side đã có (Admin → Audit) cho mục
// truy cứu trách nhiệm.

export type NotificationKind = 'ready' | 'order_open' | 'order_cancel' | 'order_checkout' | 'info' | 'error';

export type NotificationEntry = {
  id: number;
  kind: NotificationKind;
  message: string;
  ts_ms: number;
  read: boolean;
  /** Khoá chống trùng — vd "checkout:<orderId>". Có key trùng thì bỏ qua entry mới. */
  dedupeKey?: string;
};

// v4 (2026-07-27): TTL 24h → 7 ngày cho mục đối chiếu thanh toán; thêm dedupeKey.
// Bump version để reset entries cũ (schema entry đổi).
const STORAGE_KEY = 'notifications-v4';
const MAX_ENTRIES = 1000;              // 7 ngày × nhiều checkout/ngày
const TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 ngày — đủ để admin đối chiếu doanh thu

type Listener = (entries: NotificationEntry[]) => void;
const listeners = new Set<Listener>();
let nextId = 1;

/** Drop entries cũ hơn TTL_MS (24h) — chừa danh sách gọn cho user. */
function pruneOld(entries: NotificationEntry[]): NotificationEntry[] {
  const cutoff = Date.now() - TTL_MS;
  return entries.filter((e) => e.ts_ms >= cutoff);
}

function load(): NotificationEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Bump nextId past max existing
    for (const e of arr) {
      if (typeof e.id === 'number' && e.id >= nextId) nextId = e.id + 1;
    }
    return pruneOld(arr);
  } catch {
    return [];
  }
}

function save(entries: NotificationEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

let cache: NotificationEntry[] = load();

function emit() {
  for (const l of listeners) l(cache);
}

export const notificationStore = {
  getAll(): NotificationEntry[] {
    return cache;
  },
  unreadCount(): number {
    return cache.filter((e) => !e.read).length;
  },
  push(kind: NotificationKind, message: string, dedupeKey?: string) {
    // Chống trùng: nếu đã có entry cùng dedupeKey thì bỏ qua (backfill an toàn).
    if (dedupeKey && cache.some((e) => e.dedupeKey === dedupeKey)) return;
    const entry: NotificationEntry = {
      id: nextId++,
      kind,
      message,
      ts_ms: Date.now(),
      read: false,
      dedupeKey,
    };
    // Prune cũ + cap MAX để tránh localStorage bloat
    cache = pruneOld([entry, ...cache]).slice(0, MAX_ENTRIES);
    save(cache);
    emit();
  },
  /** Ghi entry với timestamp chỉ định (dùng cho backfill lịch sử — giữ đúng giờ gốc). */
  pushAt(kind: NotificationKind, message: string, tsMs: number, dedupeKey?: string) {
    if (dedupeKey && cache.some((e) => e.dedupeKey === dedupeKey)) return;
    const entry: NotificationEntry = {
      id: nextId++,
      kind,
      message,
      ts_ms: tsMs,
      read: false,
      dedupeKey,
    };
    cache = pruneOld([entry, ...cache])
      .sort((a, b) => b.ts_ms - a.ts_ms) // mới nhất lên đầu
      .slice(0, MAX_ENTRIES);
    save(cache);
    emit();
  },
  markAllRead() {
    if (cache.every((e) => e.read)) return;
    cache = cache.map((e) => ({ ...e, read: true }));
    save(cache);
    emit();
  },
  clear() {
    cache = [];
    save(cache);
    emit();
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'vừa xong';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  return new Date(ts).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

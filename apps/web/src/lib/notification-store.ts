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
};

const STORAGE_KEY = 'notifications-v1';
const MAX_ENTRIES = 50;

type Listener = (entries: NotificationEntry[]) => void;
const listeners = new Set<Listener>();
let nextId = 1;

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
    return arr;
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
  push(kind: NotificationKind, message: string) {
    const entry: NotificationEntry = {
      id: nextId++,
      kind,
      message,
      ts_ms: Date.now(),
      read: false,
    };
    cache = [entry, ...cache].slice(0, MAX_ENTRIES);
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

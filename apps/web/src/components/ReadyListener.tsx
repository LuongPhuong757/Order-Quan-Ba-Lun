// Tổng đài notification: subscribe events từ readyNotifier + role-gated
// dispatch sang Toast + NotificationBell + sound.
// Mounted ONCE ở App.tsx — đảm bảo mọi page đều nhận thông báo.
//
// Role distribution (per user spec):
// - Order:    READY (bếp xong) + KitchenOutOfStock (bếp báo hết)
// - Kitchen:  NewOrder + ItemServed + KitchenOutOfStock (self-confirm) + StaffCancel
// - Admin:    Checkout (poll /orders/history)
import { useEffect, useRef } from 'react';
import { api, isTransientError } from '../lib/api.ts';
import { readyNotifier } from '../lib/ready-notifier.ts';
import { notificationStore } from '../lib/notification-store.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { useToast } from './Toast.tsx';

type ClosedOrder = {
  id: string;
  table_id: string;
  table_code: string;
  closed_at: number;
  checked_out_by_full_name: string | null;
  items?: Array<{ state: string; menu_item_price: number; qty: number }>;
};

const CHECKOUT_POLL_MS = 10_000;  // Admin poll history mỗi 10s

export function ReadyListener() {
  const toast = useToast();
  const { user } = useAuth();
  const role = user?.role ?? (user?.is_owner ? 'admin' : null);
  const isOrder = role === 'order' || role === 'admin';
  const isKitchen = role === 'kitchen' || role === 'admin';
  const isAdmin = role === 'admin';
  const userFullName = user?.full_name || '';

  // Track last seen checkout ID để diff trên Admin polling
  const lastSeenCheckoutMs = useRef<number>(Date.now());

  useEffect(() => {
    // ─── READY: món xong → notify Order role + Admin ────────────────
    const offReady = readyNotifier.on((ev) => {
      if (!isOrder) return;
      const msg = `🔔 ${ev.table_name} — ${ev.qty}× ${ev.menu_item_name} đã xong, lên lấy mang ra!`;
      toast.push('ready', msg, 6000);
      notificationStore.push('ready', `${ev.table_name} — ${ev.qty}× ${ev.menu_item_name} đã xong`);
      readyNotifier.playReadyBeep();
    });

    // ─── KitchenOutOfStock: bếp báo hết → Order + Kitchen (self-confirm) ────
    const offKitchenCancel = readyNotifier.onKitchenCancel((ev) => {
      if (!isOrder && !isKitchen) return;
      const msg = `⚠️ ${ev.table_name}: bếp báo HẾT ${ev.qty}× ${ev.menu_item_name}`;
      toast.push('error', msg + (isOrder ? ' — ra báo khách đổi món!' : ''), 8000);
      notificationStore.push(
        'order_cancel',
        isOrder
          ? `${ev.table_name} — bếp báo hết ${ev.qty}× ${ev.menu_item_name}. Ra báo khách đổi món.`
          : `${ev.table_name} — đã báo hết ${ev.qty}× ${ev.menu_item_name}.`,
      );
      readyNotifier.playAlertBeep();
    });

    // ─── NewOrder: bồi vừa báo bếp → Kitchen ───────────────────────
    const offNewOrder = readyNotifier.onNewOrder((ev) => {
      if (!isKitchen) return;
      const msg = `📢 ${ev.table_name} — món mới: ${ev.qty}× ${ev.menu_item_name}`;
      toast.push('info', msg, 5000);
      notificationStore.push(
        'order_open',
        `${ev.table_name} — gọi mới ${ev.qty}× ${ev.menu_item_name}.`,
      );
      readyNotifier.playNewOrderBeep();
    });

    // ─── ItemServed: món tới tay khách → Kitchen (biết ai giao) ────
    const offItemServed = readyNotifier.onItemServed((ev) => {
      if (!isKitchen) return;
      // Self-action (bếp tự giao): không cần beep + toast lặp lại
      if (ev.served_by === userFullName) return;
      const msg = `🚀 ${ev.table_name} — ${ev.qty}× ${ev.menu_item_name} đã giao bởi ${ev.served_by}`;
      toast.push('info', msg, 5000);
      notificationStore.push(
        'ready',
        `${ev.table_name} — ${ev.qty}× ${ev.menu_item_name} giao bởi ${ev.served_by}`,
      );
      readyNotifier.playReadyBeep();
    });

    // ─── StaffCancel: nhân viên order huỷ món → Kitchen biết để dừng làm
    const offStaffCancel = readyNotifier.onItemCancelByStaff((ev) => {
      if (!isKitchen) return;
      // Self-action: không lặp
      if (ev.cancelled_by === userFullName) return;
      const msg = `✕ ${ev.table_name} HUỶ ${ev.qty}× ${ev.menu_item_name} (bởi ${ev.cancelled_by})`;
      toast.push('error', msg + (ev.reason ? ` — ${ev.reason}` : ''), 7000);
      notificationStore.push(
        'order_cancel',
        `${ev.table_name} — ${ev.cancelled_by} huỷ ${ev.qty}× ${ev.menu_item_name}${ev.reason ? `: ${ev.reason}` : ''}.`,
      );
      readyNotifier.playAlertBeep();
    });

    // Audio unlock (iOS Safari)
    const unlock = () => {
      readyNotifier.unlockAudio();
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    return () => {
      offReady();
      offKitchenCancel();
      offNewOrder();
      offItemServed();
      offStaffCancel();
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [toast, isOrder, isKitchen, userFullName]);

  // ─── Admin: poll /orders/history mỗi 10s → detect new checkouts ──
  useEffect(() => {
    if (!isAdmin) return;
    const startedAt = Date.now();
    lastSeenCheckoutMs.current = startedAt;

    const poll = async () => {
      try {
        const since = lastSeenCheckoutMs.current;
        const res = await api.get<{ data: { items: ClosedOrder[] } }>(
          `/orders/history?start_ms=${since}&page=1&page_size=20`,
        );
        const newCheckouts = (res.data?.data?.items || []).filter((o) => o.closed_at > since);
        for (const o of newCheckouts) {
          const total = (o.items || [])
            .filter((i) => i.state === 'SERVED')
            .reduce((s, i) => s + i.menu_item_price * i.qty, 0);
          const cashier = o.checked_out_by_full_name || 'không xác định';
          const msg = `💰 ${o.table_code} thanh toán ${total.toLocaleString('vi-VN')}đ — ${cashier}`;
          toast.push('success', msg, 6000);
          notificationStore.push(
            'order_checkout',
            `${o.table_code} thanh toán ${total.toLocaleString('vi-VN')}đ bởi ${cashier}.`,
          );
        }
        if (newCheckouts.length > 0) {
          const maxTs = Math.max(...newCheckouts.map((o) => o.closed_at));
          lastSeenCheckoutMs.current = maxTs + 1;
        }
      } catch (err) {
        if (!isTransientError(err)) {
          // eslint-disable-next-line no-console
          console.warn('Checkout poller error', err);
        }
      }
    };
    const t = setInterval(poll, CHECKOUT_POLL_MS);
    return () => clearInterval(t);
  }, [isAdmin, toast]);

  return null;
}

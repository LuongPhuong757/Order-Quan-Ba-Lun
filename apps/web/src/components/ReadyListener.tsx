// Tổng đài notification: subscribe events từ readyNotifier + STRICT role-gated.
// Mounted ONCE ở App.tsx — đảm bảo mọi page đều nhận thông báo.
//
// Quy tắc role (per user spec — STRICT, admin KHÔNG nhận event nghiệp vụ):
// 1. Có món được order (NewOrder)     → CHỈ Bếp
// 2. Món đã xong (READY)              → CHỈ Order
// 3. Món huỷ (StaffCancel)            → CHỈ Bếp
// 4. Đánh dấu hết (KitchenOutOfStock) → CẢ Bếp + Order
// 5. Thanh toán xong (Checkout)       → CHỈ Admin
// 6. Món đã giao tới khách (Served)   → CHỈ Bếp (kèm tên người giao)
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
  table_name?: string;  // BE resolved từ /orders/history; fallback table_code
  closed_at: number;
  checked_out_by_full_name: string | null;
  items?: Array<{ state: string; menu_item_price: number; qty: number }>;
};

const CHECKOUT_POLL_MS = 10_000;  // Admin poll history mỗi 10s

export function ReadyListener() {
  const toast = useToast();
  const { user } = useAuth();
  const role = user?.role ?? (user?.is_owner ? 'admin' : null);
  // STRICT — không bao gồm admin nữa
  const isOrder = role === 'order';
  const isKitchen = role === 'kitchen';
  const isAdmin = role === 'admin';
  const userFullName = user?.full_name || '';

  const lastSeenCheckoutMs = useRef<number>(Date.now());

  useEffect(() => {
    // ─── Rule 2: READY → CHỈ Order ─────────────────────────────────
    const offReady = readyNotifier.on((ev) => {
      if (!isOrder) return;
      const msg = `🔔 ${ev.table_name} — ${ev.qty}× ${ev.menu_item_name} đã xong, lên lấy mang ra!`;
      toast.push('ready', msg, 6000);
      notificationStore.push('ready', `${ev.table_name} — ${ev.qty}× ${ev.menu_item_name} đã xong`);
      readyNotifier.playReadyBeep();
    });

    // ─── Rule 1: NewOrder → CHỈ Bếp ─────────────────────────────────
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

    // ─── Rule 4: KitchenOutOfStock → CẢ Bếp + Order ────────────────
    const offKitchenCancel = readyNotifier.onKitchenCancel((ev) => {
      if (!isOrder && !isKitchen) return;
      const msg = isOrder
        ? `⚠️ ${ev.table_name}: bếp báo HẾT ${ev.qty}× ${ev.menu_item_name} — ra báo khách đổi món!`
        : `⚠️ Đã báo hết ${ev.qty}× ${ev.menu_item_name} cho bàn ${ev.table_name}`;
      toast.push('error', msg, 8000);
      notificationStore.push(
        'order_cancel',
        isOrder
          ? `${ev.table_name} — bếp báo hết ${ev.qty}× ${ev.menu_item_name}. Ra báo khách đổi món.`
          : `${ev.table_name} — đã báo hết ${ev.qty}× ${ev.menu_item_name}.`,
      );
      readyNotifier.playAlertBeep();
    });

    // ─── Rule 3: StaffCancel (order staff huỷ món) → CHỈ Bếp ──────
    const offStaffCancel = readyNotifier.onItemCancelByStaff((ev) => {
      if (!isKitchen) return;
      // Self-action skip: nếu bếp tự huỷ thì không cần báo lại chính mình
      if (ev.cancelled_by === userFullName) return;
      const msg = `✕ ${ev.table_name} HUỶ ${ev.qty}× ${ev.menu_item_name} (bởi ${ev.cancelled_by})`;
      toast.push('error', msg + (ev.reason ? ` — ${ev.reason}` : ''), 7000);
      notificationStore.push(
        'order_cancel',
        `${ev.table_name} — ${ev.cancelled_by} huỷ ${ev.qty}× ${ev.menu_item_name}${ev.reason ? `: ${ev.reason}` : ''}.`,
      );
      readyNotifier.playAlertBeep();
    });

    // ─── Rule 6: ItemServed (món tới tay khách) → CHỈ Bếp ─────────
    const offItemServed = readyNotifier.onItemServed((ev) => {
      if (!isKitchen) return;
      // Self-action skip: bếp tự đánh dấu giao thì không cần notify lại
      if (ev.served_by === userFullName) return;
      const msg = `🚀 ${ev.table_name} — ${ev.qty}× ${ev.menu_item_name} đã giao bởi ${ev.served_by}`;
      toast.push('info', msg, 5000);
      notificationStore.push(
        'ready',
        `${ev.table_name} — ${ev.qty}× ${ev.menu_item_name} giao bởi ${ev.served_by}`,
      );
      readyNotifier.playReadyBeep();
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
      offNewOrder();
      offKitchenCancel();
      offStaffCancel();
      offItemServed();
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [toast, isOrder, isKitchen, userFullName]);

  // ─── Rule 5: Checkout → CHỈ Admin (poll /orders/history mỗi 10s) ─
  useEffect(() => {
    if (!isAdmin) return;
    lastSeenCheckoutMs.current = Date.now();

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
          const tableName = o.table_name || o.table_code;
          const msg = `💰 ${tableName} thanh toán ${total.toLocaleString('vi-VN')}đ — ${cashier}`;
          toast.push('success', msg, 6000);
          notificationStore.push(
            'order_checkout',
            `${tableName} thanh toán ${total.toLocaleString('vi-VN')}đ bởi ${cashier}.`,
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

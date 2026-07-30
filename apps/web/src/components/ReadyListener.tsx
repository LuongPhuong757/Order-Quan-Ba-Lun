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
// 7. Chuyển bàn (TableTransfer)       → CẢ Bếp + Order (gom theo from→to)
import { useEffect } from 'react';
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
const CHECKOUT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;  // backfill tối đa 7 ngày

export function ReadyListener() {
  const toast = useToast();
  const { user } = useAuth();
  const role = user?.role ?? (user?.is_owner ? 'admin' : null);
  // STRICT — không bao gồm admin nữa
  const isOrder = role === 'order';
  const isKitchen = role === 'kitchen';
  const isAdmin = role === 'admin';
  const userFullName = user?.full_name || '';

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
      // 8s (trước 5s): bếp đang quay lưng thái/xào, 5s là quay lại đã tắt banner.
      // kind 'neworder' → nền cam khớp cột "Đã order" + cỡ chữ lớn ở màn bếp.
      toast.push('neworder', msg, 8000);
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
      toast.push('error', msg + (ev.reason ? ` — ${ev.reason}` : ''), 8000);
      notificationStore.push(
        'order_cancel',
        `${ev.table_name} — ${ev.cancelled_by} huỷ ${ev.qty}× ${ev.menu_item_name}${ev.reason ? `: ${ev.reason}` : ''}.`,
      );
      // Beep bếp (to + dài): món có thể đang trên chảo, bỏ lỡ là nấu thừa.
      readyNotifier.playKitchenAlertBeep();
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

    // ─── Rule 7: TableTransfer (chuyển bàn) → CẢ Bếp + Order ──────
    const offTransfer = readyNotifier.onTableTransfer((ev) => {
      if (!isOrder && !isKitchen) return;
      const msg = `🔄 Chuyển bàn: ${ev.from_table_name} → ${ev.to_table_name} (${ev.item_count} món)`;
      toast.push('info', msg, 6000);
      notificationStore.push(
        'info',
        `Chuyển bàn ${ev.from_table_name} → ${ev.to_table_name}: ${ev.item_count} món.`,
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
      offNewOrder();
      offKitchenCancel();
      offStaffCancel();
      offItemServed();
      offTransfer();
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [toast, isOrder, isKitchen, userFullName]);

  // ─── Rule 5: Checkout → CHỈ Admin ───────────────────────────────
  // Poll /orders/history mỗi 10s. KHÁC bản cũ (đã gây bug nghiêm trọng):
  // mốc "đã xem" lưu BỀN trong localStorage theo từng admin, KHÔNG reset về
  // now mỗi lần mount. Khi admin đăng nhập lại → BACKFILL toàn bộ thanh toán
  // bị bỏ lỡ lúc offline (lùi tối đa 7 ngày) vào chuông 🔔 để đối chiếu.
  // Dữ liệu nguồn (orders đã đóng) vốn được server giữ lâu dài.
  useEffect(() => {
    if (!isAdmin || !user) return;
    const lsKey = `admin-checkout-seen-ms:${user.sub}`;
    const floor = Date.now() - CHECKOUT_LOOKBACK_MS;
    const stored = Number(localStorage.getItem(lsKey) || 0);
    let since = Math.max(stored, floor); // không backfill xa quá 7 ngày
    let firstRun = true;
    let inFlight = false;

    const persist = (ms: number) => {
      since = ms;
      try { localStorage.setItem(lsKey, String(ms)); } catch { /* quota */ }
    };

    // Lấy HẾT checkout kể từ fromMs (phân trang) — không giới hạn 20 như cũ,
    // nếu không sẽ mất checkout khi offline lâu (nhiều bàn thanh toán).
    const fetchAllSince = async (fromMs: number): Promise<ClosedOrder[]> => {
      const all: ClosedOrder[] = [];
      for (let page = 1; page <= 30; page++) { // trần 30×100 = 3000
        const res = await api.get<{ data: { items: ClosedOrder[] } }>(
          `/orders/history?status=paid&start_ms=${fromMs}&page=${page}&page_size=100`,
        );
        const items = (res.data?.data?.items || []).filter(
          (o) => typeof o.closed_at === 'number' && o.closed_at > fromMs,
        );
        all.push(...items);
        if (items.length < 100) break;
      }
      return all;
    };

    const record = (o: ClosedOrder, live: boolean) => {
      const total = (o.items || [])
        .filter((i) => i.state === 'SERVED')
        .reduce((s, i) => s + i.menu_item_price * i.qty, 0);
      const cashier = o.checked_out_by_full_name || 'không xác định';
      const tableName = o.table_name || o.table_code;
      const line = `${tableName} thanh toán ${total.toLocaleString('vi-VN')}đ bởi ${cashier}.`;
      // Giữ đúng giờ thanh toán gốc + dedupe theo order id (backfill an toàn)
      notificationStore.pushAt('order_checkout', line, o.closed_at, `checkout:${o.id}`);
      if (live) {
        toast.push('success', `💰 ${tableName} thanh toán ${total.toLocaleString('vi-VN')}đ — ${cashier}`, 6000);
      }
    };

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const list = (await fetchAllSince(since)).sort((a, b) => a.closed_at - b.closed_at);
        if (list.length > 0) {
          if (firstRun) {
            // Backfill offline: nạp hết vào 🔔 (unread), CHỈ 1 toast tổng hợp.
            for (const o of list) record(o, false);
            toast.push('info', `💰 ${list.length} bàn đã thanh toán khi bạn vắng mặt — xem 🔔`, 8000);
          } else {
            for (const o of list) record(o, true);
          }
          persist(Math.max(...list.map((o) => o.closed_at)));
        }
        firstRun = false;
      } catch (err) {
        if (!isTransientError(err)) {
          // eslint-disable-next-line no-console
          console.warn('Checkout poller error', err);
        }
      } finally {
        inFlight = false;
      }
    };

    poll(); // chạy ngay khi mount → backfill thanh toán bị bỏ lỡ
    const t = setInterval(poll, CHECKOUT_POLL_MS);
    return () => clearInterval(t);
  }, [isAdmin, toast, user]);

  return null;
}

// Listen to global ready-notifier events + push toast.
// Mounted ONCE ở App.tsx — đảm bảo mọi page đều thấy notification.
import { useEffect } from 'react';
import { readyNotifier } from '../lib/ready-notifier.ts';
import { notificationStore } from '../lib/notification-store.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { useToast } from './Toast.tsx';

export function ReadyListener() {
  const toast = useToast();
  const { user } = useAuth();
  const role = user?.role ?? (user?.is_owner ? 'admin' : null);
  const isKitchenSide = role === 'kitchen' || role === 'admin';

  useEffect(() => {
    const offReady = readyNotifier.on((ev) => {
      const msg = `🔔 ${ev.table_code} — ${ev.qty}× ${ev.menu_item_name} đã xong, lên lấy mang ra!`;
      toast.push('ready', msg, 6000);
      // Persist vào notification list để xem lại nếu lỡ miss toast
      notificationStore.push('ready', `${ev.table_code} — ${ev.qty}× ${ev.menu_item_name} đã xong`);
    });

    const offCancel = readyNotifier.onKitchenCancel((ev) => {
      const msg = `⚠️ ${ev.table_code}: bếp báo HẾT ${ev.qty}× ${ev.menu_item_name} — ra báo khách đổi món!`;
      toast.push('error', msg, 8000);
      notificationStore.push(
        'order_cancel',
        `${ev.table_code} — bếp báo hết ${ev.qty}× ${ev.menu_item_name}. Ra bàn báo khách đổi món.`,
      );
    });

    // Chỉ bếp + admin nhận thông báo món MỚI báo bếp — Order staff không cần
    // (họ là người vừa gọi, không cần biết lại).
    const offNewOrder = readyNotifier.onNewOrder((ev) => {
      if (!isKitchenSide) return;
      const msg = `📢 ${ev.table_code} — món mới: ${ev.qty}× ${ev.menu_item_name}`;
      toast.push('info', msg, 5000);
      notificationStore.push(
        'order_open',
        `${ev.table_code} — gọi mới ${ev.qty}× ${ev.menu_item_name}. Bếp xử lý ngay.`,
      );
      // Beep "ding-dong" thấp hơn READY để bếp phân biệt — chỉ bếp/admin nghe
      readyNotifier.playNewOrderBeep();
    });

    const off = () => { offReady(); offCancel(); offNewOrder(); };

    // Unlock audio sau first user gesture (iOS Safari yêu cầu)
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
      off();
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [toast]);

  return null;
}

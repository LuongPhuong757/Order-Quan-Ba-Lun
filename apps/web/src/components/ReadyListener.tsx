// Listen to global ready-notifier events + push toast.
// Mounted ONCE ở App.tsx — đảm bảo mọi page đều thấy notification.
import { useEffect } from 'react';
import { readyNotifier } from '../lib/ready-notifier.ts';
import { notificationStore } from '../lib/notification-store.ts';
import { useToast } from './Toast.tsx';

export function ReadyListener() {
  const toast = useToast();

  useEffect(() => {
    const off = readyNotifier.on((ev) => {
      const msg = `🔔 ${ev.table_code} — ${ev.qty}× ${ev.menu_item_name} đã xong, lên lấy mang ra!`;
      toast.push('ready', msg, 6000);
      // Persist vào notification list để xem lại nếu lỡ miss toast
      notificationStore.push('ready', `${ev.table_code} — ${ev.qty}× ${ev.menu_item_name} đã xong`);
    });

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

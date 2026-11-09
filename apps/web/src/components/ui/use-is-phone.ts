import { useSyncExternalStore } from 'react';

/**
 * Đang ở bề rộng điện thoại (< 768px) hay không — mốc chung của cả hệ (packages/ui-tokens).
 *
 * Dùng cho component đổi HÀNH VI theo bề rộng (dropdown/lịch: điện thoại trượt từ đáy, máy
 * tính bung dưới ô). Chỉ đổi DÁNG thì dùng @media trong CSS, đừng dùng hook này.
 * `useSyncExternalStore` thay vì useState+useEffect: xoay ngang iPad giữa chừng là component
 * đổi ngay ở lần vẽ kế, không có một nhịp vẽ sai kiểu.
 */
const QUERY = '(max-width: 767px)';

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

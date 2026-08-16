import { useEffect, useRef, useState } from 'react';
import type { PublicStoreStatus } from '@order/schemas';
import { nextOpeningMs } from './open-hours.ts';

/**
 * Đồng hồ đếm ngược tới giờ mở cửa cho NÚT ĐẶT HÀNG (2026-08-16) — nửa còn lại của việc chặn
 * đặt đơn ngoài giờ (nhánh chặn thật ở BE `submit-order.ts`, mã 409 `STORE_CLOSED`).
 *
 * Trả chuỗi "H:MM:SS" khi quán đang NGOÀI GIỜ và tính được mốc mở kế tiếp; `null` cho mọi ca
 * khác (đang mở, tắt tay, chưa cấu hình giờ). Về 0 thì gọi `onReopen` ĐÚNG MỘT LẦN — chỗ gọi
 * dùng nó để `reload()` lại `/api/public/store`: nút chỉ mở khi SERVER xác nhận đã mở, đồng hồ
 * FE không bao giờ là người quyết định cuối.
 *
 * Chống lệch đồng hồ máy khách: mọi phép tính dùng `Date.now() + offset`, với
 * `offset = server_now_ms - Date.now()` chốt tại lúc payload store về. Máy khách lệch 10 phút
 * (chuyện thật với điện thoại tắt auto-time) thì đồng hồ vẫn đếm đúng theo giờ quán.
 *
 * Mỗi giây TÍNH LẠI từ mốc, không trừ dần biến đếm: tab bị iOS đóng băng nền 20 phút rồi thức
 * dậy thì interval kiểu trừ dần còn nguyên 20 phút rác, kiểu tính-lại tự đúng ngay tick đầu.
 */
export function useReopenCountdown(
  store: PublicStoreStatus | null,
  onReopen: () => void,
): string | null {
  const [label, setLabel] = useState<string | null>(null);
  // `onReopen` là hàm inline từ trang cha (đổi mỗi render) — giữ qua ref để effect không
  // restart interval mỗi lần trang render lại, cùng lý do với `onChange` ở LocationPicker.
  const onReopenRef = useRef(onReopen);
  onReopenRef.current = onReopen;

  const blocked = store !== null && !store.ordering_enabled && store.blocking_reason === 'OUTSIDE_HOURS';
  // Chốt offset theo ĐÚNG payload đang cầm — mỗi lần reload store là một lần hiệu chỉnh lại.
  const serverOffset = store === null ? 0 : store.server_now_ms - Date.now();
  const openHours = store?.open_hours;

  useEffect(() => {
    if (!blocked || !openHours) {
      setLabel(null);
      return;
    }
    const targetMs = nextOpeningMs(openHours, Date.now() + serverOffset);
    if (targetMs === null) {
      // Ngoài giờ nhưng không tính được mốc (cả tuần rule hỏng) — không hiện số bừa.
      setLabel(null);
      return;
    }

    let reopened = false;
    const tick = () => {
      const remaining = targetMs - (Date.now() + serverOffset);
      if (remaining <= 0) {
        if (!reopened) {
          reopened = true;
          setLabel(null);
          onReopenRef.current();
        }
        return;
      }
      setLabel(formatRemaining(remaining));
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
    // `serverOffset` cố ý KHÔNG nằm trong deps: nó nhích vài ms mỗi render (Date.now() trôi),
    // đưa vào là interval bị dựng lại liên tục. Giá trị dùng trong tick luôn là bản mới nhất
    // của lần store đổi — đủ đúng cho đồng hồ giây.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked, openHours]);

  return label;
}

/** 5h12m44s → "5:12:44"; dưới 1 giờ → "12:44" — khách đọc như đồng hồ bấm giờ, không cần chữ. */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1_000);
  const h = Math.floor(totalSeconds / 3_600);
  const m = Math.floor((totalSeconds % 3_600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

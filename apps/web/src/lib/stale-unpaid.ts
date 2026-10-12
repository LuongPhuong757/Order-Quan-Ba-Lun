// Dải "BÀN NGỒI QUÁ LÂU CHƯA THANH TOÁN" (chủ quán chốt 2026-10-12) — phần lấy dữ liệu.
//
// Danh sách do BE quyết (`GET /orders/stale-unpaid`, xem `orders/stale-unpaid.ts` phía API):
// đơn còn mở, còn món, chưa thu tiền, mở lâu hơn ngưỡng chủ quán đặt ở Cài đặt. FE chỉ vẽ.
//
// POLL 60 GIÂY, không dày hơn: ngưỡng tính bằng GIỜ, trễ một phút không đổi gì, mà hook này
// chạy trên MỌI máy đang mở app suốt ca. Thêm một nhịp khi tab quay lại tiền cảnh — máy tính
// bảng ở quầy hay tắt màn hình, mở lên phải thấy ngay chứ không đợi tới nhịp kế.

import { useEffect, useState } from 'react';
import { api } from './api.ts';

export type StaleUnpaidItem = {
  order_id: string;
  table_id: string;
  label: string;
  opened_at: number;
  open_ms: number;
};

export type StaleUnpaid = { threshold_min: number; items: StaleUnpaidItem[] };

const STALE_UNPAID_POLL_MS = 60_000;

/** `enabled=false` → trả `null` và KHÔNG mở timer nào (không đứng ở màn Order / Bếp). */
export function useStaleUnpaid(enabled: boolean): StaleUnpaid | null {
  const [data, setData] = useState<StaleUnpaid | null>(null);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get<{ data: StaleUnpaid }>('/orders/stale-unpaid');
        if (alive && res.data?.data) setData(res.data.data);
      } catch {
        // IM LẶNG có chủ ý: đây là dải cảnh báo phụ, mất mạng một nhịp mà bật toast lỗi mỗi
        // phút trên mọi máy là ồn hơn chính thứ nó báo. Giữ nguyên dữ liệu nhịp trước.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), STALE_UNPAID_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return data;
}

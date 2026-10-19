// Dải "KHÁCH GỌI BẰNG QR" (2026-10-19) — phần lấy dữ liệu, dùng chung cho màn Order và màn Bếp.
//
// Chủ quán chốt 2026-10-19: lượt gọi món QR trước chỉ hiện ở màn Bếp, mà người phải ra bàn xác
// nhận là nhân viên ORDER. Giờ dải nằm ở cả hai màn, nhưng CHỈ màn Order duyệt được.
//
// ── Vì sao là một STORE chứ không phải mỗi chỗ tự poll ──
// Màn Bếp vốn đã kéo `/table-requests/pending` trong nhịp poll 2 giây của nó (đi chung với
// `/orders`, xem KitchenPage `refresh`). Dải ở App mà tự poll thêm thì máy bếp gọi endpoint này
// HAI lần mỗi nhịp cho cùng một dữ liệu. Nên:
//   - đứng ở màn Bếp: KitchenPage `publish()` kết quả của nó vào đây, dải chỉ ĐỌC;
//   - đứng ở màn Order: hook tự poll (`poll=true`) vì màn Order không có nhịp nào kéo thứ này.
// Cùng khuôn `kitchenPendingStore` của badge nav.

import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api.ts';
import type { PendingPayload } from './kds-guest-cards.ts';

/** 3 giây: khách vừa bấm gửi là đứng nhìn điện thoại chờ — chậm hơn nữa là họ bấm gửi lại. */
const GUEST_PENDING_POLL_MS = 3_000;

let current: PendingPayload | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export const guestPendingStore = {
  get: (): PendingPayload | null => current,
  publish(next: PendingPayload | null): void {
    current = next;
    emit();
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  /** Kéo lại NGAY — gọi sau khi duyệt / bỏ / nghe để chip biến mất luôn, không đợi nhịp kế. */
  async reload(): Promise<void> {
    try {
      const res = await api.get<{ data: PendingPayload }>('/table-requests/pending');
      guestPendingStore.publish(res.data?.data ?? null);
    } catch {
      // IM LẶNG có chủ ý: dải phụ, mất mạng một nhịp thì giữ dữ liệu cũ, nhịp sau tự đúng lại.
    }
  },
};

/**
 * `poll=true` → hook tự kéo mỗi 3 giây (màn Order). `false` → chỉ đọc thứ người khác publish
 * (màn Bếp). Hook KHÔNG xoá dữ liệu khi tắt poll: chuyển từ Order sang Bếp thì dải vẫn giữ chip
 * cho tới nhịp 2 giây đầu của bếp, thay vì nháy mất rồi hiện lại.
 */
export function useGuestPending(poll: boolean): PendingPayload | null {
  const data = useSyncExternalStore(guestPendingStore.subscribe, guestPendingStore.get);

  useEffect(() => {
    if (!poll) return;
    void guestPendingStore.reload();
    const timer = window.setInterval(() => void guestPendingStore.reload(), GUEST_PENDING_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void guestPendingStore.reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  return data;
}

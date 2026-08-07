// Cửa sổ thời gian của màn đơn hàng online: ai xem được đơn đặt cách đây bao lâu.
//
// Chỉ đạo chủ dự án 2026-08-06: order + bếp chỉ xem đơn đặt trong vòng 14h; admin xem hết và
// có bộ lọc thời gian riêng.
//
// Tách thành hàm THUẦN (không đụng `Request`, không đụng DB) vì đây là quyết định QUYỀN —
// cùng lý lẽ với `staffHistoryWindowMs` ở `orders.controller.ts`: controller quyết con số,
// service chỉ nhận số và thực thi. Hàm thuần thì khoá được bằng unit test, không cần dựng
// HTTP hay MySQL.
import { STAFF_ONLINE_WINDOW_HOURS } from '@order/schemas';

const HOUR_MS = 60 * 60 * 1000;

/** Cửa sổ cứng của order + bếp, tính bằng ms. */
export const STAFF_ONLINE_WINDOW_MS = STAFF_ONLINE_WINDOW_HOURS * HOUR_MS;

export type OnlineWindow = {
  /** Tuổi tối đa của đơn được trả về, tính bằng ms. `undefined` = không giới hạn. */
  maxAgeMs: number | undefined;
  /** Cùng con số, tính bằng giờ, để trả thẳng vào `window_hours` của response. */
  windowHours: number | null;
};

/**
 * Chốt cửa sổ cho một lần gọi `GET /admin/online-orders`.
 *
 * - order/bếp: LUÔN bị chặn ở 14h. Gửi `?hours=720` cũng chỉ nhận 14h — bộ lọc là quyền của
 *   admin, không phải đường vòng để nhân viên tự nới. Gửi `?hours=2` thì được hẹp hơn: hẹp
 *   hơn thì không lộ thêm gì, và nhân viên hay muốn chỉ nhìn ca đang trực.
 * - admin: theo đúng `hours` gửi lên; không gửi = không giới hạn.
 *
 * `role` nhận `null` (user không rõ role) → coi như nhân viên: mặc định phải là cái CHẶT hơn.
 */
export function resolveOnlineWindow(
  role: 'admin' | 'order' | 'kitchen' | null,
  requestedHours: number | undefined,
): OnlineWindow {
  const requestedMs = requestedHours === undefined ? undefined : requestedHours * HOUR_MS;

  if (role === 'admin') {
    return requestedMs === undefined
      ? { maxAgeMs: undefined, windowHours: null }
      : { maxAgeMs: requestedMs, windowHours: requestedHours! };
  }

  const maxAgeMs =
    requestedMs === undefined ? STAFF_ONLINE_WINDOW_MS : Math.min(requestedMs, STAFF_ONLINE_WINDOW_MS);
  return { maxAgeMs, windowHours: maxAgeMs / HOUR_MS };
}

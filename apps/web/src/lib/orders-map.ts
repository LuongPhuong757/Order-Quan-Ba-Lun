// Logic thuần của bản đồ tổng quan đơn online (2026-08-07): đơn nào lên được bản đồ, và một đơn
// mang màu gì.
//
// Tách khỏi `components/OrdersMap.tsx` vì file đó `import 'leaflet'` — kéo cả thư viện bản đồ vào
// test chỉ để kiểm hai hàm thuần là chậm và giòn. Đây cũng là quy ước sẵn có của apps/web: mọi
// logic có thể sai đều nằm trong `lib/` và có test cạnh nó (xem `fulfillment.ts`, `queue-clock.ts`).
import type { AdminOnlineOrderRow } from '@order/schemas';
import { fulfillmentView } from './fulfillment.ts';
import { C } from './online-ui.ts';

/**
 * Chặng → màu chấm, theo đúng trình tự việc thật ở quán: chờ duyệt → đang nấu → xong chờ giao →
 * đang trên đường → xong.
 *
 * Mượn đúng bảng màu của màn đơn (`online-ui.ts`) chứ không chọn màu mới: chấm trên bản đồ và chip
 * trên card phải nói cùng một nghĩa, nếu không nhân viên phải học hai bảng màu cho một trạng thái.
 * Màu "Đã xong, chờ giao" là màu đáng chú ý nhất — đó là nhóm đơn đi gom một chuyến ship.
 */
export const MAP_STAGES = [
  { key: 'WAITING', label: 'Chờ duyệt', color: C.warn },
  { key: 'KITCHEN', label: 'Đang chuẩn bị', color: C.deliveryText },
  { key: 'READY', label: 'Đã xong, chờ giao', color: C.connected },
  { key: 'SHIPPED', label: 'Đang giao', color: C.pickupText },
  { key: 'DONE', label: 'Đã nhận / đã xong', color: C.muted },
] as const;

export type MapStageKey = (typeof MAP_STAGES)[number]['key'];

export const MAP_STAGE_COLOR: Record<MapStageKey, string> = Object.fromEntries(
  MAP_STAGES.map((s) => [s.key, s.color]),
) as Record<MapStageKey, string>;

export const MAP_STAGE_LABEL: Record<MapStageKey, string> = Object.fromEntries(
  MAP_STAGES.map((s) => [s.key, s.label]),
) as Record<MapStageKey, string>;

/**
 * Chặng của một đơn, nhìn từ bản đồ.
 *
 * Chặng sau `WAITING` suy ra từ `fulfillmentView` — KHÔNG chép lại luật "bếp xong là gì" ở đây.
 * Hai bản sao của luật đó sẽ trôi khỏi nhau, và bản ít người xem hơn (bản đồ) sẽ là bản sai.
 */
export function stageOf(
  row: Pick<
    AdminOnlineOrderRow,
    'status' | 'fulfillment_type' | 'item_state_counts' | 'shipped_at_ms' | 'received_at_ms'
  >,
): MapStageKey {
  if (row.status === 'WAITING') return 'WAITING';
  // REJECTED / CANCELLED_BY_CUSTOMER lọt tới đây khi đang mở tab tra cứu tương ứng — vẫn vẽ chấm,
  // nhưng bằng màu "đã xong" vì không còn việc gì phải đi giao.
  if (row.status !== 'CONFIRMED') return 'DONE';
  const v = fulfillmentView(row);
  if (v.step === 'RECEIVED') return 'DONE';
  if (v.step === 'SHIPPED') return 'SHIPPED';
  return v.step === 'READY' ? 'READY' : 'KITCHEN';
}

/**
 * Toạ độ vẽ được của một đơn, hoặc `null` nếu đơn không lên bản đồ.
 *
 * Hai chốt chặn, cả hai đều từng là bug thật ở chỗ khác trong repo:
 *  - Cột DB là `decimal` nên BE trả về CHUỖI (xem `AdminOnlineOrderRow`). Chuỗi rác qua `Number()`
 *    cho `NaN`, mà `NaN` đưa vào Leaflet là bản đồ nhảy ra giữa đại dương — nên lọc bằng
 *    `Number.isFinite`, không phải `!== null`.
 *  - Chuỗi rỗng: `Number('')` là `0`, một toạ độ HỢP LỆ (ngoài khơi châu Phi). Không chặn riêng thì
 *    một đơn thiếu dữ liệu hiện thành chấm ở giữa Đại Tây Dương và kéo khung bản đồ theo nó.
 */
export function coordsOf(
  row: Pick<AdminOnlineOrderRow, 'fulfillment_type' | 'customer_lat' | 'customer_lng'>,
): [number, number] | null {
  if (row.fulfillment_type !== 'DELIVERY') return null;
  if (row.customer_lat === null || row.customer_lng === null) return null;
  if (row.customer_lat.trim() === '' || row.customer_lng.trim() === '') return null;
  const lat = Number(row.customer_lat);
  const lng = Number(row.customer_lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

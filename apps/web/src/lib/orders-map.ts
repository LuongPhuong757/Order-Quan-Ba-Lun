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

/**
 * Khoảng cách (pixel màn hình) mà dưới nó hai chấm coi như CHỒNG NHAU (2026-08-11).
 *
 * Chấm có bán kính 10px + viền, nên hai tâm cách nhau dưới ~26px là hai hình tròn dính vào nhau —
 * mắt đọc thành một. Đây là con số ĐO TRÊN MÀN HÌNH chứ không phải mét: cùng 30m thật, ở zoom 19
 * là hai chấm rời, ở zoom 10 là một. Gộp theo mét sẽ gộp sai ở một trong hai đầu.
 */
export const CLUSTER_RADIUS_PX = 26;

export type ClusterInput<T> = { item: T; pos: [number, number] };

export type Cluster<T> = {
  /** Tâm cụm = trung bình các điểm thành viên, tính trong hệ pixel rồi trả lại lat/lng. */
  pos: [number, number];
  items: T[];
};

/**
 * Gộp các điểm nằm đè lên nhau ở mức zoom hiện tại thành cụm (2026-08-11).
 *
 * VIỆC NÓ GIẢI QUYẾT: 8 đơn đặt từ cùng một chỗ (lệch nhau 10–30m) vẽ ra 8 chấm chồng khít — màn
 * hình nói "1 đơn" trong khi danh sách nói 8. Nhân viên tin vào cái họ nhìn thấy. Có gộp thì chỗ
 * đó thành MỘT chấm mang số "8": vẫn là một hình tròn, nhưng nó tự khai ra nó là mấy đơn.
 *
 * Thuật toán: quét tuyến tính, mỗi điểm hoặc nhập vào cụm đầu tiên có tâm nằm trong `radiusPx`,
 * hoặc mở cụm mới. KHÔNG phải k-means và không cần: đầu vào là vài chục tới vài trăm đơn, và tiêu
 * chí duy nhất ở đây là "có đè lên nhau trên màn hình không".
 *
 * `project` / `unproject` do người gọi đưa vào (Leaflet `map.project` ở zoom hiện tại) — nhờ vậy
 * hàm này không đụng tới Leaflet và test được bằng một phép chiếu phẳng.
 */
export function clusterPoints<T>(
  points: ClusterInput<T>[],
  project: (pos: [number, number]) => { x: number; y: number },
  unproject: (pt: { x: number; y: number }) => [number, number],
  radiusPx: number = CLUSTER_RADIUS_PX,
): Cluster<T>[] {
  const acc: { x: number; y: number; sumX: number; sumY: number; items: T[] }[] = [];
  const r2 = radiusPx * radiusPx;

  for (const p of points) {
    const pt = project(p.pos);
    let joined = false;
    for (const c of acc) {
      const dx = c.x - pt.x;
      const dy = c.y - pt.y;
      if (dx * dx + dy * dy <= r2) {
        c.items.push(p.item);
        c.sumX += pt.x;
        c.sumY += pt.y;
        // Tâm trôi theo thành viên mới: cụm bám vào chỗ đông đơn nhất, không bám vào đơn nào tình
        // cờ được duyệt trước.
        c.x = c.sumX / c.items.length;
        c.y = c.sumY / c.items.length;
        joined = true;
        break;
      }
    }
    if (!joined) acc.push({ x: pt.x, y: pt.y, sumX: pt.x, sumY: pt.y, items: [p.item] });
  }

  return acc.map((c) => ({ pos: unproject({ x: c.x, y: c.y }), items: c.items }));
}

/**
 * Chặng của cả một cụm: cụm thuần một chặng thì mang đúng chặng đó, cụm pha tạp thì `null`.
 *
 * Không bịa ra "chặng đại diện" cho cụm pha tạp. Một chấm vàng ghi "5" mà bên trong có 2 đơn đã
 * xong chờ giao là nói dối đúng thứ mà bảng màu này dùng để quyết định: đi giao chuyến nào bây giờ.
 * Cụm pha tạp vẽ màu trung tính, chi tiết từng chặng nằm ở tooltip.
 */
export function clusterStage(stages: MapStageKey[]): MapStageKey | null {
  if (stages.length === 0) return null;
  const first = stages[0]!;
  return stages.every((s) => s === first) ? first : null;
}

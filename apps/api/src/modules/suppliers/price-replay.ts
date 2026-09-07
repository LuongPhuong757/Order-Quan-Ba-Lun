// Phát lại chuỗi giá của MỘT nhà cung cấp. THUẦN, không DB — cùng lệ với `purchase-units.ts`.
//
// Sinh ra cho chức năng sửa phiếu đã nhập (2026-09-07). Mỗi dòng phiếu mang hai ảnh chụp:
// "giá lần trước" và "% biến động so với lần trước". Chúng được tính MỘT LẦN lúc nhập, so với
// bảng giá tham chiếu tại thời điểm đó — nên sửa một phiếu cũ là làm sai luôn hai con số đó ở
// những phiếu SAU nó, và cảnh báo đổi giá (M3.D-22) đứng trên đúng hai con số này.
//
// Hàm ở đây tính lại cả chuỗi từ đầu, nên kết quả không phụ thuộc vào thứ tự ai ngồi nhập.
import { alertLevel, packSizeChanged, priceChangePct } from './purchase-units.js';
import type { AlertLevel } from './purchase-units.js';

/** Một dòng phiếu, đúng những cột mà phép phát lại cần đọc. */
export type ReplayLine = {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  /** Đơn vị gốc của nguyên liệu, ảnh chụp lúc nhập. */
  base_unit: string;
  purchase_unit: string;
  qty_base_per_unit: string;
  unit_price: number;
  unit_price_base: string;
  /** Người đã bấm đồng ý mức giá này ở lần nhập/sửa trước, nếu có. */
  price_approved_by_user_id: string | null;
};

/** Một phiếu ĐÃ DUYỆT trong chuỗi. Caller phải sắp sẵn theo ngày giao rồi `created_at`. */
export type ReplayDelivery = {
  id: string;
  delivery_date: string;
  lines: ReplayLine[];
};

/** Giá tham chiếu của một mặt hàng ở NCC này — đúng các cột của `supplier_items`. */
export type PriceRef = {
  purchase_unit: string;
  qty_base_per_unit: string;
  last_unit_price: number;
  last_unit_price_base: string;
  last_delivery_date: string;
};

/** Bốn cột cần ghi lại lên một dòng phiếu. */
export type LinePatch = {
  prev_unit_price_base: string | null;
  price_change_pct: string | null;
  prev_qty_base_per_unit: string | null;
  price_approved_by_user_id: string | null;
};

/** Một dòng lệch giá quá ngưỡng — đúng những gì popup duyệt giá cần hiện (M3.D-21). */
export type ReplayPriceChange = {
  ingredient_id: string;
  ingredient_name: string;
  base_unit: string;
  purchase_unit: string;
  prev_unit_price: number;
  unit_price: number;
  prev_unit_price_base: string;
  unit_price_base: string;
  price_change_pct: string;
  level: AlertLevel;
  pack_size_changed: boolean;
  prev_qty_base_per_unit: string | null;
  qty_base_per_unit: string;
};

export type ReplayResult = {
  /** id dòng → bốn cột phải ghi lại. */
  line_patches: Map<string, LinePatch>;
  /** Trạng thái CUỐI chuỗi → bảng giá `supplier_items` dựng lại từ đây. Mặt hàng không còn xuất
   *  hiện trong phiếu nào sẽ vắng mặt ở đây, và caller phải XOÁ dòng bảng giá của nó: để lại là
   *  màn nhập vẫn điền sẵn "giá lần trước" của một lần giao không còn tồn tại. */
  refs: Map<string, PriceRef>;
  /** id phiếu → các dòng lệch giá quá ngưỡng của phiếu đó. */
  flagged: Map<string, ReplayPriceChange[]>;
};

/** Phát lại cả chuỗi.
 *
 * `actor_id` dùng để đóng dấu người duyệt lên dòng lệch giá chưa có dấu. Dấu này CHỈ nằm trên
 * dòng thật sự phải duyệt: dòng hết lệch giá thì xoá dấu, vì cột đó nghĩa là "đã có người cân
 * nhắc mức giá này" — để lại trên một dòng không còn gì để cân nhắc là làm nó mất nghĩa.
 */
export function replayPrices(
  chain: ReplayDelivery[],
  thresholds: Map<string, number | null>,
  actor_id: string,
): ReplayResult {
  const refs = new Map<string, PriceRef>();
  const line_patches = new Map<string, LinePatch>();
  const flagged = new Map<string, ReplayPriceChange[]>();

  for (const d of chain) {
    for (const l of d.lines) {
      const prev = refs.get(l.ingredient_id) ?? null;
      const prev_base = prev ? Number(prev.last_unit_price_base) : null;
      const pct = priceChangePct(prev_base, Number(l.unit_price_base));
      const level = alertLevel(pct, thresholds.get(l.ingredient_id) ?? null);

      line_patches.set(l.id, {
        prev_unit_price_base: prev?.last_unit_price_base ?? null,
        price_change_pct: pct === null ? null : String(pct),
        prev_qty_base_per_unit: prev?.qty_base_per_unit ?? null,
        price_approved_by_user_id: level === 'none' ? null : (l.price_approved_by_user_id ?? actor_id),
      });

      // `prev` phải có mới xếp vào danh sách chờ duyệt: lần nhập ĐẦU của một mặt hàng không có gì
      // để so, `pct` là null và `alertLevel` trả 'none' — nhưng viết rõ điều kiện ra đây để
      // người đọc không phải suy ngược qua hai hàm mới biết vì sao lần đầu không bị hỏi (M3.D-25).
      if (level !== 'none' && prev) {
        const list = flagged.get(d.id) ?? [];
        list.push({
          ingredient_id: l.ingredient_id,
          ingredient_name: l.ingredient_name,
          base_unit: l.base_unit,
          purchase_unit: l.purchase_unit,
          prev_unit_price: prev.last_unit_price,
          unit_price: l.unit_price,
          prev_unit_price_base: prev.last_unit_price_base,
          unit_price_base: l.unit_price_base,
          price_change_pct: String(pct),
          level,
          pack_size_changed: packSizeChanged(
            Number(prev.qty_base_per_unit),
            Number(l.qty_base_per_unit),
          ),
          prev_qty_base_per_unit: prev.qty_base_per_unit,
          qty_base_per_unit: l.qty_base_per_unit,
        });
        flagged.set(d.id, list);
      }

      // Mốc tiến theo chuỗi. Không cần so ngày như `applyItemReferences` vì chuỗi đã sắp theo
      // ngày giao — dòng đang xét luôn là lần giao mới nhất tính tới đây.
      refs.set(l.ingredient_id, {
        purchase_unit: l.purchase_unit,
        qty_base_per_unit: l.qty_base_per_unit,
        last_unit_price: l.unit_price,
        last_unit_price_base: l.unit_price_base,
        last_delivery_date: d.delivery_date,
      });
    }
  }

  return { line_patches, refs, flagged };
}

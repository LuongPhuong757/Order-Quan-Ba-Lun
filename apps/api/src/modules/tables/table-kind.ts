// Module thuần: không import gì từ @nestjs/* hay typeorm — chỉ chứa quy ước đặt tên bàn.
//
// Quy ước code bàn là CHỮ THƯỜNG `ban-NN` / `mang-ve-NN` / `ship-NN`. Văn xuôi
// `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` §7 ghi `SHIP-NN`/`TAKE-NN` — đó là mô tả
// viết trước khi code hoá, KHÔNG phải quy ước thật. Thấy chuỗi chữ hoa trong code mới =
// dấu hiệu đọc nhầm spec.
//
// Cột `restaurant_tables.code` giới hạn `varchar(16)` — `mang-ve-` đã 8 ký tự, số thứ tự
// tối đa an toàn là 8 chữ số (xem `restaurant-table.entity.ts`).
//
// Trước phase 9, `KIND_FORMAT` là const CỤC BỘ trong `tables.controller.ts` — tách ra đây
// để bàn tự tạo (plan 09-06, cấp bàn cho đơn online) và bàn tạo tay qua `/tables` dùng
// đúng 1 bản, không phân kỳ.

export const TABLE_KINDS = ['dine-in', 'takeaway', 'delivery'] as const;
export type TableKind = (typeof TABLE_KINDS)[number];

/** Mapping kind → format code + name.
 * - dine-in   → ban-01, ban-02, ... | "Bàn 01", "Bàn 02"
 * - takeaway  → mang-ve-01, ... | "Mang về 01", ...
 * - delivery  → ship-01, ... | "Ship 01", ...
 */
export const KIND_FORMAT: Record<string, { codePrefix: string; namePrefix: string }> = {
  'dine-in':  { codePrefix: 'ban',     namePrefix: 'Bàn' },
  'takeaway': { codePrefix: 'mang-ve', namePrefix: 'Mang về' },
  'delivery': { codePrefix: 'ship',    namePrefix: 'Ship' },
};

/** Sinh code bàn theo kind + số thứ tự.
 *
 * `width` mặc định 2 (đúng khuôn `nextTableCode`/bàn tự tạo — luôn pad tối thiểu 2 chữ
 * số, tự nới rộng khi số ≥ 100). `bulkCreate` (tạo tay hàng loạt) truyền `width` riêng
 * theo `to_num` của cả batch để GIỮ NGUYÊN hành vi cũ (không đổi code/name sinh ra).
 */
export function formatTableCode(kind: string, num: number, width = 2): string {
  const fmt = KIND_FORMAT[kind];
  if (!fmt) throw new Error(`kind không hợp lệ: ${kind}`);
  const numStr = String(num).padStart(width, '0');
  return `${fmt.codePrefix}-${numStr}`;
}

/** Sinh tên hiển thị bàn theo kind + số thứ tự. Xem `formatTableCode` về `width`. */
export function formatTableName(kind: string, num: number, width = 2): string {
  const fmt = KIND_FORMAT[kind];
  if (!fmt) throw new Error(`kind không hợp lệ: ${kind}`);
  const numStr = String(num).padStart(width, '0');
  return `${fmt.namePrefix} ${numStr}`;
}

/** M2.D-14 — map duy nhất trong repo giữa fulfillment_type của đơn online và kind bàn:
 * PICKUP → 'takeaway' (khách tự đến lấy), DELIVERY → 'delivery' (giao tận nơi). */
export function kindForFulfillment(ft: 'PICKUP' | 'DELIVERY'): TableKind {
  return ft === 'PICKUP' ? 'takeaway' : 'delivery';
}

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

/** Số bàn rút từ mã: lấy MỌI chữ số rồi đổi ra số (`ban-05` → 5, `B5` → 5, `ban-005` → 5).
 * Cùng cách `matchTableByInput` (public/table-input.ts) nhận số bàn khách gõ — hai bàn cùng
 * loại mà cùng số thì khách gõ "5" sẽ không biết là bàn nào, nên coi là TRÙNG. Không có chữ
 * số → null. */
export function tableNumberOf(code: string): number | null {
  const digits = code.replace(/\D/g, '');
  if (digits === '') return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

export type ExistingTable = { id: string; code: string; kind: string; is_active: boolean };

export type BulkPlan = {
  /** Số chưa có bàn nào cùng loại → tạo mới. */
  create: { num: number; code: string; name: string }[];
  /** Bàn đã xoá (ẩn) trùng số → hiện lại, không tạo bàn thứ hai. */
  reopen: ExistingTable[];
  /** Số đã có bàn đang dùng → bỏ qua. */
  skippedNums: number[];
};

/** Lên kế hoạch tạo bàn hàng loạt — CHỈ tạo số còn thiếu (chủ quán chốt 2026-11-12).
 *
 * Lỗi cũ: so trùng bằng CHUỖI mã, mà độ rộng số 0 lại tính theo `to_num` của từng lần
 * (1–10 ra `ban-01`, 1–120 ra `ban-001`) → lần sau tạo trùng "Bàn 01" và "Bàn 001". Giờ so
 * bằng GIÁ TRỊ SỐ trong cùng loại, và luôn pad tối thiểu 2 (giống `nextTableCode`).
 *
 * Bàn đã xoá chỉ là `is_active=false`, mã vẫn giữ (UNIQUE) → không tạo lại được mã đó.
 * Trước đây bị "bỏ qua" âm thầm: chủ quán tạo lại mà bàn không hiện. Giờ mở lại bàn cũ —
 * với người dùng, bàn đã xoá là "chưa có". */
export function planBulkTables(
  kind: string,
  fromNum: number,
  toNum: number,
  existing: readonly ExistingTable[],
): BulkPlan {
  const active = new Set<number>();
  const deleted = new Map<number, ExistingTable>();
  for (const t of existing) {
    if (t.kind !== kind) continue;
    const n = tableNumberOf(t.code);
    if (n === null) continue;
    if (t.is_active) active.add(n);
    else if (!deleted.has(n)) deleted.set(n, t);
  }
  const plan: BulkPlan = { create: [], reopen: [], skippedNums: [] };
  for (let n = fromNum; n <= toNum; n++) {
    if (active.has(n)) plan.skippedNums.push(n);
    else if (deleted.has(n)) plan.reopen.push(deleted.get(n)!);
    else plan.create.push({ num: n, code: formatTableCode(kind, n), name: formatTableName(kind, n) });
  }
  return plan;
}

/** M2.D-14 — map duy nhất trong repo giữa fulfillment_type của đơn online và kind bàn:
 * PICKUP → 'takeaway' (khách tự đến lấy), DELIVERY → 'delivery' (giao tận nơi). */
export function kindForFulfillment(ft: 'PICKUP' | 'DELIVERY'): TableKind {
  return ft === 'PICKUP' ? 'takeaway' : 'delivery';
}

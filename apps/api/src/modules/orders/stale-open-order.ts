// "BÀN TREO" — bàn trông TRỐNG trên sơ đồ nhưng trong DB vẫn là đơn đang mở (2026-09-09).
//
// Module THUẦN: không import gì từ @nestjs/* hay typeorm, để test được mà không dựng app/DB
// (cùng lệ với `checkout-total.ts`, `dish-sales.ts`, `public/store-status.ts`).
//
// ── BUG GỐC ───────────────────────────────────────────────────────────────────────────
// Chạm vào bàn là `getOrCreateOpenOrder` tạo đơn THẬT ngay (GET /orders/by-table/:id), nhân
// viên thoát ra mà chưa gọi món thì đơn rỗng đó vẫn `closed_at IS NULL`. Sơ đồ bàn ẨN đơn
// rỗng (`listOpenOrders` lọc phantom) nên bàn trông trống, nhưng lần sau vào lại thì dùng
// lại ĐÚNG dòng cũ và giữ nguyên `opened_at`. Lịch sử gom nhóm theo NGÀY VÀO ĂN
// (`HistoryPage`: `vnDayIso(o.opened_at)`) → bill thu hôm nay bị xếp sang ngày hôm trước,
// kèm cả tên nhân viên mở của lượt cũ. Bộ lọc ngày lại dùng `COALESCE(closed_at, opened_at)`
// nên cùng một bill mà hai chỗ nói hai ngày khác nhau.

/** Ngưỡng coi một đơn đang mở là bàn treo: lâu hơn khoảng này mà KHÔNG còn món nào chưa huỷ
 * thì lượt khách tiếp theo được tính là lượt MỚI.
 *
 * Mốc là 4 GIỜ KHÔNG CÓ MÓN, KHÔNG phải mốc nửa đêm (chủ quán chốt 2026-09-09): bàn tap mở
 * lúc trưa mà tối khách mới vào cũng phải tính giờ vào mới, không chỉ khi qua ngày. */
export const STALE_OPEN_ORDER_MS = 4 * 60 * 60 * 1000;

/** Chỗ chạy SQL thô — `DataSource` (ngoài transaction) và `EntityManager` (trong transaction)
 * đều khớp interface này, nên đo được bàn treo ở cả hai đường mà không nhân đôi câu SQL. */
export type SqlRunner = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/** Ảnh đo một đơn đang mở, để quyết định có phải bàn treo không.
 * - `alive` — số món CHƯA huỷ. 0 = bàn trông trống trên sơ đồ.
 * - `total` — số món kể cả đã huỷ. 0 = chưa từng gọi gì (chỉ tap mở drawer rồi thoát).
 * - `idle_since` — mốc "từ đó tới giờ không có món nào": lần cập nhật món gần nhất, hoặc
 *   `opened_at` nếu đơn chưa từng có món nào. */
export type OpenOrderProbe = { alive: number; total: number; idle_since: number };

/** `nowMs` LUÔN truyền vào, không đọc giờ hệ thống bên trong — cùng lệ với `store-status.ts`,
 * để test được ngưỡng mà không cần fake timer.
 *
 * `alive > 0` là chốt chặn quan trọng nhất: bàn còn món chưa huỷ thì dù mở 2 ngày (khách ngồi
 * lâu, quên thu tiền qua đêm) vẫn TUYỆT ĐỐI không tính lại giờ vào — đó là đơn thật đang chờ
 * thanh toán và sơ đồ bàn đang hiện nó. */
export function isStaleOpenOrder(p: OpenOrderProbe, nowMs: number): boolean {
  return p.alive === 0 && nowMs - p.idle_since > STALE_OPEN_ORDER_MS;
}

/** Đo 1 đơn đang mở bằng ĐÚNG 1 câu SQL (không lock, không kéo dòng món nào về).
 *
 * `UNIX_TIMESTAMP` đúng giờ vì session MySQL bị ép UTC (`timezone: 'Z'` ở `data-source.ts`) —
 * cùng khuôn với query thống kê trong `orders.service.ts#stats`. */
export async function probeOpenOrder(
  runner: SqlRunner,
  order: { id: string; opened_at: number },
): Promise<OpenOrderProbe> {
  const rows = (await runner.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(oi.state <> 'CANCELLED'), 0) AS alive,
            UNIX_TIMESTAMP(MAX(oi.updated_at)) * 1000 AS last_ms
       FROM order_items oi
      WHERE oi.order_id = ?`,
    [order.id],
  )) as Array<{ total: string | number; alive: string | number; last_ms: string | number | null }>;
  const r = rows[0];
  // mysql2 trả COUNT/SUM dạng STRING (bigint/decimal) → Number() hết, đừng so sánh trực tiếp.
  const last = r?.last_ms == null ? 0 : Number(r.last_ms);
  return {
    alive: Number(r?.alive ?? 0),
    total: Number(r?.total ?? 0),
    // Đơn chưa từng có món → mốc rảnh là chính giờ mở đơn.
    idle_since: last > 0 ? last : order.opened_at,
  };
}

/** "4 giờ 10 phút" — cho câu nhật ký bàn, làm tròn xuống phút. */
export function fmtIdleDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} phút`;
  if (m === 0) return `${h} giờ`;
  return `${h} giờ ${m} phút`;
}

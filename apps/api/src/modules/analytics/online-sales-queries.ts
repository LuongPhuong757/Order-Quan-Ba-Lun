// SQL của khối "Đơn online & doanh thu" ở tab Thống kê (2026-11-11). Chỉ ĐỌC, chỉ admin gọi.
//
// ĐỊNH NGHĨA chủ quán đã chốt — đừng đổi lẻ một chỗ:
//   - Đơn THÀNH CÔNG = đơn online đã duyệt (có `order_id`) VÀ đơn đó ĐÃ THU tiền (`PAID_SQL`).
//     Đơn nợ chưa trả (is_paid = 0 + debt_at) KHÔNG tính — tiền chưa vào.
//   - Doanh thu = tổng thu từng đơn thành công, CÓ ship (`ORDER_TOTAL_SQL`), tính theo NGÀY THU
//     TIỀN (`MONEY_AT_SQL`). Ba hằng này lấy thẳng từ `orders.service.ts` để doanh thu online
//     KHỚP màn Báo cáo; viết lại công thức ở đây là dựng nguồn sự thật thứ hai.
//   - Đơn ĐẶT / TỪ CHỐI / KHÁCH HUỶ = đếm `online_order_requests` theo lúc khách bấm đặt
//     (`submitted_at`) — đó là câu hỏi "khách đặt bao nhiêu đơn", không phải câu hỏi về tiền.
//
// Cột DATETIME (`submitted_at`, `closed_at`, `debt_paid_at`) luôn so với `new Date(ms)`, KHÔNG
// đẩy số ms vào: MySQL ép kiểu ngầm số với DATETIME và điều kiện thành luôn đúng (bẫy đã gặp).
import type { DataSource } from 'typeorm';
import { MONEY_AT_SQL, ORDER_TOTAL_SQL, PAID_SQL } from '../orders/orders.service.js';
import { dayKeysInRange, type Range } from './analytics-queries.js';
import {
  placedCounts,
  prevRange,
  summarizeOnlineSales,
  type OnlineSalesSummary,
  type PlacedCounts,
} from './online-sales.js';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

type Kpis = PlacedCounts & {
  revenue: number;
  success_count: number;
  avg_order_value: number;
  /** Thời gian duyệt TB (giây), chỉ đơn đã được duyệt/từ chối. `null` = chưa có đơn nào. */
  avg_review_seconds: number | null;
};

export type OnlineOrdersStats = {
  kpis: Kpis;
  /**
   * Cùng các con số như `kpis` nhưng cho KỲ TRƯỚC — khoảng cùng độ dài ngay trước khoảng đang
   * xem (`prevRange`). FE dùng để ghi "▲12%" / "▼5%" dưới mỗi thẻ (chủ quán yêu cầu 2026-11-11).
   * Tính bằng ĐÚNG các câu SQL + hàm gộp của `kpis` — viết câu riêng cho kỳ trước là hai định
   * nghĩa "đơn thành công" có thể trôi lệch nhau.
   */
  prev_kpis: Kpis;
  by_day: OnlineSalesSummary['by_day'];
  by_hour: OnlineSalesSummary['by_hour'];
  top_items: Array<{ name: string; qty: number; revenue: number }>;
};

/**
 * Ba câu SQL làm ra hàng chỉ số (đơn thành công, đếm theo trạng thái, thời gian duyệt) cho MỘT
 * khoảng. Tách thành hàm để chạy được cho cả kỳ này và kỳ trước. Trả kèm `successRows` vì kỳ
 * này còn cần chúng để gộp theo ngày/giờ — tránh truy vấn lại.
 */
async function kpiParts(ds: DataSource, range: Range) {
  const from = new Date(range.from_ms);
  const to = new Date(range.to_ms);
  const [successRaw, statusRows, reviewRows] = await Promise.all([
    // Một dòng mỗi đơn thành công. Gộp ngày/giờ làm trong JS (`summarizeOnlineSales`) vì cần
    // giờ VN — xem quy ước (1) ở đầu `analytics-queries.ts`.
    ds.query(
      `SELECT UNIX_TIMESTAMP(${MONEY_AT_SQL}) * 1000 AS money_ms,
              UNIX_TIMESTAMP(r.submitted_at) * 1000 AS submitted_ms,
              ${ORDER_TOTAL_SQL}                    AS total
         FROM online_order_requests r
         JOIN orders o ON o.id = r.order_id
        WHERE ${PAID_SQL} AND ${MONEY_AT_SQL} >= ? AND ${MONEY_AT_SQL} < ?`,
      [from, to],
    ) as Promise<Array<Record<string, unknown>>>,
    ds.query(
      `SELECT status, COUNT(*) AS n
         FROM online_order_requests
        WHERE submitted_at >= ? AND submitted_at < ?
        GROUP BY status`,
      [from, to],
    ) as Promise<Array<Record<string, unknown>>>,
    // Chỉ đơn ĐÃ có người xử lý: đơn chờ chưa có `reviewed_at`, đơn khách tự huỷ không phải
    // việc của nhân viên — trộn vào là kéo lệch con số "quán duyệt nhanh hay chậm".
    ds.query(
      `SELECT AVG(TIMESTAMPDIFF(MICROSECOND, submitted_at, reviewed_at)) / 1000000 AS secs,
              COUNT(*) AS n
         FROM online_order_requests
        WHERE status IN ('CONFIRMED', 'REJECTED') AND reviewed_at IS NOT NULL
          AND submitted_at >= ? AND submitted_at < ?`,
      [from, to],
    ) as Promise<Array<Record<string, unknown>>>,
  ]);
  const successRows = successRaw.map((r) => ({
    money_ms: num(r.money_ms),
    submitted_ms: num(r.submitted_ms),
    total: num(r.total),
  }));
  const counts = placedCounts(statusRows.map((r) => ({ status: String(r.status), count: num(r.n) })));
  const review = reviewRows[0];
  return {
    successRows,
    counts,
    avg_review_seconds: num(review?.n) === 0 ? null : Math.round(num(review?.secs)),
  };
}

function toKpis(
  parts: Awaited<ReturnType<typeof kpiParts>>,
  summary: Pick<OnlineSalesSummary, 'revenue' | 'success_count' | 'avg_order_value'>,
): Kpis {
  return {
    ...parts.counts,
    revenue: summary.revenue,
    success_count: summary.success_count,
    avg_order_value: summary.avg_order_value,
    avg_review_seconds: parts.avg_review_seconds,
  };
}

export async function onlineOrdersStats(
  ds: DataSource,
  range: Range,
  nowMs: number,
): Promise<OnlineOrdersStats> {
  const from = new Date(range.from_ms);
  const to = new Date(range.to_ms);
  const prev = prevRange(range);

  const [cur, before, topRows] = await Promise.all([
    kpiParts(ds, range),
    kpiParts(ds, prev),
    // Món bán chạy: món SERVED của đơn online đã thu trong khoảng (theo mốc thu tiền). Ghi chú
    // ("lấy bát") không phải hàng bán — cùng lý do loại `is_note` ở `OrdersService.stats`.
    ds.query(
      `SELECT i.menu_item_name AS name,
              SUM(i.qty) AS qty,
              SUM(i.menu_item_price * i.qty) AS revenue
         FROM online_order_requests r
         JOIN orders o ON o.id = r.order_id
         JOIN order_items i ON i.order_id = o.id
        WHERE ${PAID_SQL} AND ${MONEY_AT_SQL} >= ? AND ${MONEY_AT_SQL} < ?
          AND i.state = 'SERVED' AND i.is_note = 0
        GROUP BY i.menu_item_name
        ORDER BY qty DESC, revenue DESC
        LIMIT 10`,
      [from, to],
    ) as Promise<Array<Record<string, unknown>>>,
  ]);

  const summary = summarizeOnlineSales(cur.successRows, dayKeysInRange(range, nowMs));
  // Kỳ trước chỉ cần con số TỔNG — dãy ngày rỗng, `summarizeOnlineSales` vẫn cộng đủ tổng.
  const prevSummary = summarizeOnlineSales(before.successRows, []);

  return {
    kpis: toKpis(cur, summary),
    prev_kpis: toKpis(before, prevSummary),
    by_day: summary.by_day,
    by_hour: summary.by_hour,
    top_items: topRows.map((r) => ({
      name: String(r.name),
      qty: num(r.qty),
      revenue: num(r.revenue),
    })),
  };
}

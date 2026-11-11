// Phần TÍNH THUẦN của khối "Đơn online & doanh thu" ở tab Thống kê (2026-11-11).
//
// Tách khỏi file SQL (`online-sales-queries.ts`) để test được không cần MySQL: SQL chỉ trả về
// dòng thô (mỗi đơn thành công một dòng, đếm theo trạng thái), mọi phép gộp ngày/giờ, ghép đủ
// dãy ngày, tính trung bình và tỉ lệ đều nằm ở đây.
//
// Gộp ngày/giờ làm bằng SỐ HỌC trên epoch ms + offset giờ VN, cùng quy ước (1) ở đầu
// `analytics-queries.ts` — connection ép `timezone: 'Z'` nên DATE()/HOUR() của MySQL là UTC.
import type { Range } from './analytics-queries.js';
import { VN_OFFSET_MS } from './visit-hit.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Một đơn online ĐÃ THU tiền — đúng một dòng mỗi đơn. */
export type SuccessOrderRow = {
  /** Mốc tiền vào (`MONEY_AT_SQL`) — doanh thu và số đơn thành công theo ngày rơi vào ngày này. */
  money_ms: number;
  /** Lúc khách bấm đặt — dùng cho biểu đồ giờ (xếp ca theo lúc khách đặt, không theo lúc thu). */
  submitted_ms: number;
  /** Tổng thu của đơn = món SERVED + ship (`ORDER_TOTAL_SQL`), khớp màn Báo cáo. */
  total: number;
};

export type OnlineSalesSummary = {
  revenue: number;
  success_count: number;
  /** 0 khi chưa có đơn thành công — FE hiện "—" chứ không chia cho 0. */
  avg_order_value: number;
  by_day: Array<{ day: string; success: number; revenue: number }>;
  by_hour: Array<{ hour: number; success: number }>;
};

/** epoch ms → 'YYYY-MM-DD' theo giờ VN. */
export function vnDayKey(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** epoch ms → giờ VN 0..23. */
export function vnHour(ms: number): number {
  const inDay = (((ms + VN_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.floor(inDay / HOUR_MS);
}

/**
 * Gộp các đơn thành công thành con số tổng + dãy theo ngày + 24 ô giờ.
 *
 * `dayKeys` là dãy ngày LIÊN TỤC của khoảng đang xem (từ `dayKeysInRange`) — biểu đồ phải có cả
 * ngày 0 đơn, không thì cột nhảy cóc và người đọc tưởng hôm đó không có trên lịch. Đơn có mốc
 * tiền rơi ngoài dãy (không nên xảy ra vì SQL đã lọc) vẫn cộng vào TỔNG nhưng không vẽ cột.
 */
export function summarizeOnlineSales(
  rows: readonly SuccessOrderRow[],
  dayKeys: readonly string[],
): OnlineSalesSummary {
  const dayMap = new Map<string, { success: number; revenue: number }>();
  for (const k of dayKeys) dayMap.set(k, { success: 0, revenue: 0 });
  const hours = Array.from({ length: 24 }, () => 0);
  let revenue = 0;

  for (const r of rows) {
    const total = Number(r.total) || 0;
    revenue += total;
    const d = dayMap.get(vnDayKey(r.money_ms));
    if (d) dayMap.set(vnDayKey(r.money_ms), { success: d.success + 1, revenue: d.revenue + total });
    hours[vnHour(r.submitted_ms)] += 1;
  }

  const success_count = rows.length;
  return {
    revenue,
    success_count,
    avg_order_value: success_count === 0 ? 0 : Math.round(revenue / success_count),
    by_day: dayKeys.map((day) => ({ day, ...(dayMap.get(day) ?? { success: 0, revenue: 0 }) })),
    by_hour: hours.map((success, hour) => ({ hour, success })),
  };
}

export type PlacedCounts = {
  /** Tổng lượt khách BẤM ĐẶT trong khoảng (theo `submitted_at`), mọi trạng thái. */
  placed_count: number;
  rejected_count: number;
  customer_cancelled_count: number;
  /** % từ chối trên tổng đơn đặt, 1 chữ số lẻ. `null` khi chưa có đơn nào — KHÁC 0%. */
  rejected_pct: number | null;
};

/** Từ dòng `GROUP BY status` → các con số đếm đơn đặt. Trạng thái lạ vẫn được cộng vào tổng. */
export function placedCounts(rows: ReadonlyArray<{ status: string; count: number }>): PlacedCounts {
  const get = (s: string) => rows.find((r) => r.status === s)?.count ?? 0;
  const placed_count = rows.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
  const rejected_count = get('REJECTED');
  return {
    placed_count,
    rejected_count,
    customer_cancelled_count: get('CANCELLED_BY_CUSTOMER'),
    rejected_pct: placed_count === 0 ? null : Math.round((rejected_count / placed_count) * 1000) / 10,
  };
}

/**
 * KỲ TRƯỚC để so sánh ở thẻ chỉ số: khoảng cùng độ dài, kết thúc đúng ở đầu khoảng đang xem.
 * Khoảng đang xem chạy từ đầu ngày tới "bây giờ" (hôm nay chưa hết), nên kỳ trước lấy đúng
 * bấy nhiêu ms lùi lại từ mốc đầu — không làm tròn thành N ngày trọn, vì so 6,6 ngày với 7 ngày
 * trọn là % thay đổi luôn bị kéo tụt chỉ vì "hôm nay chưa hết ngày".
 */
export function prevRange(range: Range): Range {
  const len = range.to_ms - range.from_ms;
  return { from_ms: range.from_ms - len, to_ms: range.from_ms };
}

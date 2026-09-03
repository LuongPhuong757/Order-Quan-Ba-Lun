// Câu truy vấn cho màn thống kê truy cập (chỉ ĐỌC, chỉ admin gọi).
//
// Hai quy ước xuyên suốt file, đừng đổi lẻ một chỗ:
//
// 1) "Ngày" là ngày GIỜ VIỆT NAM. Connection ép `timezone: 'Z'` (data-source.ts) nên
//    DATE()/HOUR() của MySQL trả theo UTC — gộp theo đó thì một ngày bán hàng bị cắt làm hai
//    lúc 7h sáng. Vì vậy mọi phép gộp theo ngày/giờ đều làm bằng SỐ HỌC trên epoch ms:
//    `FLOOR((ms + VN_OFFSET_MS) / 86400000)`. Khuôn này lấy từ `orders.service.ts#stats`
//    (ở đó cộng offset rồi mới lấy phần ngày) — chỉ khác là gộp trong SQL thay vì trong JS,
//    vì bảng thống kê không cần trả từng dòng về app.
//
// 2) mysql2 trả COUNT/SUM dạng STRING. Mọi giá trị đọc ra đều phải qua `num()`, không tin
//    kiểu number (cùng lý do docblock cột decimal ở `online-order-request.entity.ts`).
//
// Bot bị TÁCH khỏi mọi con số về khách (`device <> 'bot'`) nhưng vẫn được đếm riêng — chủ quán
// cần phân biệt "1000 lượt truy cập" với "1000 lượt trong đó 900 là con bot của Google".
import type { DataSource } from 'typeorm';
import { VN_OFFSET_MS, dayKeyIct } from './visit-hit.js';

const DAY_MS = 86_400_000;
const HUMAN = `app = 'shop' AND device <> 'bot'`;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Chỉ số ngày (số ngày kể từ epoch, theo giờ VN) → 'YYYY-MM-DD'. */
function dayIndexToKey(idx: number): string {
  return new Date(idx * DAY_MS).toISOString().slice(0, 10);
}

export type Range = { from_ms: number; to_ms: number };

/**
 * Khoảng thời gian `days` ngày gần nhất, cắt theo ĐẦU NGÀY giờ VN của ngày đầu tiên và hết
 * `nowMs` ở đầu kia — để cột cuối trên biểu đồ là "hôm nay tới giờ", không phải một cửa sổ
 * 24h trôi.
 */
export function rangeForDays(nowMs: number, days: number): Range {
  const todayIdx = Math.floor((nowMs + VN_OFFSET_MS) / DAY_MS);
  const startIdx = todayIdx - (days - 1);
  return { from_ms: startIdx * DAY_MS - VN_OFFSET_MS, to_ms: nowMs + 1 };
}

/** Danh sách day_key liên tục trong khoảng — để biểu đồ có cả những ngày 0 khách. */
export function dayKeysInRange(range: Range, nowMs: number): string[] {
  const startIdx = Math.floor((range.from_ms + VN_OFFSET_MS) / DAY_MS);
  const endIdx = Math.floor((Math.min(range.to_ms, nowMs) + VN_OFFSET_MS) / DAY_MS);
  const out: string[] = [];
  for (let i = startIdx; i <= endIdx; i += 1) out.push(dayIndexToKey(i));
  return out;
}

export type TrafficTotals = {
  sessions: number;
  page_views: number;
  visitors: number;
  avg_duration_sec: number;
  /** % phiên chỉ xem 1 trang rồi đi trong dưới 10 giây. */
  bounce_rate: number;
  bot_sessions: number;
  phones_seen: number;
};

export async function trafficTotals(ds: DataSource, range: Range): Promise<TrafficTotals> {
  const [row] = (await ds.query(
    `SELECT COUNT(*)                                        AS sessions,
            COALESCE(SUM(page_views), 0)                    AS page_views,
            COUNT(DISTINCT ip_hash)                         AS visitors,
            COALESCE(SUM(GREATEST(last_seen_ms - first_seen_ms, 0)), 0) AS duration_ms,
            SUM(CASE WHEN page_views <= 1 AND last_seen_ms - first_seen_ms < 10000
                     THEN 1 ELSE 0 END)                     AS bounces,
            COUNT(DISTINCT customer_phone)                  AS phones_seen
       FROM web_visit_sessions
      WHERE ${HUMAN} AND first_seen_ms >= ? AND first_seen_ms < ?`,
    [range.from_ms, range.to_ms],
  )) as Array<Record<string, unknown>>;

  const [bot] = (await ds.query(
    `SELECT COUNT(*) AS sessions
       FROM web_visit_sessions
      WHERE app = 'shop' AND device = 'bot' AND first_seen_ms >= ? AND first_seen_ms < ?`,
    [range.from_ms, range.to_ms],
  )) as Array<Record<string, unknown>>;

  const sessions = num(row?.sessions);
  return {
    sessions,
    page_views: num(row?.page_views),
    visitors: num(row?.visitors),
    avg_duration_sec: sessions === 0 ? 0 : Math.round(num(row?.duration_ms) / sessions / 1000),
    bounce_rate: sessions === 0 ? 0 : Math.round((num(row?.bounces) / sessions) * 100),
    bot_sessions: num(bot?.sessions),
    phones_seen: num(row?.phones_seen),
  };
}

export type DayRow = {
  day: string;
  sessions: number;
  page_views: number;
  visitors: number;
  avg_duration_sec: number;
  /** Số đơn online khách gửi trong ngày đó — để đọc được tỉ lệ "vào xem → đặt đơn". */
  orders: number;
};

export async function trafficByDay(
  ds: DataSource,
  range: Range,
  nowMs: number,
): Promise<DayRow[]> {
  const rows = (await ds.query(
    `SELECT FLOOR((first_seen_ms + ?) / ?)          AS day_idx,
            COUNT(*)                                AS sessions,
            COALESCE(SUM(page_views), 0)            AS page_views,
            COUNT(DISTINCT ip_hash)                 AS visitors,
            COALESCE(SUM(GREATEST(last_seen_ms - first_seen_ms, 0)), 0) AS duration_ms
       FROM web_visit_sessions
      WHERE ${HUMAN} AND first_seen_ms >= ? AND first_seen_ms < ?
      GROUP BY day_idx
      ORDER BY day_idx`,
    [VN_OFFSET_MS, DAY_MS, range.from_ms, range.to_ms],
  )) as Array<Record<string, unknown>>;

  // Đơn online gộp theo cùng công thức ngày. `submitted_at` là cột datetime nên phải quy về
  // epoch ms trước (UNIX_TIMESTAMP × 1000) — không dùng DATE() vì lý do (1) ở đầu file.
  const orderRows = (await ds.query(
    `SELECT FLOOR(((UNIX_TIMESTAMP(submitted_at) * 1000) + ?) / ?) AS day_idx,
            COUNT(*) AS orders
       FROM online_order_requests
      WHERE submitted_at >= ? AND submitted_at < ?
      GROUP BY day_idx`,
    [VN_OFFSET_MS, DAY_MS, new Date(range.from_ms), new Date(range.to_ms)],
  )) as Array<Record<string, unknown>>;

  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) byKey.set(dayIndexToKey(num(r.day_idx)), r);
  const ordersByKey = new Map<string, number>();
  for (const r of orderRows) ordersByKey.set(dayIndexToKey(num(r.day_idx)), num(r.orders));

  return dayKeysInRange(range, nowMs).map((day) => {
    const r = byKey.get(day);
    const sessions = num(r?.sessions);
    return {
      day,
      sessions,
      page_views: num(r?.page_views),
      visitors: num(r?.visitors),
      avg_duration_sec: sessions === 0 ? 0 : Math.round(num(r?.duration_ms) / sessions / 1000),
      orders: ordersByKey.get(day) ?? 0,
    };
  });
}

/** 24 ô giờ VN — trả đủ 24 kể cả giờ không có ai (biểu đồ không được nhảy cột). */
export async function trafficByHour(
  ds: DataSource,
  range: Range,
): Promise<Array<{ hour: number; sessions: number }>> {
  const rows = (await ds.query(
    `SELECT FLOOR(MOD(first_seen_ms + ?, ?) / 3600000) AS hour, COUNT(*) AS sessions
       FROM web_visit_sessions
      WHERE ${HUMAN} AND first_seen_ms >= ? AND first_seen_ms < ?
      GROUP BY hour`,
    [VN_OFFSET_MS, DAY_MS, range.from_ms, range.to_ms],
  )) as Array<Record<string, unknown>>;
  const map = new Map<number, number>();
  for (const r of rows) map.set(num(r.hour), num(r.sessions));
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, sessions: map.get(h) ?? 0 }));
}

export async function trafficByDevice(
  ds: DataSource,
  range: Range,
): Promise<Array<{ device: string; sessions: number }>> {
  const rows = (await ds.query(
    `SELECT device, COUNT(*) AS sessions
       FROM web_visit_sessions
      WHERE app = 'shop' AND first_seen_ms >= ? AND first_seen_ms < ?
      GROUP BY device
      ORDER BY sessions DESC`,
    [range.from_ms, range.to_ms],
  )) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ device: String(r.device ?? 'desktop'), sessions: num(r.sessions) }));
}

/** Phân bố thời gian ở lại — trả lời trực tiếp câu "khách ở lại bao lâu". */
export async function durationBuckets(
  ds: DataSource,
  range: Range,
): Promise<Array<{ label: string; sessions: number }>> {
  const [row] = (await ds.query(
    `SELECT
        SUM(CASE WHEN d < 10000                    THEN 1 ELSE 0 END) AS b1,
        SUM(CASE WHEN d >= 10000  AND d < 30000    THEN 1 ELSE 0 END) AS b2,
        SUM(CASE WHEN d >= 30000  AND d < 120000   THEN 1 ELSE 0 END) AS b3,
        SUM(CASE WHEN d >= 120000 AND d < 300000   THEN 1 ELSE 0 END) AS b4,
        SUM(CASE WHEN d >= 300000 AND d < 900000   THEN 1 ELSE 0 END) AS b5,
        SUM(CASE WHEN d >= 900000                  THEN 1 ELSE 0 END) AS b6
       FROM (SELECT GREATEST(last_seen_ms - first_seen_ms, 0) AS d
               FROM web_visit_sessions
              WHERE ${HUMAN} AND first_seen_ms >= ? AND first_seen_ms < ?) t`,
    [range.from_ms, range.to_ms],
  )) as Array<Record<string, unknown>>;
  return [
    { label: 'Dưới 10 giây', sessions: num(row?.b1) },
    { label: '10 – 30 giây', sessions: num(row?.b2) },
    { label: '30 giây – 2 phút', sessions: num(row?.b3) },
    { label: '2 – 5 phút', sessions: num(row?.b4) },
    { label: '5 – 15 phút', sessions: num(row?.b5) },
    { label: 'Trên 15 phút', sessions: num(row?.b6) },
  ];
}

export async function topPaths(
  ds: DataSource,
  range: Range,
  nowMs: number,
): Promise<Array<{ path: string; views: number }>> {
  const keys = dayKeysInRange(range, nowMs);
  if (keys.length === 0) return [];
  const rows = (await ds.query(
    `SELECT path, COALESCE(SUM(views), 0) AS views
       FROM web_page_views_daily
      WHERE day_key >= ? AND day_key <= ?
      GROUP BY path
      ORDER BY views DESC
      LIMIT 20`,
    [keys[0], keys[keys.length - 1]],
  )) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ path: String(r.path), views: num(r.views) }));
}

export async function topReferrers(
  ds: DataSource,
  range: Range,
): Promise<Array<{ host: string; sessions: number }>> {
  const rows = (await ds.query(
    `SELECT referrer_host AS host, COUNT(*) AS sessions
       FROM web_visit_sessions
      WHERE ${HUMAN} AND referrer_host IS NOT NULL
        AND first_seen_ms >= ? AND first_seen_ms < ?
      GROUP BY referrer_host
      ORDER BY sessions DESC
      LIMIT 10`,
    [range.from_ms, range.to_ms],
  )) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ host: String(r.host), sessions: num(r.sessions) }));
}

/** Số phiên còn "sống" (có ping trong 5 phút gần nhất) — trễ tối đa 10s do gộp lô khi ghi. */
export async function activeNow(ds: DataSource, nowMs: number): Promise<number> {
  const [row] = (await ds.query(
    `SELECT COUNT(*) AS n FROM web_visit_sessions WHERE ${HUMAN} AND last_seen_ms >= ?`,
    [nowMs - 5 * 60_000],
  )) as Array<Record<string, unknown>>;
  return num(row?.n);
}

export type CustomerStats = {
  phones_total_ever: number;
  phones_in_range: number;
  phones_new_in_range: number;
  phones_repeat_ever: number;
  phones_from_staff_orders: number;
  orders_in_range: number;
  orders_by_status: Array<{ status: string; count: number }>;
  top_phones: Array<{
    phone: string;
    name: string;
    orders: number;
    subtotal_sum: number;
    last_order_ms: number;
  }>;
};

/**
 * Thống kê SĐT khách. NGUỒN SỰ THẬT là `online_order_requests` — mọi lần khách BẤM ĐẶT đều để
 * lại một dòng ở đó, kể cả đơn sau này bị từ chối hoặc khách tự huỷ; bảng `orders` chỉ có đơn
 * ĐÃ duyệt nên đếm ở đó sẽ trả lời sai câu "bao nhiêu SĐT từng đặt đơn".
 *
 * `web_visit_sessions.customer_phone` KHÔNG được dùng ở đây (client gửi lên được → giả mạo
 * được). Nó chỉ để trả lời câu hỏi về phiên truy cập.
 */
export async function customerStats(ds: DataSource, range: Range): Promise<CustomerStats> {
  const from = new Date(range.from_ms);
  const to = new Date(range.to_ms);

  const [ever] = (await ds.query(
    `SELECT COUNT(DISTINCT customer_phone) AS n FROM online_order_requests`,
  )) as Array<Record<string, unknown>>;

  const [inRange] = (await ds.query(
    `SELECT COUNT(DISTINCT customer_phone) AS n, COUNT(*) AS orders
       FROM online_order_requests
      WHERE submitted_at >= ? AND submitted_at < ?`,
    [from, to],
  )) as Array<Record<string, unknown>>;

  // Khách MỚI = SĐT có đơn ĐẦU TIÊN nằm trong khoảng đang xem.
  const [fresh] = (await ds.query(
    `SELECT COUNT(*) AS n FROM (
        SELECT customer_phone, MIN(submitted_at) AS first_at
          FROM online_order_requests
         GROUP BY customer_phone
        HAVING first_at >= ? AND first_at < ?) t`,
    [from, to],
  )) as Array<Record<string, unknown>>;

  const [repeat] = (await ds.query(
    `SELECT COUNT(*) AS n FROM (
        SELECT customer_phone
          FROM online_order_requests
         GROUP BY customer_phone
        HAVING COUNT(*) >= 2) t`,
  )) as Array<Record<string, unknown>>;

  // SĐT nhân viên nhập tay ở màn order (đơn ship/mang về tại quán) — số riêng, KHÔNG cộng vào
  // số online: một SĐT có thể xuất hiện ở cả hai nguồn và cộng lại là đếm trùng.
  const [staff] = (await ds.query(
    `SELECT COUNT(DISTINCT customer_phone) AS n FROM orders
      WHERE customer_phone IS NOT NULL AND customer_phone <> ''`,
  )) as Array<Record<string, unknown>>;

  const statusRows = (await ds.query(
    `SELECT status, COUNT(*) AS n
       FROM online_order_requests
      WHERE submitted_at >= ? AND submitted_at < ?
      GROUP BY status
      ORDER BY n DESC`,
    [from, to],
  )) as Array<Record<string, unknown>>;

  const topRows = (await ds.query(
    `SELECT customer_phone                              AS phone,
            MAX(customer_name)                          AS name,
            COUNT(*)                                    AS orders,
            COALESCE(SUM(subtotal), 0)                  AS subtotal_sum,
            MAX(UNIX_TIMESTAMP(submitted_at) * 1000)    AS last_order_ms
       FROM online_order_requests
      GROUP BY customer_phone
      ORDER BY orders DESC, subtotal_sum DESC
      LIMIT 20`,
  )) as Array<Record<string, unknown>>;

  return {
    phones_total_ever: num(ever?.n),
    phones_in_range: num(inRange?.n),
    phones_new_in_range: num(fresh?.n),
    phones_repeat_ever: num(repeat?.n),
    phones_from_staff_orders: num(staff?.n),
    orders_in_range: num(inRange?.orders),
    orders_by_status: statusRows.map((r) => ({ status: String(r.status), count: num(r.n) })),
    top_phones: topRows.map((r) => ({
      phone: String(r.phone),
      name: String(r.name ?? ''),
      orders: num(r.orders),
      subtotal_sum: num(r.subtotal_sum),
      last_order_ms: num(r.last_order_ms),
    })),
  };
}

/** Dùng ở controller để trả kèm mốc ngày cho FE hiển thị tiêu đề khoảng thời gian. */
export function rangeLabel(range: Range): { from_day: string; to_day: string } {
  return { from_day: dayKeyIct(range.from_ms), to_day: dayKeyIct(range.to_ms - 1) };
}

/**
 * Chia sẻ vị trí: thành công / hỏng, trong khoảng đang xem (2026-08-30).
 *
 * Đọc `geo_share_daily` — bộ đếm do `POST /api/public/geo-log` cộng dồn mỗi cú bấm. Xem docblock
 * entity để biết vì sao con số này phải nằm trong DB chứ không phải log container.
 *
 * `failed` gộp cả 4 kiểu hỏng vì đó là con số chủ quán cần ("bao nhiêu khách không chia sẻ được"),
 * nhưng `by_outcome` giữ nguyên chi tiết: `denied` (quyền bị chặn) và `timeout` (máy lấy quá lâu)
 * dẫn tới hai việc phải làm khác hẳn nhau, gộp lại là mất đúng thứ đáng đọc.
 */
export type GeoShareStats = {
  ok: number;
  failed: number;
  total: number;
  /** % hỏng trên tổng số lượt bấm, làm tròn 1 chữ số. `null` khi chưa có lượt nào — 0% và
   *  "chưa có dữ liệu" là hai chuyện khác nhau, đừng vẽ 0% cho cái thứ hai. */
  failed_pct: number | null;
  by_outcome: Array<{ outcome: string; hits: number }>;
};

export async function geoShareStats(
  ds: DataSource,
  range: Range,
  nowMs: number,
): Promise<GeoShareStats> {
  const keys = dayKeysInRange(range, nowMs);
  const empty: GeoShareStats = { ok: 0, failed: 0, total: 0, failed_pct: null, by_outcome: [] };
  if (keys.length === 0) return empty;

  const rows = (await ds.query(
    `SELECT outcome, COALESCE(SUM(hits), 0) AS hits
       FROM geo_share_daily
      WHERE day_key >= ? AND day_key <= ?
      GROUP BY outcome
      ORDER BY hits DESC`,
    [keys[0], keys[keys.length - 1]],
  )) as Array<Record<string, unknown>>;

  const by_outcome = rows.map((r) => ({ outcome: String(r.outcome), hits: num(r.hits) }));
  const ok = by_outcome.find((r) => r.outcome === 'ok')?.hits ?? 0;
  const total = by_outcome.reduce((sum, r) => sum + r.hits, 0);
  const failed = total - ok;
  return {
    ok,
    failed,
    total,
    failed_pct: total === 0 ? null : Math.round((failed / total) * 1000) / 10,
    by_outcome,
  };
}

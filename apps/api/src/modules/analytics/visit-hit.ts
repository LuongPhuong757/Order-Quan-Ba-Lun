// Module THUẦN của luồng thống kê truy cập: chuẩn hoá payload ping + gộp nhiều ping của cùng
// một phiên thành một dòng sẽ ghi. Không import Nest, không chạm DB, `now_ms` luôn là tham số
// (khuôn `store-status.ts` / `retention-queries.ts`) để test không cần fake timer.
import { normalizePhone } from '../public/phone.js';

/** Đường dẫn không nằm trong danh sách route thật → gộp hết vào một ô. */
export const OTHER_PATH = '/(khác)';

/**
 * Route THẬT của apps/shop (khớp `apps/shop/src/main.tsx`). Đây là hàng rào chống phình bảng
 * `web_page_views_daily`: client (hoặc bot, hoặc người cố tình POST tay) gửi đường dẫn gì cũng
 * chỉ tạo ra tối đa `KNOWN_PATHS.size + 1` dòng mỗi ngày.
 *
 * ⚠ Thêm route mới vào apps/shop thì THÊM VÀO ĐÂY, nếu không lượt xem route đó nằm im trong ô
 * `/(khác)` — số vẫn đúng tổng, chỉ mất khả năng tách riêng.
 */
export const KNOWN_PATHS: ReadonlySet<string> = new Set([
  '/',
  '/cart',
  '/checkout',
  '/history',
  '/top',
  '/guide',
  // `/o/:token` — token đơn hàng bị thay bằng `:token` ở `sanitizePath()`: giữ token thật thì
  // mỗi khách theo dõi đơn lại sinh một đường dẫn mới (cardinality vô hạn) và URL tra đơn của
  // khách bị lưu vào bảng thống kê.
  '/o/:token',
]);

/** Bỏ query/hash, thay đoạn động bằng placeholder, chốt về danh sách route thật. */
export function sanitizePath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return OTHER_PATH;
  // Cắt query + hash trước: '/cart?utm_source=zalo#x' → '/cart'.
  const noQuery = raw.split('?')[0].split('#')[0];
  const path = noQuery.startsWith('/') ? noQuery : `/${noQuery}`;
  // Bỏ '/' cuối (trừ khi chính nó là gốc): '/cart/' và '/cart' là cùng một trang.
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const lower = trimmed.toLowerCase();
  if (KNOWN_PATHS.has(lower)) return lower;
  if (/^\/o\/[a-z0-9-]{1,80}$/.test(lower)) return '/o/:token';
  return OTHER_PATH;
}

/** Chỉ giữ host của referrer — không lưu full URL của trang bên ngoài. */
export function referrerHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (!host) return null;
    return host.slice(0, 128);
  } catch {
    return null;
  }
}

export type Device = 'mobile' | 'tablet' | 'desktop' | 'bot';

/**
 * Phân loại thiết bị từ User-Agent. Bot được TÁCH RIÊNG chứ không loại bỏ: chủ quán cần thấy
 * "1000 request nhưng 900 là bot" thay vì tưởng quán đang đông khách. Mọi con số về khách ở
 * màn admin đều lọc `device <> 'bot'`.
 */
export function classifyDevice(ua: unknown): Device {
  const s = typeof ua === 'string' ? ua.toLowerCase() : '';
  if (!s) return 'bot'; // không có UA = gần như chắc chắn script, không phải trình duyệt
  if (/bot|crawler|spider|crawl|slurp|bingpreview|headless|monitor|curl|wget|python-requests|axios|okhttp/.test(s)) {
    return 'bot';
  }
  if (/ipad|tablet|playbook|silk/.test(s)) return 'tablet';
  if (/mobi|android|iphone|ipod|phone|blackberry|iemobile/.test(s)) return 'mobile';
  return 'desktop';
}

/** 'YYYY-MM-DD' theo giờ VN (UTC+7 cố định, không DST) — xem docblock entity `WebPageViewDaily`. */
export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function dayKeyIct(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Payload đã chuẩn hoá của MỘT ping. */
export type VisitHit = {
  session_id: string;
  app: string;
  /** Các đường dẫn khách xem kể từ ping trước (đã sanitize, theo thứ tự). Có thể rỗng
   *  (ping nhịp tim: chỉ để cập nhật "vẫn đang ở lại"). */
  paths: string[];
  /** Tổng số lượt xem trang của phiên do client đếm — gộp bằng MAX nên ping mất không làm tụt số. */
  page_views: number;
  referrer_host: string | null;
  device: Device;
  ip_hash: string;
  customer_phone: string | null;
  now_ms: number;
};

/** Dòng sắp ghi vào `web_visit_sessions` (đã gộp mọi ping của phiên trong cửa sổ flush). */
export type BufferedSession = {
  session_id: string;
  app: string;
  first_seen_ms: number;
  last_seen_ms: number;
  page_views: number;
  entry_path: string;
  last_path: string;
  referrer_host: string | null;
  device: Device;
  ip_hash: string;
  customer_phone: string | null;
};

/**
 * Gộp một ping vào dòng đang đệm. Quy tắc gộp là IDEMPOTENT có chủ ý — ping trùng, ping đến
 * sai thứ tự, hoặc ping bị mất đều không làm sai số:
 *   - `first_seen_ms` = min, `last_seen_ms` = max (đồng hồ server)
 *   - `page_views`    = max (client gửi tổng tích luỹ, không gửi delta)
 *   - `customer_phone`= giữ giá trị đầu tiên biết được (khách đăng nhập giữa phiên vẫn đếm được)
 * Cùng 3 quy tắc này được lặp lại ở nhánh `ON DUPLICATE KEY UPDATE` khi ghi DB — sửa ở đây thì
 * phải sửa cả câu SQL, nếu không số trong RAM và số trong DB tính khác nhau.
 */
export function mergeHit(prev: BufferedSession | undefined, hit: VisitHit): BufferedSession {
  const lastPath = hit.paths.length > 0 ? hit.paths[hit.paths.length - 1] : prev?.last_path;
  if (!prev) {
    const entry = hit.paths[0] ?? OTHER_PATH;
    return {
      session_id: hit.session_id,
      app: hit.app,
      first_seen_ms: hit.now_ms,
      last_seen_ms: hit.now_ms,
      page_views: Math.max(1, hit.page_views),
      entry_path: entry,
      last_path: lastPath ?? entry,
      referrer_host: hit.referrer_host,
      device: hit.device,
      ip_hash: hit.ip_hash,
      customer_phone: hit.customer_phone,
    };
  }
  return {
    ...prev,
    first_seen_ms: Math.min(prev.first_seen_ms, hit.now_ms),
    last_seen_ms: Math.max(prev.last_seen_ms, hit.now_ms),
    page_views: Math.max(prev.page_views, hit.page_views),
    last_path: lastPath ?? prev.last_path,
    referrer_host: prev.referrer_host ?? hit.referrer_host,
    customer_phone: prev.customer_phone ?? hit.customer_phone,
  };
}

/** Số lượt xem cộng thêm cho từng (ngày, đường dẫn) từ danh sách path của một ping. */
export function pageViewDeltas(hit: VisitHit): Array<{ day_key: string; path: string; views: number }> {
  const day = dayKeyIct(hit.now_ms);
  const counts = new Map<string, number>();
  for (const p of hit.paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()].map(([path, views]) => ({ day_key: day, path, views }));
}

/** SĐT khách tự nhập trước đó (đọc từ localStorage của họ) — chuẩn hoá, sai định dạng thì bỏ. */
export function normalizeTrackPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return normalizePhone(raw);
}

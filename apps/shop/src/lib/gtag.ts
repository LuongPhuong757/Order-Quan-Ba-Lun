/**
 * Google Analytics 4 cho trang khách — CHỈ tồn tại để đo hiệu quả quảng cáo Google Ads.
 *
 * ── VÌ SAO CÓ FILE NÀY, KHI `analytics.ts` NÓI "KHÔNG DÙNG ANALYTICS NGOÀI" ──────────────
 * Quyết định cũ vẫn đúng với thứ nó nói tới: đo lượt vào, thời gian ở lại, trang nào hay xem
 * — những số đó đã nằm trong DB của chính mình, không cần ai đo hộ. Cái nó KHÔNG làm được là
 * hai việc mà chỉ Google làm được:
 *
 *   1. Đọc `gclid` — tham số Google gắn vào URL khi khách bấm quảng cáo. Không có nó thì
 *      không cách nào biết đơn này đến từ chiến dịch nào, từ khoá nào.
 *   2. Trả số ngược về Google Ads. Thuật toán đấu thầu HỌC từ event `purchase`; không có nó
 *      thì Google tối ưu cho "click rẻ", mà click rẻ thường là click rác.
 *
 * Nên: từ 2026-09-22 quán chạy quảng cáo Google, và đây là cái giá phải trả để tiền quảng cáo
 * không chạy mù. Ranh giới giữ nguyên — GA4 để tối ưu quảng cáo, DB nhà vẫn là SỰ THẬT về
 * doanh thu. Hai con số sẽ lệch vài phần trăm (khách chặn quảng cáo, đóng tab sớm, chế độ ẩn
 * danh); đó KHÔNG phải lỗi, đừng đi đối chiếu.
 *
 * ── FILE NÀY TUÂN THỦ ĐÚNG 6 LUẬT CỦA `analytics.ts` ───────────────────────────────────────
 * Không `await` trên đường render; mọi truy cập storage bọc try/catch (Safari private mode
 * throw khi ghi); `navigator.webdriver` không gửi gì; script nạp `async` nên không chặn vẽ
 * trang. Lệnh gọi trước khi script về đều nằm yên trong `dataLayer` — đó là cơ chế hàng đợi
 * sẵn có của gtag.js, không mất lệnh nào.
 *
 * ── CỔNG THEO HOSTNAME, KHÔNG DÁN CỨNG VÀO index.html ─────────────────────────────────────
 * Dán snippet thẳng vào `index.html` là server develop và cả máy local cũng bắn vào cùng một
 * property → số liệu chiến dịch lẫn traffic test. Nạp từ JS thì cổng nằm trong code, và máy
 * dev không tốn một vòng DNS/TLS nào cho thứ nó không dùng. Đổi lại GA khởi động chậm hơn vài
 * trăm ms so với nằm trong `<head>` — không ảnh hưởng đo đạc, `gclid` vẫn còn nguyên trong URL
 * lúc đó.
 *
 * ── HAI THỨ TUYỆT ĐỐI KHÔNG ĐƯỢC GỬI SANG GOOGLE ──────────────────────────────────────────
 *  1. `order_token` / token ảnh món. Chúng là bearer credential nằm ngay trong đường dẫn; cả
 *     `Caddyfile` (`Referrer-Policy: no-referrer`) lẫn `sanitizePath()` bên API đều dựng lên
 *     để giữ chúng không rò ra ngoài. Xem `sanitizeLocation()` bên dưới.
 *  2. Tên / số điện thoại khách. Đó là PII, gửi sang GA là vi phạm điều khoản sử dụng của
 *     Google và có thể bị xoá cả property.
 */

/** Property GA4 của quán (Measurement ID). */
const MEASUREMENT_ID = 'G-VF2QFPX4JG';
const SCRIPT_SRC = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;

/**
 * Cửa hậu để kiểm thử trên server develop: `localStorage.setItem('qbl.ga_force','1')`.
 * Cần nó vì cổng dưới đây chặn theo hostname, mà muốn xác nhận `purchase` bắn đúng thì phải
 * đặt được một đơn thử ở đâu đó KHÔNG phải quán thật (memory: cấm test trên production).
 * Event test sẽ nằm lại vĩnh viễn trong property — vài đơn ảo, nhiễu không đáng kể.
 */
const FORCE_KEY = 'qbl.ga_force';

/**
 * Chỉ 3 host này là quán thật. `menu.` nằm trong danh sách vì quyển menu dùng CHUNG bundle với
 * trang đặt hàng (xem `main.tsx`) và cũng là một đích quảng cáo có thể trỏ tới.
 */
const PROD_HOSTS = new Set(['quanbalun.site', 'www.quanbalun.site', 'menu.quanbalun.site']);

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let started = false;
/** Đường dẫn của `page_view` gần nhất — chống đếm đúp, xem `gaPageView()`. */
let lastPath = '';

function forced(): boolean {
  try {
    return window.localStorage.getItem(FORCE_KEY) === '1';
  } catch {
    return false;
  }
}

function enabled(): boolean {
  // Script tự động / load test không được làm bẩn số liệu chiến dịch.
  if (navigator.webdriver) return false;
  if (PROD_HOSTS.has(window.location.hostname.toLowerCase())) return true;
  return forced();
}

/**
 * Chỉ bật khi chạy bằng cờ `qbl.ga_force`, tức đang kiểm thử trên dev — KHÔNG BAO GIỜ trên
 * host quán thật.
 *
 * Thiếu nó thì màn **DebugView** của GA4 câm: nó chỉ nhận event từ trang có cờ này (hoặc từ
 * máy đã cài extension riêng của Google). Mà DebugView là chỗ duy nhất soi được TỪNG THAM SỐ
 * của `purchase` — báo cáo Thời gian thực chỉ đếm số lần, không cho xem `value` gửi đi là bao
 * nhiêu, tức không kiểm được đúng cái dễ sai nhất.
 */
function debugMode(): boolean {
  return !PROD_HOSTS.has(window.location.hostname.toLowerCase()) && forced();
}

/**
 * Đẩy lệnh vào `dataLayer`.
 *
 * Phải push CHÍNH object `arguments` chứ không phải một mảng: gtag.js nhận diện lệnh theo dạng
 * array-like đó. Vì vậy đây là `function` thường (arrow function không có `arguments`), và
 * tham số rest chỉ để TypeScript cho phép gọi với số đối số bất kỳ.
 */
function gtag(..._args: unknown[]): void {
  window.dataLayer?.push(arguments);
}

/**
 * URL báo cho GA — đã gỡ mọi token ra khỏi đường dẫn.
 *
 * Giữ NGUYÊN query string ở các trang thường (`?utm_source=zalo`, `?gclid=...`): GA4 dựa vào
 * chính chúng để xếp khách vào đúng nguồn. Riêng hai route mang token thì cắt sạch cả đường
 * dẫn lẫn query — ở đó không bao giờ có utm để mà mất, mà lại có credential để mà rò.
 */
function sanitizeLocation(path: string): string {
  const origin = window.location.origin;
  if (/^\/o\/[^/]+/i.test(path)) return `${origin}/o/:token`;
  if (/^\/anh-mon\/[^/]+/i.test(path)) return `${origin}/anh-mon/:token`;
  return window.location.href;
}

/**
 * Khởi động GA. Gọi được nhiều lần, chỉ chạy thật một lần.
 *
 * `path` là đường dẫn hiện tại — dùng cho `page_view` đầu tiên. Phải tự bắn ở đây (và tắt
 * `send_page_view` của `config`) vì hai route `/thuc-don` và `/anh-mon/:token` nằm NGOÀI
 * `AppShell`, tức ngoài chỗ duy nhất gọi `trackPageView`. Để GA tự bắn thì lại đếm đúp với
 * `gaPageView` ngay sau đó; tự bắn rồi chống đúp bằng `lastPath` thì phủ được cả hai.
 */
export function startGa(path: string): void {
  try {
    if (started || !enabled()) return;
    started = true;

    window.dataLayer = window.dataLayer ?? [];
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', MEASUREMENT_ID, {
      send_page_view: false,
      ...(debugMode() ? { debug_mode: true } : {}),
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = SCRIPT_SRC;
    document.head.appendChild(script);

    gaPageView(path);
  } catch {
    /* im lặng — luật (2): thống kê hỏng thì mất số, không được mất trải nghiệm */
  }
}

/**
 * Một lượt xem trang. Gọi từ `trackPageView()` trong `analytics.ts` để chỉ có ĐÚNG MỘT điểm
 * gọi cho cả app — thêm route mới là tự có, không phải nhớ.
 *
 * Bỏ qua khi trùng đường dẫn liền trước: `startGa()` vừa bắn lượt đầu xong thì effect của
 * `AppShell` gọi lại ngay với cùng path (và React StrictMode ở dev còn gọi đôi lần nữa).
 */
export function gaPageView(path: string): void {
  try {
    if (!started) return;
    if (path === lastPath) return;
    lastPath = path;
    gtag('event', 'page_view', {
      page_location: sanitizeLocation(path),
      page_title: document.title,
    });
  } catch {
    /* im lặng */
  }
}

/**
 * Đơn đặt thành công — ĐÂY là con số quảng cáo thực sự chạy bằng. Mọi thứ còn lại trong file
 * chỉ là nền cho event này.
 *
 * `purchase` là tên DÀNH RIÊNG trong bộ ecommerce của GA4: đặt đúng tên thì Google tự hiểu
 * `value` là doanh thu và Google Ads import được làm conversion. Đặt tên khác (kiểu
 * `dat_don_thanh_cong`) thì vẫn đếm được số lần nhưng mất sạch phần tiền.
 *
 * CỐ Ý KHÔNG có `transaction_id`, dù chuẩn GA4 khuyên dùng để chống đếm trùng: mã duy nhất
 * app có trong tay lúc này là `order_token` — xem luật (1) ở đầu file. Rủi ro đếm trùng ở đây
 * gần như bằng không vì `CheckoutPage` bắn event TRƯỚC khi `navigate(..., { replace: true })`;
 * khách F5 sau đó là đang đứng ở màn theo dõi đơn, không chạy lại nhánh này.
 */
export function gaPurchase(input: { value: number; shipping: number }): void {
  try {
    if (!started) return;
    gtag('event', 'purchase', {
      currency: 'VND',
      value: input.value,
      // Chỉ gửi khi có thật: 0 đồng phí giao của đơn tự đến lấy không phải một thông tin.
      ...(input.shipping > 0 ? { shipping: input.shipping } : {}),
    });
  } catch {
    /* im lặng */
  }
}

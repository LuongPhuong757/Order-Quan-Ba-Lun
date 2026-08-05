/**
 * Đo lượt truy cập trang khách — gửi ping `POST /api/public/track`.
 *
 * TOÀN BỘ file này viết theo một luật duy nhất: THỐNG KÊ KHÔNG BAO GIỜ ĐƯỢC LÀM CHẬM HAY LÀM
 * HỎNG TRANG CỦA KHÁCH. Cụ thể là 6 điều dưới đây — mỗi điều là một cách nó từng có thể hỏng:
 *
 *  1. Không có `await` nào trên đường render. `trackPageView()` chỉ đẩy vào biến trong RAM.
 *  2. Ping đi qua `sendBeacon` (hoặc `fetch(keepalive)`) — fire-and-forget, KHÔNG đọc response,
 *     KHÔNG parse JSON, KHÔNG hiện lỗi. Mạng 3G rớt thì mất số, không mất trải nghiệm.
 *  3. Gộp nhịp: tối thiểu `MIN_INTERVAL_MS` giữa 2 ping. Khách bấm 10 trang trong 5 giây vẫn
 *     chỉ tốn 1 request.
 *  4. Nhịp tim chỉ chạy khi tab ĐANG HIỆN (`visibilityState === 'visible'`). Tab nền không
 *     ngốn pin/3G của khách để làm đẹp biểu đồ cho admin.
 *  5. Mọi truy cập storage bọc try/catch — Safari private mode throw khi ghi (T-08-31).
 *  6. `navigator.webdriver` (script tự động, load test) không gửi gì.
 *
 * KHÔNG dùng `use-api.ts` ở đây dù nó là lớp dữ liệu chuẩn của app: `postJson()` cố tình
 * zod-parse response và trả lỗi cho UI xử lý — hai thứ ping này phải KHÔNG làm.
 *
 * Không có thư viện analytics ngoài (GA/Umami/Plausible): thêm 1 script bên thứ ba là thêm
 * ~20-45KB JS + 1 kết nối DNS/TLS tới host khác trên đúng cái đường 3G mà `use-api.ts` đang
 * cố giữ sạch. Số liệu chủ quán cần (lượt vào, thời gian ở lại, trang nào hay xem, SĐT từng
 * đặt đơn) đều đã nằm trong DB của chính mình.
 */
import { LAST_CUSTOMER_KEY } from './customer-token.ts';

const TRACK_URL = '/api/public/track';
const SID_KEY = 'qbl.analytics_sid';
const PV_KEY = 'qbl.analytics_pv';

/** Khoảng cách tối thiểu giữa 2 ping thường (ping lúc rời trang thì gửi ngay, không chờ). */
const MIN_INTERVAL_MS = 15_000;
/** Nhịp tim: mốc "vẫn đang ở lại" → sai số thời gian ở lại tối đa ~1 phút. */
const HEARTBEAT_MS = 60_000;

type State = {
  sid: string;
  pv: number;
  /** Đường dẫn đã xem nhưng chưa gửi. */
  pending: string[];
  lastSentMs: number;
  timer: number | null;
  heartbeat: number | null;
  started: boolean;
  lastPath: string;
  lastPathMs: number;
};

let state: State | null = null;

function readStorage(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(store: Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    /* private mode — chạy tiếp như không có storage */
  }
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * `session_id` sống trong sessionStorage → đóng tab là hết phiên, mở lại là phiên mới. Đó là
 * ĐỊNH NGHĨA của "một lượt vào web" ở màn admin, và cũng là lý do không dùng `customer_token`
 * (localStorage, sống mãi) làm khoá phiên.
 */
function getSid(): string {
  const existing = readStorage(window.sessionStorage, SID_KEY);
  if (existing && /^[a-f0-9]{16,64}$/.test(existing)) return existing;
  const fresh = randomHex(16);
  writeStorage(window.sessionStorage, SID_KEY, fresh);
  return fresh;
}

/** SĐT khách đã tự nhập ở đơn trước (localStorage của chính họ) — để admin biết phiên nào là
 *  khách quen. Không có thì thôi, tuyệt đối không hỏi thêm gì của khách vì việc này. */
function readPhone(): string | undefined {
  const raw = readStorage(window.localStorage, LAST_CUSTOMER_KEY);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { customer_phone?: unknown };
    return typeof parsed.customer_phone === 'string' && parsed.customer_phone.length > 0
      ? parsed.customer_phone
      : undefined;
  } catch {
    return undefined;
  }
}

/** Gửi thật. `useBeacon` cho lúc rời trang (fetch có thể bị huỷ khi tab đóng). */
function send(useBeacon: boolean): void {
  const s = state;
  if (!s) return;
  const paths = s.pending;
  s.pending = [];
  s.lastSentMs = Date.now();

  const body = JSON.stringify({
    sid: s.sid,
    pv: s.pv,
    paths,
    // `document.referrer` chỉ có giá trị ở lượt vào đầu tiên; BE chỉ giữ giá trị đầu tiên
    // biết được của phiên nên gửi mọi lần cũng không sai số.
    ...(document.referrer ? { ref: document.referrer } : {}),
    ...(readPhone() ? { phone: readPhone() } : {}),
  });

  try {
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      // Blob type 'application/json' là BẮT BUỘC: body parser của Nest chỉ đọc content-type
      // này. Blob mặc định (text/plain) → req.body rỗng → ValidationPipe 422, ping mất im.
      const ok = navigator.sendBeacon(TRACK_URL, new Blob([body], { type: 'application/json' }));
      if (ok) return;
      // sendBeacon trả false (quá hạn mức queue của trình duyệt) → thử nốt bằng fetch.
    }
    void fetch(TRACK_URL, {
      method: 'POST',
      // same-origin: cần header Origin để qua `CsrfOriginGuard` (nó chặn MỌI mutation
      // /api/public/* không có Origin/Referer).
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
      // keepalive: request sống tiếp sau khi tab điều hướng đi.
      keepalive: true,
    }).catch(() => {
      /* im lặng — xem luật (2) ở đầu file */
    });
  } catch {
    /* im lặng */
  }
}

function scheduleSend(): void {
  const s = state;
  if (!s || s.timer !== null) return;
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - s.lastSentMs));
  s.timer = window.setTimeout(() => {
    if (state) state.timer = null;
    send(false);
  }, wait);
}

/** Gọi mỗi khi khách xem một trang (kể cả điều hướng nội bộ trong SPA). */
export function trackPageView(path: string): void {
  try {
    if (navigator.webdriver) return;
    if (!state) {
      state = {
        sid: getSid(),
        pv: Number(readStorage(window.sessionStorage, PV_KEY)) || 0,
        pending: [],
        lastSentMs: 0,
        timer: null,
        heartbeat: null,
        started: false,
        lastPath: '',
        lastPathMs: 0,
      };
    }
    const s = state;
    const now = Date.now();
    // React StrictMode gọi effect 2 lần ở dev → cùng path trong vài ms không phải 2 lượt xem.
    if (s.lastPath === path && now - s.lastPathMs < 1_000) return;
    s.lastPath = path;
    s.lastPathMs = now;

    s.pv += 1;
    writeStorage(window.sessionStorage, PV_KEY, String(s.pv));
    s.pending.push(path);
    scheduleSend();

    if (!s.started) {
      s.started = true;
      attachLifecycle();
    }
  } catch {
    /* im lặng */
  }
}

function attachLifecycle(): void {
  const s = state;
  if (!s) return;

  // Rời trang → chốt mốc thời gian cuối. `pagehide` là sự kiện DUY NHẤT đáng tin trên iOS
  // Safari (`beforeunload`/`unload` không bắn khi tab bị đưa vào back-forward cache).
  window.addEventListener('pagehide', () => send(true));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      send(true);
    }
  });

  s.heartbeat = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    // Không có gì mới VÀ vừa ping xong → khỏi gửi. Nhịp tim chỉ để gia hạn "vẫn đang ở lại".
    if (state && Date.now() - state.lastSentMs < HEARTBEAT_MS - 1_000) return;
    send(false);
  }, HEARTBEAT_MS);
}

/** Chỉ dùng cho test. */
export function __resetAnalyticsForTest(): void {
  if (state?.timer !== null && state?.timer !== undefined) window.clearTimeout(state.timer);
  if (state?.heartbeat !== null && state?.heartbeat !== undefined) {
    window.clearInterval(state.heartbeat);
  }
  state = null;
}

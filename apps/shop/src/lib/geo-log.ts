/**
 * Gửi kết quả MỖI LẦN khách bấm "Chia sẻ vị trí" về `POST /api/public/geo-log` — thành công
 * lẫn thất bại — để chẩn đoán ca "iPhone cái được cái không" (2026-08-16): thất bại của
 * Geolocation xảy ra hoàn toàn trong trình duyệt, không gửi thì log server trắng trơn.
 *
 * Theo ĐÚNG luật của `analytics.ts`: TELEMETRY KHÔNG BAO GIỜ ĐƯỢC LÀM CHẬM HAY HỎNG TRANG.
 *  - fire-and-forget: không await trên đường render, không đọc response, không hiện lỗi;
 *  - mọi thứ bọc try/catch — kể cả đọc sessionStorage (Safari private mode throw);
 *  - `navigator.webdriver` (script tự động) không gửi gì;
 *  - KHÔNG gửi toạ độ — chẩn đoán cần lý do + sai số + thời gian chờ, không cần vị trí khách.
 *
 * KHÔNG dùng `use-api.ts`: postJson() cố tình parse response và trả lỗi cho UI — hai thứ
 * telemetry phải KHÔNG làm.
 */

const GEO_LOG_URL = '/api/public/geo-log';
/** Cùng khoá với `analytics.ts` — để nối dòng geo-log với phiên analytics của cùng khách. */
const SID_KEY = 'qbl.analytics_sid';

export type GeoLogPayload = {
  outcome: 'ok' | 'denied' | 'unavailable' | 'timeout' | 'unsupported';
  /** Mã thô GeolocationPositionError.code — bỏ trống khi ok/unsupported. */
  code?: number;
  /** Chuỗi lỗi thô của trình duyệt (iOS trả kiểu "kCLErrorDomain error 0" — vàng để chẩn đoán). */
  message?: string;
  elapsed_ms: number;
  accuracy_m?: number;
};

function readSid(): string | undefined {
  try {
    const sid = window.sessionStorage.getItem(SID_KEY);
    return sid && /^[a-f0-9]{16,64}$/i.test(sid) ? sid : undefined;
  } catch {
    return undefined;
  }
}

export function reportGeoOutcome(payload: GeoLogPayload): void {
  try {
    if (navigator.webdriver) return;
    const body = JSON.stringify({
      ...payload,
      // Cắt message phòng WebView trả chuỗi dài bất thường — server cũng chặn 300 ký tự.
      ...(payload.message !== undefined ? { message: payload.message.slice(0, 300) } : {}),
      elapsed_ms: Math.max(0, Math.round(payload.elapsed_ms)),
      ...(payload.accuracy_m !== undefined ? { accuracy_m: Math.round(payload.accuracy_m) } : {}),
      page: window.location.pathname,
      // Geolocation đòi secure context — false thì mọi lần bấm đều hỏng, log tự nói lý do.
      secure: window.isSecureContext === true,
      ...(readSid() ? { sid: readSid() } : {}),
    });
    void fetch(GEO_LOG_URL, {
      method: 'POST',
      // same-origin: cần header Origin để qua `CsrfOriginGuard` (chặn mọi mutation
      // /api/public/* thiếu Origin/Referer).
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
      // Sống tiếp nếu khách rời trang ngay sau khi bấm.
      keepalive: true,
    }).catch(() => {
      /* im lặng — telemetry mất thì thôi, không mất trải nghiệm */
    });
  } catch {
    /* im lặng */
  }
}

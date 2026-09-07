// Axios client with re-login modal (P01.D-17) + friendly VN error tone (P01.D-18)
import axios, { AxiosError } from 'axios';
import type { ErrorEnvelope } from '@order/schemas';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  withCredentials: true, // cookies needed for JWT (F-17)
  // Mặc định axios: 2xx resolves, 4xx/5xx throw → caller dùng try/catch + extractError.
  // BUG FIX: trước đây `s < 500` làm 401 login fail vẫn resolve, code coi là success.
  // Disable browser HTTP cache cho GET — polling endpoints cần fresh data.
  // Without this, browser sends If-None-Match → server có thể trả 304 empty body.
  headers: {
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  },
});

type ReLoginModalHandler = (retry: () => Promise<unknown>) => Promise<void>;
let reLoginHandler: ReLoginModalHandler | null = null;

export function registerReLoginHandler(h: ReLoginModalHandler) {
  reLoginHandler = h;
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError<ErrorEnvelope>) => {
    const status = err.response?.status;
    const code = err.response?.data?.error?.code;

    // 401 + token revoked/expired → re-login modal (P01.D-17 preserve state)
    if (
      status === 401 &&
      reLoginHandler &&
      (code === 'AUTH_TOKEN_REVOKED' || code === 'AUTH_TOKEN_EXPIRED') &&
      err.config &&
      !(err.config as { _retried?: boolean })._retried
    ) {
      return new Promise((resolve, reject) => {
        reLoginHandler!(async () => {
          try {
            (err.config as { _retried?: boolean })._retried = true;
            resolve(await api.request(err.config!));
          } catch (retryErr) {
            reject(retryErr);
          }
        }).catch(reject);
      });
    }
    return Promise.reject(err);
  },
);

/** Nhận diện "server trả trang HTML thay vì JSON".
 *
 * Xảy ra thật trên production 2026-09-07: container Caddy trỏ nhầm sang API của nhánh develop,
 * bản đó còn dùng danh sách `apiPrefixes` khai tay nên mọi GET của màn Nhà cung cấp nhận
 * `index.html` với 200 OK. Màn hình đọc `res.data.data.items` trên một chuỗi HTML → TypeError →
 * không phải axios error → rơi vào nhánh cuối và hiện đúng một dòng "Có lỗi không xác định."
 * ở MỌI tab, không nói được gì cho người dùng lẫn người sửa.
 *
 * Vẫn giữ lớp nhận diện này sau khi đã sửa Caddyfile: cùng triệu chứng sẽ quay lại bất cứ khi
 * nào có thứ đứng giữa trình duyệt và API (proxy, captive portal wifi quán, service worker cũ),
 * và lúc đó thông báo phải chỉ ra được là lỗi kết nối chứ không phải lỗi dữ liệu.
 */
function looksLikeHtmlPage(v: unknown): boolean {
  return typeof v === 'string' && /^\s*<(!doctype|html)/i.test(v);
}

export function extractError(err: unknown): { code: string; message: string; field_errors?: Array<{ field: string; message: string }> } {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ErrorEnvelope | undefined;
    if (data?.error) {
      return data.error;
    }
    if (looksLikeHtmlPage(err.response?.data)) {
      return { code: 'BAD_GATEWAY', message: 'Máy chủ trả về trang web thay vì dữ liệu — tải lại trang, còn lỗi thì báo kỹ thuật.' };
    }
    return { code: 'INTERNAL_ERROR', message: 'Lỗi mạng, thử lại sau ít phút nhé.' };
  }
  // TypeError từ chính chỗ đọc `res.data.data...` khi body không đúng hình dạng. Không biết là
  // của request nào, nhưng nói "dữ liệu trả về không đúng" vẫn hơn hẳn "không xác định".
  if (err instanceof TypeError) {
    return { code: 'BAD_RESPONSE', message: 'Dữ liệu máy chủ trả về không đọc được — tải lại trang giúp mình.' };
  }
  return { code: 'INTERNAL_ERROR', message: 'Có lỗi không xác định.' };
}

/** Lỗi tạm thời do tải hoặc race — KHÔNG ảnh hưởng nghiệp vụ.
 * 5xx (server error có retry-able), 0 (network glitch), AbortError.
 * Dùng để skip toast trong polling — tránh user thấy thông báo lỗi nhấp nháy. */
export function isTransientError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (!status) return true;          // network error / no response
    if (status >= 500 && status < 600) return true;  // 500/502/503/504
    if (status === 408 || status === 429) return true;  // timeout / rate limit
    return false;
  }
  return false;
}

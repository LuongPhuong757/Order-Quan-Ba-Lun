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

export function extractError(err: unknown): { code: string; message: string; field_errors?: Array<{ field: string; message: string }> } {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ErrorEnvelope | undefined;
    if (data?.error) {
      return data.error;
    }
    return { code: 'INTERNAL_ERROR', message: 'Lỗi mạng, thử lại sau ít phút nhé.' };
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

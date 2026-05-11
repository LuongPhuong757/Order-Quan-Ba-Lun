// Axios client with re-login modal (P01.D-17) + friendly VN error tone (P01.D-18)
import axios, { AxiosError } from 'axios';
import type { ErrorEnvelope } from '@order/schemas';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  withCredentials: true, // cookies needed for JWT (F-17)
  validateStatus: (s) => s < 500, // let interceptor handle 4xx
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

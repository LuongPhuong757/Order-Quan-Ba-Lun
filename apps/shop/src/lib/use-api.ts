import { useEffect, useRef, useState } from 'react';
import type { ZodType } from 'zod';
import { ErrorEnvelope } from '@order/schemas';

/**
 * Lớp dữ liệu của apps/shop: `fetch` thuần + zod parse runtime (D-01, D-02).
 *
 * KHÔNG dùng `Axios` / TanStack Query — đây là quyết định cố ý (D-01), không
 * phải thiếu sót: apps/shop phải giữ 0 dependency HTTP mới vì khách vào bằng
 * mạng 3G. Không có analog thật trong repo — `apps/web/src/lib/api.ts` dùng
 * client HTTP đó + interceptor re-login + zod chỉ làm kiểu compile-time (không có
 * `.parse()`/`.safeParse()` nào chạy trên response thật). Ở đây, zod PHẢI
 * chạy thật trên mọi response vì `apps/api` đang `synchronize: true` không
 * migration (C-SCHEMA-07) — field đổi âm thầm phải biến thành lỗi đọc được
 * ngay tại chỗ, không phải `undefined` lan xuống render (T-08-27).
 *
 * Không tự retry ngầm, không cache — D-01 chấp nhận đánh đổi để giữ bundle nhẹ.
 */

/** 3 loại lỗi phân biệt được ở UI: BE trả lỗi có code, mất mạng, và response
 * không khớp schema (dấu hiệu BE đổi field — lỗi triển khai, không phải lỗi khách). */
export type ApiError = {
  code: string;
  message: string;
  kind: 'http' | 'network' | 'schema';
  /** Chỉ có khi BE trả `VALIDATION_FAILED` (ErrorEnvelope.error.field_errors) — plan 08-12
   * dùng để hiện lỗi cạnh đúng input thay vì chỉ 1 banner chung chung. */
  field_errors?: { field: string; message: string }[];
};

const SCHEMA_ERROR_MESSAGE =
  'Dữ liệu trả về không đúng định dạng mong đợi. Đây là lỗi kỹ thuật, không phải lỗi của bạn — vui lòng thử lại sau ít phút.';
const NETWORK_ERROR_MESSAGE = 'Không kết nối được mạng. Kiểm tra kết nối rồi thử lại nhé.';

async function parseErrorResponse(res: Response): Promise<ApiError> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { code: 'INTERNAL_ERROR', message: NETWORK_ERROR_MESSAGE, kind: 'network' };
  }
  const parsed = ErrorEnvelope.safeParse(json);
  if (!parsed.success) {
    return { code: 'INTERNAL_ERROR', message: SCHEMA_ERROR_MESSAGE, kind: 'schema' };
  }
  // BE đã nội suy sẵn message tiếng Việt — không tự dựng lại ở FE (08-PATTERNS.md).
  return {
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    kind: 'http',
    field_errors: parsed.data.error.field_errors,
  };
}

export type UseApiResult<T> = {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
};

/**
 * GET `path` bằng `fetch` thuần, zod-parse phần `data` của envelope thành công.
 * Huỷ request cũ bằng `AbortController` khi `path` đổi hoặc component unmount.
 */
export function useApi<T>(
  path: string,
  schema: ZodType<T>,
  opts?: { skip?: boolean },
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!opts?.skip);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const skip = opts?.skip ?? false;

  useEffect(() => {
    if (skip) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(path, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) {
          const apiErr = await parseErrorResponse(res);
          setError(apiErr);
          setData(null);
          return;
        }
        const json: unknown = await res.json();
        const envelope = (json as { data?: unknown } | null) ?? {};
        const parsed = schema.safeParse(envelope.data);
        if (!parsed.success) {
          setError({ code: 'INTERNAL_ERROR', message: SCHEMA_ERROR_MESSAGE, kind: 'schema' });
          setData(null);
          return;
        }
        setData(parsed.data);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError({ code: 'INTERNAL_ERROR', message: NETWORK_ERROR_MESSAGE, kind: 'network' });
        setData(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, skip, reloadTick]);

  const reloadRef = useRef(() => setReloadTick((t) => t + 1));
  return { data, loading, error, reload: reloadRef.current };
}

/**
 * POST `path` bằng `fetch` thuần, zod-parse phần `data` của envelope thành công.
 * Trả union `{data} | {error}` chứ KHÔNG throw, để trang checkout xử lý 8 mã lỗi
 * bằng nhánh dữ liệu thay vì try/catch lồng nhau.
 */
export async function postJson<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<{ data: T } | { error: ApiError }> {
  return sendJson('POST', path, body, schema);
}

/**
 * `DELETE path` — khách tự huỷ đơn (`DELETE /api/public/orders/:token`, M2.D-44).
 *
 * Không có body: `order_token` nằm trên URL. Dùng chung `sendJson` với `postJson` để `DELETE` đi
 * qua ĐÚNG một đường xử lý lỗi — nhất là `credentials: 'same-origin'` (trình duyệt mới gửi header
 * `Origin`, thứ `CsrfOriginGuard` bắt buộc phải có ở mọi mutation).
 */
export async function deleteJson<T>(
  path: string,
  schema: ZodType<T>,
): Promise<{ data: T } | { error: ApiError }> {
  return sendJson('DELETE', path, undefined, schema);
}

async function sendJson<T>(
  method: 'POST' | 'DELETE',
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<{ data: T } | { error: ApiError }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { error: { code: 'INTERNAL_ERROR', message: NETWORK_ERROR_MESSAGE, kind: 'network' } };
  }

  if (!res.ok) {
    return { error: await parseErrorResponse(res) };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { error: { code: 'INTERNAL_ERROR', message: SCHEMA_ERROR_MESSAGE, kind: 'schema' } };
  }
  const envelope = (json as { data?: unknown } | null) ?? {};
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    return { error: { code: 'INTERNAL_ERROR', message: SCHEMA_ERROR_MESSAGE, kind: 'schema' } };
  }
  return { data: parsed.data };
}

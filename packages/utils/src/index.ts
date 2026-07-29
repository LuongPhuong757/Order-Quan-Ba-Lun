/**
 * @order/utils — nơi ở của helper dùng chung giữa apps/api, apps/shop và apps/web.
 *
 * P08.D-59: `packages/ui` đã bị BỎ (nâng Toast/ConfirmDialog lên package chung sẽ
 * phải sửa 17 file của apps/web đang chạy production, mà repo có 0 test). Nên đây là
 * package mới DUY NHẤT của Milestone 2.
 *
 * Phase 07 chỉ ship đúng 1 helper để chứng minh được đường build end-to-end
 * (không `ERR_MODULE_NOT_FOUND` trong docker image — G-12). Package mà không ai
 * import thì không chứng minh được điều đó.
 *
 * Phase 08 thêm vào đây: normalizePhone, stripDiacritics, haversineKm,
 * isStoreOpenNow(now), maskPhone/maskAddress, formatVnd (xem P08.D-utilities).
 *
 * Zero runtime dependency — phải import được từ cả Node ESM (apps/api) lẫn
 * bundle trình duyệt (apps/shop).
 */

/** INTERFACE-STANDARDS.md § API Standard — success envelope. */
export type ApiOk<T> = {
  ok: true;
  data: T;
  message?: string;
  meta?: unknown;
  request_id?: string;
};

/**
 * Dựng success envelope đúng hình dạng INTERFACE-STANDARDS đòi.
 *
 * Bỏ hẳn `message` khi không truyền, thay vì gửi `message: undefined` —
 * `JSON.stringify` sẽ loại key undefined nhưng test so khớp tập khoá chính xác
 * (P08.D-65) chạy trên object trước khi serialize, nên phải sạch từ đầu.
 */
export function apiOk<T>(data: T, message?: string): ApiOk<T> {
  return message === undefined ? { ok: true, data } : { ok: true, data, message };
}

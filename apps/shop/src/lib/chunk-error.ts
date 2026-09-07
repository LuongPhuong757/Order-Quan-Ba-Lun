/**
 * Nhận diện lỗi "chunk cũ đã biến mất" và quyết định có tự tải lại trang hay không.
 *
 * Tách riêng khỏi `components/ErrorBoundary.tsx` vì đây là phần DUY NHẤT có thể test được:
 * boundary phải render và đọc `sessionStorage`, mà repo chạy vitest ở môi trường node, không
 * có jsdom (xem chú thích đầu `lib/cart-store.test.ts`). Nên mọi quyết định
 * nằm ở đây dưới dạng hàm thuần, còn boundary chỉ làm hai việc bẩn: đọc mốc thời gian và
 * gọi `location.reload()`.
 *
 * Bản sao y hệt nằm ở `apps/web/src/lib/chunk-error.ts` — sửa một bên thì sửa cả hai.
 *
 * KHÔNG gom vào `@order/utils` dù nó là hàm thuần và hai app dùng chung:
 * hiện `apps/web` và `apps/shop` chưa hề phụ thuộc package đó, thêm dependency mới là đụng
 * lockfile và đường build Docker (`packages/<tên>/dist` bị gitignore — đã một lần làm hỏng build
 * production). Với một bản vá lỗi production thì nhân đôi 20 dòng hàm thuần rẻ hơn nhiều so
 * với chạm vào đồ thị build.
 */

/**
 * Mỗi trình duyệt đặt một câu khác nhau cho cùng một sự việc, và không trình duyệt nào cho
 * mã lỗi riêng — chỉ còn cách khớp chuỗi:
 *
 * - Chrome/Edge: "Failed to fetch dynamically imported module: https://..."
 * - Firefox:     "error loading dynamically imported module"
 * - Safari:      "Importing a module script failed."
 * - Vite (mọi trình duyệt), khi chunk CSS đi kèm chết: "Unable to preload CSS for ..."
 *
 * So bằng chữ thường hai bên để khỏi phụ thuộc cách viết hoa của từng bản trình duyệt.
 * Nhận nhầm THIẾU (bỏ sót một câu) thì app trắng màn như cũ; nhận nhầm THỪA thì reload một
 * lần vô ích rồi hiện màn báo lỗi — nên khi phân vân, nghiêng về phía bắt rộng.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const m = message.toLowerCase();
  return (
    m.includes('dynamically imported module') ||
    m.includes('importing a module script failed') ||
    m.includes('unable to preload css') ||
    m.includes('failed to fetch dynamically')
  );
}

/**
 * Khoảng lặng giữa hai lần TỰ reload. Đủ dài để một lần reload thật (tải index.html + chunk
 * mới) kịp xong trên 4G yếu, đủ ngắn để lần deploy sau đó vẫn tự chữa được.
 */
export const RELOAD_COOLDOWN_MS = 15_000;

/**
 * Có nên tự `location.reload()` không?
 *
 * Điều kiện 2 (`now - lastReloadAt >= RELOAD_COOLDOWN_MS`) là thứ chặn vòng lặp vô tận: nếu
 * bản mới cũng hỏng — server rollback về image cũ, hoặc deploy đứt nửa chừng — thì không có
 * nó app sẽ reload → lỗi → reload → lỗi… và mỗi tab đang mở biến thành một máy đập vào
 * server. Quá khoảng lặng mà vẫn lỗi thì thà đứng lại hiện màn báo lỗi cho người dùng biết.
 *
 * `lastReloadAt = 0` nghĩa là chưa từng tự reload trong phiên này.
 */
export function shouldAutoReload(error: unknown, lastReloadAt: number, now: number): boolean {
  if (!isChunkLoadError(error)) return false;
  if (lastReloadAt > 0 && now - lastReloadAt < RELOAD_COOLDOWN_MS) return false;
  return true;
}

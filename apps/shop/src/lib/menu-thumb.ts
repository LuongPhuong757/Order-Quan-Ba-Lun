/**
 * URL thumbnail 400px của một ảnh món.
 *
 * Server ghi thumbnail CÙNG TÊN FILE vào `uploads/menu/thumb/` (xem
 * `apps/api/src/modules/menu/menu-image.ts`), nên suy ra từ URL gốc là đủ — không phải thêm
 * trường vào API. Ảnh không nằm ở `/uploads/menu/` (link ngoài, ảnh mẫu) → trả nguyên URL.
 *
 * Vì sao cần (đo 2026-10-30): lưới trang chủ tải ~60 ảnh 800px × 85–100KB = 3,6MB; khách
 * công nhân đi 4G chờ 15–30s rồi thoát. Bản 400px ≈ 20–30KB.
 *
 * Thumbnail có thể CHƯA tồn tại (ảnh cũ chưa chạy `pnpm thumbs:backfill`) — chỗ dùng phải lùi
 * về URL gốc khi ảnh lỗi, xem `FadeInImage`.
 */
const MENU_IMAGE = /^(\/uploads\/menu)\/([^/]+)$/;

export function menuThumbUrl(src: string): string {
  const m = MENU_IMAGE.exec(src);
  return m ? `${m[1]}/thumb/${m[2]}` : src;
}

// Ảnh NHỎ (thumbnail 400px) của một món — CÙNG tên file với ảnh gốc, chỉ khác thư mục
// (`/uploads/menu/x.jpg` → `/uploads/menu/thumb/x.jpg`, xem apps/api menu-image.ts MENU_THUMB_DIR).
// Bản sao của apps/shop/src/lib/menu-thumb.ts: màn Gọi món trên điện thoại (2026-11-09) hiện
// ảnh 56px cạnh mỗi món, tải ảnh gốc vài trăm KB cho ô 56px là phí mạng ngay giờ cao điểm.
// Ảnh cũ chưa chạy backfill thì chưa có thumbnail → nơi dùng phải lùi về ảnh gốc khi lỗi tải.

const MENU_IMAGE = /^(\/uploads\/menu)\/([^/]+)$/;

export function menuThumbUrl(src: string): string {
  const m = MENU_IMAGE.exec(src);
  return m ? `${m[1]}/thumb/${m[2]}` : src;
}

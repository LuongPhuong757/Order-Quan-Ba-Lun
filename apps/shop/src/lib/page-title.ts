/**
 * Tiêu đề tab theo từng màn của trang khách.
 *
 * ── VÌ SAO CÓ FILE NÀY (2026-09-23) ───────────────────────────────────────────────────────
 * `index.html` khai một `<title>` tĩnh, và trước đây KHÔNG route nào cập nhật nó. Hệ quả chỉ
 * lộ ra khi bắt đầu đo quảng cáo: báo cáo "Số lượt xem theo Tiêu đề trang" của GA4 gộp cả 7
 * màn vào một dòng duy nhất, nên không biết màn nào hút khách. Chiều "Đường dẫn trang" vẫn
 * tách đúng, nên đây là chuyện KHÓ ĐỌC BÁO CÁO chứ không phải sai số liệu.
 *
 * Kèm một lợi ích ngoài đo đạc: khách mở nhiều tab hoặc lưu bookmark không còn thấy 7 tab
 * giống hệt nhau.
 *
 * ── TRANG CHỦ CỐ Ý GIỮ NGUYÊN CHỮ CŨ ──────────────────────────────────────────────────────
 * `HOME_TITLE` phải khớp ĐÚNG `<title>` trong `index.html`. Đó là tiêu đề Google đã lập chỉ
 * mục cho `quanbalun.site`; đổi nó là đổi dòng chữ hiện trong kết quả tìm kiếm, một việc
 * chẳng liên quan gì tới cái bug đang sửa. Các màn con thì trước giờ không ai lập chỉ mục
 * riêng nên đặt tên mới thoải mái.
 *
 * ── TÊN MÀN ĐỨNG TRƯỚC ────────────────────────────────────────────────────────────────────
 * "Giỏ hàng · Quán Bà Lùn", không phải ngược lại: thanh tab bị bóp chỉ còn ~10 ký tự đầu, mà
 * mọi tiêu đề bắt đầu bằng "Quán Bà Lùn…" thì nhìn y hệt nhau — đúng cái bug đang sửa. Cùng
 * lý do với `apps/web/index.html` (ở đó "Admin" đứng đầu). Dấu `·` theo `NccPortalPage`.
 */

/** PHẢI khớp `<title>` trong `apps/shop/index.html` — xem docblock trên. */
const HOME_TITLE = 'Quán Bà Lùn — Đặt hàng';

/**
 * Quyển menu điện tử. Đặt ở đây (thay vì viết thẳng trong `MenuBookPage`) vì `main.tsx` cũng
 * cần đúng chuỗi này: nó phải set tiêu đề TRƯỚC `startGa()`, mà effect của `MenuBookPage` thì
 * chạy sau — không có nó thì lượt `page_view` đầu tiên trên `menu.<domain>` báo nhầm tên màn.
 */
export const MENU_BOOK_TITLE = 'Menu — Quán Bà Lùn';

const TITLES: Record<string, string> = {
  '/cart': 'Giỏ hàng · Quán Bà Lùn',
  '/checkout': 'Đặt hàng · Quán Bà Lùn',
  '/history': 'Đơn đã đặt · Quán Bà Lùn',
  '/top': 'Món bán chạy · Quán Bà Lùn',
  '/guide': 'Hướng dẫn · Quán Bà Lùn',
  '/thuc-don': MENU_BOOK_TITLE,
};

/** Tiền tố của dải báo môi trường dev — xem `applyPageTitle`. */
const DEV_PREFIX = '[DEV] ';

/**
 * Chuẩn hoá giống `sanitizePath()` bên API: bỏ query/hash, bỏ '/' cuối, hạ chữ thường. Đường
 * dẫn lạ rơi về tiêu đề trang chủ, khớp với route catch-all `*` (nó vẽ lại `MenuPage`).
 */
export function titleForPath(raw: string): string {
  const path = raw.split('?')[0].split('#')[0].toLowerCase();
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  // Hai route mang token: khớp theo tiền tố, không liệt kê được từng mã.
  if (trimmed.startsWith('/o/')) return 'Theo dõi đơn · Quán Bà Lùn';
  if (trimmed.startsWith('/anh-mon/')) return 'Cập nhật ảnh món · Quán Bà Lùn';
  return TITLES[trimmed] ?? HOME_TITLE;
}

/**
 * Đặt tiêu đề, GIỮ LẠI tiền tố `[DEV]` nếu đang có.
 *
 * `EnvBanner` gắn `[DEV] ` vào tiêu đề đúng MỘT lần lúc mount. Ghi đè thẳng `document.title`
 * mỗi lần đổi màn sẽ xoá mất tiền tố đó từ lần điều hướng thứ hai trở đi, và nhân viên đang
 * mở song song tab dev với tab quán thật mất dấu hiệu phân biệt — đúng loại nhầm lẫn mà dải
 * đỏ sinh ra để chặn.
 */
export function applyPageTitle(path: string): void {
  const next = titleForPath(path);
  document.title = document.title.startsWith(DEV_PREFIX) ? `${DEV_PREFIX}${next}` : next;
}

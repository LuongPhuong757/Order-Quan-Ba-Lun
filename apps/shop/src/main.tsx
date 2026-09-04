import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/fonts.css'; // @font-face phải khai báo TRƯỚC khi token dùng tên font
import './styles/tokens.css';
import './styles/motion.css'; // Dùng var(--dur-*)/var(--ease-*) nên phải nạp SAU tokens
import { AppShell } from './components/AppShell.tsx';
import { MenuPage } from './pages/MenuPage.tsx';
import { MenuBookPage } from './pages/MenuBookPage.tsx';

// Router thật của apps/shop (REQ-I..K, phase 08). 6 route + catch-all render
// lại MenuPage (khách gõ sai URL thì về menu, không thấy trang trắng).
// Trang xem màu tạm trước đây (file vẫn còn trên đĩa để tham khảo) không còn
// nằm trên đường import nào từ điểm mount này.

// ─── Tách chunk theo route (2026-08-07, ngân sách bundle) ────────────────────
// Trước đây cả 7 trang nằm trong MỘT file .js 476 KB: khách mở menu để xem có món gì
// vẫn phải tải kèm trang Hướng dẫn, trang Lịch sử đơn, trang Theo dõi đơn — những thứ
// phần lớn phiên truy cập không bao giờ mở. Trên 4G yếu đó là mấy giây nhìn màn trắng.
//
// MenuPage CỐ Ý import tĩnh, KHÔNG lazy: nó là `/` và cả catch-all `*`, tức là trang gần
// như mọi phiên đều vào đầu tiên. Lazy nó chỉ thêm một vòng request vào đúng đường
// găng của lần tải đầu — chậm hơn chứ không nhanh hơn.
//
// 6 trang còn lại lazy. Các trang dùng `export function` (không phải default) nên phải
// map `.then` sang `{ default }` — đây là dạng `React.lazy` yêu cầu.
// Vỏ chờ + lý do đặt `Suspense` ở đâu: xem `AppShell`.
const CartPage = lazy(() => import('./pages/CartPage.tsx').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() =>
  import('./pages/CheckoutPage.tsx').then((m) => ({ default: m.CheckoutPage })),
);
const OrderTrackPage = lazy(() =>
  import('./pages/OrderTrackPage.tsx').then((m) => ({ default: m.OrderTrackPage })),
);
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage.tsx').then((m) => ({ default: m.HistoryPage })),
);
const TopDishesPage = lazy(() =>
  import('./pages/TopDishesPage.tsx').then((m) => ({ default: m.TopDishesPage })),
);
const GuidePage = lazy(() =>
  import('./pages/GuidePage.tsx').then((m) => ({ default: m.GuidePage })),
);
// Trang cập nhật ảnh món qua link bí mật (2026-08-16) — cho NGƯỜI NHÀ chủ quán, không phải
// khách. Lazy để khách thường không tải một byte nào của nó; route đặt NGOÀI AppShell (không
// header/giỏ/footer — xem docblock trong file).
const PhotoUploadPage = lazy(() =>
  import('./pages/PhotoUploadPage.tsx').then((m) => ({ default: m.PhotoUploadPage })),
);

const root = document.getElementById('root');
if (!root) throw new Error('#root không tồn tại trong index.html');

/**
 * `menu.<domain>` = QUYỂN MENU ĐIỆN TỬ, không phải web đặt hàng (2026-09-04).
 *
 * Cùng một bundle phục vụ hai tên miền, giống hệt cách `apps/api/src/main.ts` chọn
 * `web-dist` hay `shop-dist` theo header `Host` — chỉ khác là ở đây việc chọn xảy ra trong
 * trình duyệt. Dựng hẳn một app Vite thứ ba chỉ để hiện một danh sách CHỈ ĐỌC là thêm một
 * Dockerfile, một lần build, và một bộ design token thứ hai phải giữ đồng bộ bằng tay;
 * không đáng.
 *
 * Cắt port trước khi so (`menu.localhost:5173` → `menu.localhost`) để chạy thử được ở máy
 * local — cùng lý do và cùng cách làm với `isAdminHost` bên API.
 *
 * `MenuBookPage` import TĨNH chứ không `lazy`: trên tên miền menu nó là thứ DUY NHẤT cần
 * vẽ, lazy nó chỉ thêm đúng một vòng request vào đường găng của lần tải đầu. Đổi lại,
 * khách vào tên miền đặt hàng tải thừa vài KB — rẻ hơn nhiều so với việc bắt mọi khách xem
 * menu chờ thêm một vòng mạng 3G.
 */
const isMenuHost = window.location.hostname.split(':')[0].toLowerCase().startsWith('menu.');

if (isMenuHost) {
  // KHÔNG bọc `AppShell` (header có giỏ, giỏ nổi, thanh đơn đang chạy) và KHÔNG cần
  // `BrowserRouter`: quyển menu chỉ có đúng một màn, mọi đường dẫn trên tên miền đó đều
  // dẫn về nó. Bỏ router cũng là bỏ luôn mọi đường trang này có thể điều hướng sang màn
  // đặt hàng — thứ duy nhất nó làm được là hiển thị.
  createRoot(root).render(
    <StrictMode>
      <MenuBookPage />
    </StrictMode>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <Routes>
          {/* Ngoài AppShell: trang cho người nhà chủ quán, không cần (và không nên có) header/giỏ.
              Suspense riêng vì vỏ chờ của AppShell không bao tới đây. */}
          <Route
            path="/anh-mon/:token"
            element={
              <Suspense fallback={null}>
                <PhotoUploadPage />
              </Suspense>
            }
          />
          <Route element={<AppShell />}>
            <Route path="/" element={<MenuPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/o/:token" element={<OrderTrackPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/top" element={<TopDishesPage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="*" element={<MenuPage />} />
          </Route>
          {/* Quyển menu cũng mở được từ tên miền chính (`quanbalun.site/thuc-don`) — tiện khi
              cần dán một đường dẫn duy nhất cho khách. CỐ Ý nằm NGOÀI `<Route
              element={<AppShell/>}>`: trang này không có header giỏ hàng, không giỏ nổi.
              React Router xếp hạng đường dẫn tĩnh cao hơn `*`, nên đường dẫn này vẫn thắng
              catch-all dù đứng sau nó.

              ⚠ KHÔNG ĐƯỢC đặt là `/menu`. Cùng một server Node vừa chạy API vừa trả file
              tĩnh của SPA, mà API đã có sẵn `@Controller('menu')` (màn quản lý menu, yêu cầu
              đăng nhập). Route của Nest được khớp TRƯỚC nhánh trả index.html, nên
              `quanbalun.site/menu` không bao giờ tới được React — nó trả thẳng 401 JSON.
              Đã dính đúng lỗi này lúc deploy 2026-09-04. `/thuc-don` không đụng controller
              nào, và cũng dễ đọc hơn với khách Việt. */}
          <Route path="/thuc-don" element={<MenuBookPage />} />
        </Routes>
      </BrowserRouter>
    </StrictMode>,
  );
}

// ─── Nạp trước đường đi mua hàng khi máy rảnh ────────────────────────────────
// Tách chunk giúp lần tải đầu nhẹ, nhưng đổi lại lần đầu bấm vào giỏ là một vòng request
// mới. Giỏ → Đặt hàng là luồng KIẾM TIỀN, không được phép có nhịp chờ nào.
//
// Nên: sau khi menu đã vẽ xong và máy rảnh, âm thầm kéo sẵn 2 chunk đó về cache. Khách bấm
// giỏ thì nó đã nằm sẵn trong máy — nhanh như hồi còn gộp một bundle, mà lần tải đầu vẫn nhẹ.
//
// `requestIdleCallback` để việc này KHÔNG giành băng thông/CPU với ảnh món đang tải: Safari iOS
// chưa hỗ trợ nên fallback `setTimeout` 2 giây (qua lúc trang tải xong là chắc chắn).
// Lỗi thì bỏ qua có chủ ý — đây chỉ là nạp trước, lát nữa `React.lazy` sẽ tự thử lại thật.
const prefetchBuyingPath = () => {
  void import('./pages/CartPage.tsx').catch(() => {});
  void import('./pages/CheckoutPage.tsx').catch(() => {});
};

// Kiểm bằng `typeof window.requestIdleCallback` chứ KHÔNG dùng `'requestIdleCallback' in window`:
// lib.dom khai hàm này là luôn có, nên `in` làm TS thu hẹp nhánh else thành `never` rồi báo
// "Property 'setTimeout' does not exist on type 'never'". Kiểm typeof chỉ thu hẹp thuộc tính đó.
// `!isMenuHost`: khách vào quyển menu không có đường nào dẫn tới giỏ hay trang đặt hàng,
// kéo sẵn 2 chunk đó về máy họ chỉ là tốn băng thông 3G cho thứ không bao giờ mở tới.
if (!isMenuHost) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(prefetchBuyingPath, { timeout: 3000 });
  } else {
    window.setTimeout(prefetchBuyingPath, 2000);
  }
}

import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// API proxy phải bypass khi browser request HTML (reload trang React route trùng tên BE).
// Vd: GET /orders với Accept: text/html → user reload màn /orders trên browser
//     → trả index.html (SPA fallback) thay vì proxy sang BE (BE trả JSON gây bug).
// Còn fetch/axios mặc định gửi Accept: application/json → vẫn proxy bình thường.
const apiProxy = (target = 'http://localhost:3001'): ProxyOptions => ({
  target,
  changeOrigin: true,
  bypass(req) {
    if (req.headers.accept?.includes('text/html')) {
      return '/index.html';
    }
    return undefined;
  },
});

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth':        apiProxy(),
      '/admin':       apiProxy(),
      '/setup':       apiProxy(),
      '/health':      apiProxy(),
      '/menu':        apiProxy(),
      '/menu-groups': apiProxy(),
      '/tables':      apiProxy(),
      '/orders':      apiProxy(),
      '/uploads':     apiProxy(),
      // Định lượng nguyên liệu (2026-09-05). ⚠ DANH SÁCH NÀY LÀ CỨNG: thêm controller mới ở
      // BE mà quên thêm vào đây thì dev server nuốt request và trả về index.html — axios nhận
      // HTML thay vì JSON và màn hình vỡ, trong khi log API sạch bong vì request chưa từng
      // tới nơi. Production KHÔNG có bẫy này (Caddy proxy toàn bộ về api:3001), nên lỗi chỉ
      // xuất hiện khi chạy local.
      '/ingredients': apiProxy(),
      '/recipes':     apiProxy(),
      '/consumption': apiProxy(),
      // Nhà cung cấp (2026-09-05..06) — chính là cái bẫy mô tả ở trên: thiếu 4 dòng này thì mọi
      // request của màn NCC bị vite trả index.html, axios parse HTML rồi văng lỗi hàng loạt.
      // `/suppliers` trùng tên với route React `/suppliers`, nhưng `bypass()` ở trên đã tách:
      // browser mở trang (Accept: text/html) → index.html, axios gọi API → proxy sang BE.
      '/suppliers':          apiProxy(),
      '/supplier-deliveries': apiProxy(),
      '/supplier-reports':    apiProxy(),
      // Cổng NCC tự đăng nhập (màn /ncc)
      '/supplier-portal':     apiProxy(),
    },
  },
  build: {
    // Cùng lý do như apps/shop/vite.config.ts: `manifest` để `scripts/check-bundle-budget.mjs`
    // phân biệt được chunk tải-lần-đầu với chunk lazy; `chunkSizeWarningLimit` là lưới thô thứ hai
    // sau cửa chắn gzip thật ở `pnpm bundle:budget`.
    manifest: true,
    chunkSizeWarningLimit: 450,
  },
});

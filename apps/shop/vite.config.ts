import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// Cùng lý do như apps/web/vite.config.ts: proxy phải bypass khi browser request HTML.
// Khách reload /cart hoặc /o/<token> → Accept: text/html → trả index.html (SPA fallback)
// thay vì proxy sang BE. Còn fetch() mặc định gửi Accept: application/json → proxy bình thường.
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
    // 5173 là của apps/web — strictPort để không âm thầm nhảy sang port khác
    // rồi ALLOWED_ORIGIN không khớp lúc dev.
    port: 5174,
    strictPort: true,
    proxy: {
      // Chỉ 2 key. apps/web proxy 9 prefix không có /api; trang khách chỉ gọi
      // /api/public/* và /api/admin/* nên khai /api là đủ.
      '/api': apiProxy(),
      // Ảnh món lưu đường dẫn tương đối /uploads/menu/<file> (M2.D-66 phần /uploads).
      '/uploads': apiProxy(),
    },
  },
  build: {
    outDir: 'dist',
    // `manifest` cho `scripts/check-bundle-budget.mjs` biết chunk nào là entry và chunk nào được
    // entry import TĨNH — tức là chính xác những file khách phải tải xong mới thấy trang đầu.
    // Không có manifest thì script chỉ cộng bừa mọi file .js trong dist, mà từ 2026-08-07 phần lớn
    // số đó là chunk lazy chỉ tải khi khách bấm vào — cộng vào là ra một con số vô nghĩa.
    manifest: true,
    // Cảnh báo mặc định của Vite là 500 kB và tính theo RAW nên khá thô. Cửa chắn thật là
    // `pnpm bundle:budget` (tính theo gzip = số byte đi qua 4G). Để 450 ở đây làm lưới thứ hai:
    // đủ rộng để không kêu oan hôm nay, đủ chặt để hét lên nếu ai gộp lại thành một bundle.
    chunkSizeWarningLimit: 450,
  },
});

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
    },
  },
});

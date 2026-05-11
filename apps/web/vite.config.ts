import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth':   'http://localhost:3001',
      '/admin':  'http://localhost:3001',
      '/setup':  'http://localhost:3001',
      '/health': 'http://localhost:3001',
      '/menu':    'http://localhost:3001',
      '/menu-groups': 'http://localhost:3001',
      '/tables':  'http://localhost:3001',
      '/orders':  'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
});

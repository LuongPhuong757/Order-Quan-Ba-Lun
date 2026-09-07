import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    {/* `ErrorBoundary` bọc NGOÀI CÙNG, ngoài cả `<BrowserRouter>`: lỗi có thể văng ra từ
        `AuthProvider` hay từ chính router, tức là từ những chỗ nằm ngoài mọi boundary đặt
        bên trong `<App/>`. Bọc ở đây thì không còn đường nào để một lỗi xoá trắng `#root`.
        Xem docblock trong `ErrorBoundary.tsx`: vì sao trang hay trắng ngay sau một lần deploy. */}
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

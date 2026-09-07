import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { EnvBanner } from './components/EnvBanner.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    {/* NGOÀI `<BrowserRouter>` và ngoài `<App/>`: dải này phải có mặt trên MỌI màn, kể cả
        màn đăng nhập và /setup — những màn nằm ngoài layout có header. Màn đăng nhập là
        đúng chỗ dễ nhầm nhất: hai tab dev và thật trông giống hệt nhau khi chưa đăng nhập.

        Và cũng NGOÀI `<ErrorBoundary>` (2026-09-07): màn báo lỗi phải mang theo dải đỏ.
        Đúng lúc có sự cố là lúc dễ nhầm nhất "mình đang xem bản thử hay trang thật của
        quán" — nhét dải vào trong boundary là mất nó ở đúng cái màn cần nó nhất. */}
    <EnvBanner />
    {/* `ErrorBoundary` bọc NGOÀI CÙNG phần app, ngoài cả `<BrowserRouter>`: lỗi có thể văng
        ra từ `AuthProvider` hay từ chính router, tức là từ những chỗ nằm ngoài mọi boundary
        đặt bên trong `<App/>`. Bọc ở đây thì không còn đường nào để một lỗi xoá trắng
        `#root`. Xem docblock trong `ErrorBoundary.tsx`: vì sao trang hay trắng ngay sau
        một lần deploy. */}
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { EnvBanner } from './components/EnvBanner.tsx';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    {/* NGOÀI `<BrowserRouter>` và ngoài `<App/>`: dải này phải có mặt trên MỌI màn, kể cả
        màn đăng nhập và /setup — những màn nằm ngoài layout có header. Màn đăng nhập là
        đúng chỗ dễ nhầm nhất: hai tab dev và thật trông giống hệt nhau khi chưa đăng nhập. */}
    <EnvBanner />
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

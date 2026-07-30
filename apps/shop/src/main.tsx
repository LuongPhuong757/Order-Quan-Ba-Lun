import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/fonts.css'; // @font-face phải khai báo TRƯỚC khi token dùng tên font
import './styles/tokens.css';
import { AppShell } from './components/AppShell.tsx';
import { MenuPage } from './pages/MenuPage.tsx';
import { CartPage } from './pages/CartPage.tsx';
import { CheckoutPage } from './pages/CheckoutPage.tsx';
import { OrderTrackPage } from './pages/OrderTrackPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';

// Router thật của apps/shop (REQ-I..K, phase 08). 5 route + catch-all render
// lại MenuPage (khách gõ sai URL thì về menu, không thấy trang trắng).
// Trang xem màu tạm trước đây (file vẫn còn trên đĩa để tham khảo) không còn
// nằm trên đường import nào từ điểm mount này.

const root = document.getElementById('root');
if (!root) throw new Error('#root không tồn tại trong index.html');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<MenuPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/o/:token" element={<OrderTrackPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<MenuPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css'; // @font-face phải khai báo TRƯỚC khi token dùng tên font
import './styles/tokens.css';
import { BrandPreview } from './BrandPreview.tsx';

// TODO(phase-08): thay BrandPreview bằng BrowserRouter + App shell
// (AppShell + AppHeader 2 biến thể) và 4 trang trong src/pages/.
// Hiện 4 trang đó CHƯA được gắn router — xem 07-04-SUMMARY.md.
//
// BrandPreview là trang tạm để chủ quán xem và duyệt bảng màu rút từ ảnh món ăn
// (chốt 2026-07-30). Xoá khi phase 08 dựng router thật.

const root = document.getElementById('root');
if (!root) throw new Error('#root không tồn tại trong index.html');

createRoot(root).render(
  <StrictMode>
    <BrandPreview />
  </StrictMode>,
);

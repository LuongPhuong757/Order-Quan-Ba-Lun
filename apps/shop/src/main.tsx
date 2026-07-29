import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';

// TODO(task-10): thay bằng BrowserRouter + App shell (AppShell + AppHeader 2 biến thể).
// Task 01 chỉ cần một điểm mount chạy được để package build xanh từ wave 1.

const root = document.getElementById('root');
if (!root) throw new Error('#root không tồn tại trong index.html');

createRoot(root).render(
  <StrictMode>
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--sp-4, 16px)',
        background: 'var(--bg-page, #fff9f8)',
        color: 'var(--text-strong, #1c1917)',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
        textAlign: 'center',
      }}
    >
      Trang khách đang được dựng — phase 07
    </main>
  </StrictMode>,
);

import type { JSX } from 'react';

/**
 * REQ-I — khung trang Menu.
 *
 * Nội dung thật (lưới món, dải danh mục, ô tìm kiếm lọc client-side theo `?q=`,
 * banner OFF/ngoài giờ) là plan 08-09. Plan 08-04 chỉ dựng khung + trạng thái
 * tải để router có gì đó render ở `/` thay vì trang trắng.
 */
export function MenuPage(): JSX.Element {
  return (
    <main style={page}>
      <h1 style={heading}>Menu</h1>
      <section style={grid} data-testid="menu-grid">
        <p style={loading}>Đang tải menu...</p>
      </section>
    </main>
  );
}

const page = {
  minHeight: '100vh',
  padding: 'var(--sp-4)',
  background: 'var(--bg-page)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
} as const;

const heading = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  margin: '0 0 var(--sp-4)',
} as const;

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 'var(--sp-5)',
} as const;

const loading = {
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
} as const;

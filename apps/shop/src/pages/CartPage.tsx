import type { JSX } from 'react';
import { Link } from 'react-router-dom';

/**
 * Placeholder — giỏ hàng thật là phase 08 (P08.D-04 lưu localStorage chỉ
 * {menu_item_id, qty, note}, P08.D-46 stepper 2 bước).
 * Task 10 gắn trang này vào router shell.
 */
export function CartPage(): JSX.Element {
  return (
    <main style={page}>
      <h1 style={heading}>Giỏ hàng</h1>
      <p style={body}>Chức năng này sẽ có ở phase 08.</p>
      <Link to="/" data-testid="cart-back-link" style={backLink}>
        ← Về trang menu
      </Link>
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
  margin: '0 0 var(--sp-2)',
} as const;

const body = {
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
  margin: '0 0 var(--sp-4)',
} as const;

const backLink = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-button)',
  fontSize: 'var(--fs-base)',
  color: 'var(--brand-600)',
  textDecoration: 'none',
} as const;

import type { CSSProperties, JSX } from 'react';
import { Link } from 'react-router-dom';
import { readLastOrderToken } from '../lib/customer-token.ts';

/**
 * `/history` — empty state TĨNH, KHÔNG gọi BE (plan 08-11).
 *
 * Endpoint danh sách đơn theo `customer_token` KHÔNG thuộc phạm vi phase 8 (dời phase
 * 9/10 — danh sách đơn thật là REQ-O). Đây là quyết định phạm vi có chủ đích, KHÔNG
 * phải trang chưa làm xong: trang chỉ đọc `readLastOrderToken()` đã có sẵn trong
 * localStorage (lưu lúc submit thành công, plan 08-06/08-12) để cho khách 1 lối ra
 * hữu ích ngay từ phase 8, không cần gọi API nào.
 */
export function HistoryPage(): JSX.Element {
  const lastToken = readLastOrderToken();

  return (
    <main style={page}>
      <h1 style={heading}>Đơn của tôi</h1>
      <p style={body}>Lịch sử đơn sẽ hiện ở đây.</p>

      {lastToken ? (
        <Link to={`/o/${lastToken}`} style={ctaButton}>
          Xem đơn gần nhất
        </Link>
      ) : (
        <Link to="/" style={ctaButton}>
          Xem menu
        </Link>
      )}

      <Link to="/" data-testid="history-back-link" style={backLink}>
        ← Về trang menu
      </Link>
    </main>
  );
}

const page: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: `var(--sp-6) var(--gutter)`,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 'var(--sp-3)',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  color: 'var(--text-strong)',
};

const body: CSSProperties = {
  margin: '0 0 var(--sp-2)',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

const ctaButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-6)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textDecoration: 'none',
};

const backLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-button)',
  fontSize: 'var(--fs-base)',
  color: 'var(--brand-600)',
  textDecoration: 'none',
  marginTop: 'var(--sp-2)',
};

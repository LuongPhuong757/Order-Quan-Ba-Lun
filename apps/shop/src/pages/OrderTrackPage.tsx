import type { JSX } from 'react';
import { Link, useParams } from 'react-router-dom';

/**
 * Placeholder — trang theo dõi đơn thật là phase 08/09.
 *
 * `order_token` trong URL **chính là credential** của đơn (M2.D-11, P08.D-74:
 * 32 byte random hex, lưu plaintext, HTTPS là lớp bảo vệ duy nhất). Nên:
 *  - KHÔNG bao giờ render token đầy đủ ra text — chỉ 4 ký tự đầu.
 *  - Đây là lý do Task 11 đặt `Referrer-Policy: no-referrer` cho site block
 *    `order.<domain>`: URL không được rò qua header Referer sang asset bên ngoài.
 *
 * Phase 08 thêm: danh sách món + tổng tiền + nút gọi quán + nút sửa/huỷ
 * (P08.D-31, P08.D-48). Phase 09 thêm % tiến độ + 5 mốc trạng thái.
 * KHÔNG đếm ngược 45 phút (P08.D-48).
 */
export function OrderTrackPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const masked = token ? `${token.slice(0, 4)}…` : '—';

  return (
    <main style={page}>
      <h1 style={heading}>Theo dõi đơn</h1>
      <p style={body}>Chức năng này sẽ có ở phase 08.</p>
      <p style={tokenLine}>
        Mã đơn: <span style={mono}>{masked}</span>
      </p>
      <Link to="/" data-testid="order-track-back-link" style={backLink}>
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
  margin: '0 0 var(--sp-2)',
} as const;

const tokenLine = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  margin: '0 0 var(--sp-4)',
} as const;

const mono = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-strong)',
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

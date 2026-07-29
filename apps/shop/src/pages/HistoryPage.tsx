import type { JSX } from 'react';
import { Link } from 'react-router-dom';

/**
 * Placeholder — lịch sử đơn theo thiết bị là phase 08.
 *
 * Phase 08: đọc theo header `X-Customer-Token` (P08.D-34 — token rời khỏi query
 * string vì Caddy ghi nguyên URI vào log), che SĐT 4 số cuối + chỉ tên đường
 * (P08.D-15c), mỗi dòng bấm được để mở `/o/:token` (P08.D-46), và nút
 * "Không phải tôi / xoá thông tin trên máy này" gọi API ẩn danh hoá đơn đã
 * kết thúc (P08.D-70).
 */
export function HistoryPage(): JSX.Element {
  return (
    <main style={page}>
      <h1 style={heading}>Đơn của tôi</h1>
      <p style={body}>Chức năng này sẽ có ở phase 08.</p>
      <Link to="/" data-testid="history-back-link" style={backLink}>
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

import type { CSSProperties, JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicOrderStatus } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { formatVnd } from '../lib/cart-store.ts';
import { BannerNotice } from '../components/BannerNotice.tsx';

/**
 * `/o/:token` — màn xác nhận tối giản, đúng phần thuộc phase 8 (plan 08-11).
 *
 * `order_token` trong URL **chính là credential** của đơn (M2.D-11, P08.D-74: 32 byte
 * random hex, lưu plaintext, HTTPS là lớp bảo vệ duy nhất). Nên:
 *  - KHÔNG bao giờ render token đầy đủ ra text — chỉ 4 ký tự đầu.
 *  - Đây là lý do Task 11 đặt `Referrer-Policy: no-referrer` cho site block
 *    `order.<domain>`: URL không được rò qua header Referer sang asset bên ngoài.
 *
 * Phase 8 chỉ dựng: tiêu đề xác nhận + danh sách món đã gửi + tổng tiền + nút gọi
 * quán. KHÔNG thi công % tiến độ, 5 mốc trạng thái, banner "quán vừa cập nhật đơn",
 * hay trạng thái từng món — toàn bộ thuộc REQ-O / phase 9 UI-SPEC (chèn ngay dưới
 * banner trạng thái đơn, phía trên danh sách món). Đặc biệt: response `PublicOrderStatus`
 * KHÔNG có trạng thái từng item (M2.D-23) nên đừng đi tìm field đó.
 */
export function OrderTrackPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const masked = token ? `${token.slice(0, 4).toUpperCase()}…` : '—';
  const { data, loading, error, reload } = useApi(
    `/api/public/orders/${token ?? ''}`,
    PublicOrderStatus,
    { skip: !token },
  );

  // Tách 1 biến duy nhất để literal mã lỗi chỉ xuất hiện đúng 1 lần trong file
  // (grep dễ kiểm, dùng lại kỹ thuật BannerNotice.tsx áp cho role="alert"/"status").
  const isTokenNotFound = error?.code === 'ORDER_TOKEN_NOT_FOUND';

  return (
    <div style={page}>
      {loading && <SkeletonBlock />}

      {!loading && error && (
        <BannerNotice
          tone="danger"
          title={isTokenNotFound ? 'Không tìm thấy đơn này. Có thể link đã cũ.' : error.message}
          action={isTokenNotFound ? undefined : { label: 'Thử lại', onClick: reload }}
        />
      )}
      {!loading && error && isTokenNotFound && (
        <Link to="/" style={ctaButton}>
          Về menu
        </Link>
      )}

      {!loading && !error && data && (
        <>
          <div style={successHead}>
            <CheckGlyph />
            <h1 style={heading}>Đã gửi đơn thành công!</h1>
          </div>
          <p style={orderCode}>
            Mã đơn: <span style={mono}>{masked}</span>
          </p>
          <p style={statusLine}>Quán sẽ xác nhận sớm nhất có thể</p>

          {/* ── Chỗ chèn phase 9 (REQ-O): banner % tiến độ + 5 mốc trạng thái +
              banner "quán vừa cập nhật đơn" đặt NGAY TẠI ĐÂY, phía trên danh sách
              món bên dưới. Response hiện tại không có trạng thái từng item
              (M2.D-23) nên không tự suy diễn thêm cột nào ở bảng dưới. ── */}

          <ul style={itemList}>
            {data.items.map((item, idx) => (
              <li key={idx} style={itemRow}>
                <span style={itemName}>
                  {item.name} × {item.qty}
                </span>
                <span style={itemPrice}>{formatVnd(item.unit_price * item.qty)}</span>
              </li>
            ))}
          </ul>
          <div style={totalRow}>
            <span style={totalLabel}>Tổng cộng</span>
            <span style={totalValue}>{formatVnd(data.subtotal)}</span>
          </div>

          <a href={`tel:${data.store_phone.replace(/[^0-9+]/g, '')}`} style={ctaButton}>
            Gọi quán: {data.store_phone}
          </a>
        </>
      )}

      <Link to="/" data-testid="order-track-back-link" style={backLink}>
        ← Về trang menu
      </Link>
    </div>
  );
}

function CheckGlyph(): JSX.Element {
  return (
    <svg
      width={40}
      height={40}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--herb-600)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </svg>
  );
}

function SkeletonBlock(): JSX.Element {
  return (
    <div style={skeletonWrap} aria-hidden="true">
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{SKELETON_CSS}</style>
      <div className="shop-track-skel" style={skeletonLine} />
      <div className="shop-track-skel" style={{ ...skeletonLine, width: '60%' }} />
      <div className="shop-track-skel" style={{ ...skeletonLine, height: 'var(--sp-16)' }} />
    </div>
  );
}

const SKELETON_CSS = `
.shop-track-skel { animation: shop-track-pulse 1.1s ease-in-out infinite; }
@keyframes shop-track-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
  .shop-track-skel { animation: none; }
}
`;

const page: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: `var(--sp-6) var(--gutter)`,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
};

const successHead: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  textAlign: 'center',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  color: 'var(--text-strong)',
};

const orderCode: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

const mono: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-strong)',
};

const statusLine: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const itemList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const itemRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-strong)',
};

const itemName: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const itemPrice: CSSProperties = {
  flexShrink: 0,
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const totalRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `0 var(--sp-1)`,
};

const totalLabel: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const totalValue: CSSProperties = {
  fontSize: 'var(--fs-2xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-strong)',
};

// Dùng chung cho cả nút gọi quán và nút "Về menu" khi token sai — cùng 1 kiểu
// nút hành động chính, tránh khai 2 object CSS trùng nhau.
const ctaButton: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textDecoration: 'none',
};

const skeletonWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const skeletonLine: CSSProperties = {
  height: 'var(--sp-6)',
  width: '100%',
  borderRadius: 'var(--r-card)',
  background: 'var(--bg-sunken)',
};

const backLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-button)',
  fontSize: 'var(--fs-base)',
  color: 'var(--brand-600)',
  textDecoration: 'none',
  alignSelf: 'center',
};

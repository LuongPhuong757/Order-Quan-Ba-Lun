import type { CSSProperties, JSX } from 'react';

/**
 * Icon giỏ hàng + badge số món (REQ-I — "giỏ hàng nổi hiện tổng tiền", G-3).
 *
 * SVG tự vẽ tay (D-22 giả định #2 — không dùng package icon ngoài, giữ triết
 * lý tự-host của dự án). `stroke="currentColor"` để icon ăn theo màu chữ nơi
 * đặt nó (header desktop chữ đậm, header mobile tương tự).
 *
 * Badge ẩn hoàn toàn khi `count === 0` — không hiện vòng tròn rỗng.
 */
type Props = {
  count: number;
  /** Kích thước icon, px. Mặc định 20 (24 khi đặt ở header theo UI-SPEC). */
  size?: number;
};

export function CartIcon({ count, size = 20 }: Props): JSX.Element {
  return (
    <span style={wrap}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 4h2l2.2 11.6a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20.4 8H6" />
        <circle cx="9.5" cy="20" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="17" cy="20" r="1.4" fill="currentColor" stroke="none" />
      </svg>
      {count > 0 && (
        <span style={badge} aria-hidden="true">
          {count}
        </span>
      )}
    </span>
  );
}

const wrap: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const badge: CSSProperties = {
  position: 'absolute',
  top: '-8px',
  right: '-8px',
  minWidth: '18px',
  height: '18px',
  padding: '0 var(--sp-1)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--r-badge)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  lineHeight: 1,
};

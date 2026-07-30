import type { CSSProperties, JSX } from 'react';

/**
 * Placeholder ảnh cho món chưa có ảnh (D-10).
 *
 * KHÔNG dùng 1 ảnh mặc định chung cho mọi món — nhiều món cùng 1 ảnh trông
 * như lỗi dữ liệu. Thay vào đó: khối nền gỗ ấm + icon bát tự vẽ + tên món,
 * để "trông có chủ ý" thay vì giống khung trống/ảnh lỗi. Vùng ảnh KHÔNG bị ẩn
 * (nếu ẩn thì lưới món so le giữa các card có/không ảnh).
 */
type Props = {
  name: string;
};

export function ImagePlaceholder({ name }: Props): JSX.Element {
  return (
    <div style={frame} role="img" aria-label={`${name} — chưa có ảnh`}>
      <BowlGlyph />
      <span style={label}>{name}</span>
    </div>
  );
}

function BowlGlyph(): JSX.Element {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={glyph}
    >
      {/* Bát + đũa cách điệu — gợi "món ăn" thay vì icon ảnh lỗi chung chung. */}
      <path d="M3 11h18a9 8 0 0 1-18 0Z" />
      <path d="M5 11c0-2.5 3-6 7-6s7 3.5 7 6" strokeDasharray="1 3" />
      <path d="M17 4.5 20 2" />
    </svg>
  );
}

const frame: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
  width: '100%',
  aspectRatio: '4 / 3',
  background: 'var(--wood-100)',
  borderRadius: 'var(--r-card)',
  padding: 'var(--sp-3)',
  textAlign: 'center',
};

const glyph: CSSProperties = {
  color: 'var(--wood-700)',
  flexShrink: 0,
};

const label: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--wood-700)',
  fontFamily: 'var(--font-body)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

import type { CSSProperties, JSX } from 'react';

/**
 * Logo chữ (wordmark) Quán Bà Lùn.
 *
 * Vì sao là wordmark chứ không phải ảnh:
 *   - `apps/web/public/logo.jpg` ở trang admin là ảnh chân dung cá nhân, không
 *     phải logo quán — không dùng cho trang khách công khai (chốt 2026-07-30).
 *   - 4 ảnh món ăn của quán đều đã có biển tên: biển phấn đen, thẻ gỗ, thẻ tre.
 *     Wordmark này dựng theo biển phấn (ảnh lẩu hải sản): "QUÁN" nhỏ, giãn chữ,
 *     nằm trên "BÀ LÙN" lớn đậm.
 *   - Là chữ nên nét luôn sạch ở mọi mật độ điểm ảnh, không cần @2x/@3x, và
 *     không tốn thêm request ảnh trên mạng 3G.
 *
 * Đổi sang logo ảnh thật sau: thay ruột component này, mọi chỗ gọi giữ nguyên.
 *
 * CHÚ Ý VỀ FONT: `--font-display` khai báo 'Baloo 2' nhưng font đó CHƯA được
 * self-host (chưa có apps/shop/public/fonts/ + fonts.css — xem ghi chú trong
 * tokens.css). Hiện wordmark rơi về font hệ thống. Khi nạp Baloo 2 xong, chữ sẽ
 * bo tròn ấm hơn, không cần sửa file này.
 */

type Props = {
  /** `plaque` = biển gỗ đậm (dùng ở header). `bare` = chữ trần trên nền sáng. */
  variant?: 'plaque' | 'bare';
  /** Chiều cao dòng "BÀ LÙN" — token cỡ chữ, mặc định --fs-md. */
  size?: string;
};

export function Wordmark({ variant = 'plaque', size = 'var(--fs-md)' }: Props): JSX.Element {
  const onDark = variant === 'plaque';
  return (
    <span
      style={variant === 'plaque' ? plaque : bare}
      role="img"
      aria-label="Quán Bà Lùn"
    >
      <span style={{ ...kicker, color: onDark ? 'var(--wood-400)' : 'var(--wood-700)' }}>
        Quán
      </span>
      <span
        style={{
          ...name,
          fontSize: size,
          color: onDark ? 'var(--text-on-wood)' : 'var(--brand-600)',
        }}
      >
        Bà Lùn
      </span>
    </span>
  );
}

const base: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 'var(--lh-tight)',
  // Không cho chữ bị chọn/kéo khi khách bấm nhanh 2 lần trên mobile.
  userSelect: 'none',
};

const plaque: CSSProperties = {
  ...base,
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--r-card)',
  background: 'var(--bg-wood)',
  // Viền hổ phách mảnh = đường khắc trên biển gỗ trong ảnh quán.
  boxShadow: 'inset 0 0 0 1px var(--wood-500)',
};

const bare: CSSProperties = base;

const kicker: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  textTransform: 'uppercase',
};

const name: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  letterSpacing: 'var(--ls-tight)',
  whiteSpace: 'nowrap',
};

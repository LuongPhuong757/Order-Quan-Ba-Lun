import type { CSSProperties, JSX } from 'react';

/**
 * Placeholder ảnh cho món chưa có ảnh (D-10).
 *
 * KHÔNG dùng 1 ảnh mặc định chung cho mọi món — nhiều món cùng 1 ảnh trông
 * như lỗi dữ liệu. Thay vào đó: khối nền gỗ ấm + icon bát tự vẽ, để "trông có
 * chủ ý" thay vì giống khung trống/ảnh lỗi. Vùng ảnh KHÔNG bị ẩn (nếu ẩn thì
 * lưới món so le giữa các card có/không ảnh).
 *
 * KHÔNG in tên món vào đây: `CardItem` đã có `<h3>` tên món ngay dưới vùng
 * ảnh, nên in thêm lần nữa làm card trông như lỗi dựng (chốt 2026-07-30, lệch
 * với chữ của D-10 — xem OVERRIDE-DEBT). Tên vẫn tới được trình đọc màn hình
 * qua `aria-label` bên dưới.
 */
type Props = {
  name: string;
};

export function ImagePlaceholder({ name }: Props): JSX.Element {
  return (
    <div style={frame} role="img" aria-label={`${name} — chưa có ảnh`}>
      <BowlGlyph />
    </div>
  );
}

/**
 * Export (2026-09-04) để quyển menu điện tử dùng lại ĐÚNG hình bát này trong khung TRÒN
 * trên nền tối. Ở đó không dùng được cả component `ImagePlaceholder`: khung của nó là chữ
 * nhật 3:2 nền kem, nhét vào hình tròn thì chỉ phủ được 2/3 và ra một vòng tròn nửa kem
 * nửa tối. Chỉ hình vẽ là dùng chung được — khung thì mỗi nơi một kiểu.
 *
 * Màu lấy từ `currentColor` của chỗ gọi (`style` bên dưới chỉ đặt màu mặc định), nên nền
 * tối chỉ cần đặt `color` ở khung bao là xong.
 */
export function BowlGlyph(): JSX.Element {
  return (
    <svg
      width={44}
      height={44}
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
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  aspectRatio: 'var(--ratio-card-media)',
  background: 'var(--wood-100)',
  borderRadius: 'var(--r-card)',
};

const glyph: CSSProperties = {
  // Nhạt hơn `--wood-700`: icon là vật trang trí lấp chỗ trống, không được
  // hút mắt hơn tên món và giá ngay bên dưới.
  // CHỈ là mặc định — svg vẽ bằng `currentColor` nên chỗ gọi khác (quyển menu nền tối)
  // đặt `color` ở khung bao là đè được.
  color: 'var(--wood-500)',
  flexShrink: 0,
};

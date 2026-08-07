import type { JSX, SVGProps } from 'react';

/**
 * Kho glyph dùng chung cho apps/shop — SVG tự vẽ, KHÔNG thêm package icon (D-22 giả định #2).
 *
 * Lý do tách khỏi `Header.tsx` (2026-08-07): trang `/guide` phải vẽ ĐÚNG cái biểu tượng khách
 * nhìn thấy trên thanh header ("ấn vào biểu tượng giỏ hàng thì phải có biểu tượng ở đó để nhận
 * biết" — chỉ đạo chủ dự án). Nếu mỗi nơi tự vẽ lại một bản, sửa icon ở header là hướng dẫn nói
 * dối ngay lập tức. Một nguồn duy nhất thì không bao giờ lệch.
 *
 * Quy ước: mọi glyph nhận `size` (px, mặc định 20), tô bằng `currentColor`, và luôn
 * `aria-hidden` — phần chữ quanh nó mới là nội dung cho trình đọc màn hình.
 */
type GlyphProps = { size?: number };

/** Khung SVG chung: viewBox 24, nét 1.75 — cùng công thức với CartIcon để các icon đứng cạnh nhau không lệch. */
function svgProps(size: number): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
}

/** Kính lúp — nút tìm món ở header. */
export function SearchGlyph({ size = 20 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

/** Ba gạch ngang — nút mở menu điều hướng ở header mobile. */
export function HamburgerGlyph({ size = 20 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

/** Dấu nhân — đóng drawer / đóng hộp thoại. */
export function CloseGlyph({ size = 20 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}

/** Dấu hỏi trong vòng tròn — nút Hướng dẫn (header mobile). */
export function GuideGlyph({ size = 20 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.5" />
      <circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Ghim bản đồ — nút "Chia sẻ vị trí" ở bước điền thông tin giao hàng. */
export function LocationGlyph({ size = 20 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

/** Bút chì — ô ghi chú cho từng món trong giỏ. */
export function PencilGlyph({ size = 20 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />
      <path d="M13.5 7 17 10.5" />
    </svg>
  );
}

/** Mũi tên vòng — nút "Đặt lại đơn này" ở lịch sử đơn. */
export function ReorderGlyph({ size = 20 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}

/** Ống nghe điện thoại — số của quán trên trang theo dõi đơn. */
export function PhoneGlyph({ size = 20 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M6.5 3.5h3l1.5 4-2 1.4a12 12 0 0 0 5.1 5.1l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" />
    </svg>
  );
}

/** Mũi tên xuống — đuôi các khối gấp/mở (`<details>`). */
export function ChevronDownGlyph({ size = 16 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)} strokeWidth={2}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Mũi tên phải — đuôi các đường tắt ("Xem menu →"). */
export function ArrowGlyph({ size = 16 }: GlyphProps = {}): JSX.Element {
  return (
    <svg {...svgProps(size)} strokeWidth={2}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

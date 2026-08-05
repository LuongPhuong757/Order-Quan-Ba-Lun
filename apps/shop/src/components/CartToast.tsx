import { useEffect, type CSSProperties, type JSX } from 'react';

/**
 * Popup xác nhận "đã thêm vào giỏ" — phản hồi tức thì cho nút `+` ở CardItem.
 *
 * Trước đây bấm `+` không có dấu hiệu gì trên màn hình nên khách không biết
 * món đã vào giỏ hay chưa, dễ bấm lại nhiều lần.
 *
 * Từ 2026-08-05 toast này CHỈ còn bắn ở bước 0 → 1 (món mới vào giỏ). Các lần
 * `+`/`−` sau đó không bắn nữa: `CardItem` đã đổi nút `+` thành stepper `− N +`
 * nên số lượng nằm sẵn dưới ngón tay khách dưới dạng trạng thái bền, còn toast
 * là loại hiện-rồi-tắt. Lặp lại cùng một thông tin ở đáy màn hình chỉ che mất
 * nội dung. Xem `MenuPage.handleSetQty`.
 *
 * MÀU: nền `--bg-wood` + chữ `--text-on-wood` — cùng khối nâu gỗ mà `Footer` và
 * header trang `/o/:token` đang dùng, nên toast nằm trong cùng bảng màu ấm của
 * quán. Cố ý KHÔNG dùng:
 *   - `--ok-600` (xanh lá): lạc tông trên nền kem, giống toast mặc định của
 *     framework hơn là của quán này.
 *   - `--brand-600` (đỏ ớt): tokens.css đã ghi rõ đỏ thương hiệu và
 *     `--danger-600` rất gần nhau — báo thành công bằng đỏ dễ đọc nhầm là lỗi.
 * Trắng ngà trên nâu gỗ đo được 8.48:1 (tokens.css) — vượt AAA.
 *
 * Đặt nổi sát đáy màn hình. Không còn thanh giỏ nổi để né (đã bỏ khỏi
 * `AppShell`), nên chỉ cần chừa `--safe-bottom` cho vùng gạt của iPhone.
 *
 * `role="status"` + `aria-live="polite"` — trình đọc màn hình đọc lên mà không
 * cắt ngang việc khách đang làm. Hiệu ứng trượt lên tôn trọng `--dur-base`,
 * token này tự về ~0ms khi hệ điều hành bật "giảm chuyển động".
 */
const TOAST_MS = 1800;

type Props = {
  /** Nội dung hiện; `null` = không hiện gì. */
  message: string | null;
  /** Đổi mỗi lần thêm món — để bấm `+` liên tiếp thì đồng hồ tắt chạy lại từ đầu. */
  nonce: number;
  onDismiss: () => void;
};

export function CartToast({ message, nonce, onDismiss }: Props): JSX.Element | null {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
    // `nonce` nằm trong deps: thêm món thứ 2 khi toast đang hiện sẽ hẹn giờ lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, nonce]);

  if (!message) return null;

  return (
    <>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{TOAST_CSS}</style>
      <div key={nonce} role="status" aria-live="polite" className="shop-cart-toast" style={toast}>
        <span style={checkCircle}>
          <CheckGlyph />
        </span>
        <span style={text}>{message}</span>
      </div>
    </>
  );
}

function CheckGlyph(): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const TOAST_CSS = `
@keyframes shop-toast-in {
  from { opacity: 0; transform: translate(-50%, 12px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
.shop-cart-toast {
  animation: shop-toast-in var(--dur-base) ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .shop-cart-toast { animation: none; }
}
`;

const toast: CSSProperties = {
  position: 'fixed',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: 'calc(var(--safe-bottom) + var(--sp-5))',
  zIndex: 'var(--z-toast)' as unknown as number,
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  maxWidth: 'calc(100vw - var(--gutter) * 2)',
  padding: 'var(--sp-3) var(--sp-4)',
  borderRadius: 'var(--r-card)',
  background: 'var(--bg-wood)',
  color: 'var(--text-on-wood)',
  boxShadow: 'var(--shadow-float)',
  fontFamily: 'var(--font-body)',
  // Toast chỉ để báo tin, không bấm được — không chặn thao tác bên dưới nó.
  pointerEvents: 'none',
};

// Dấu tick trong đĩa hổ phách: `--wood-400` là bậc TRANG TRÍ (tokens.css cấm
// dùng cho chữ vì độ tương phản thấp) — ở đây chỉ là nền của icon, còn nghĩa
// "đã thêm" nằm ở phần chữ bên cạnh, nên không vi phạm.
const checkCircle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '20px',
  height: '20px',
  borderRadius: 'var(--r-badge)',
  background: 'var(--wood-400)',
  color: 'var(--bg-wood)',
};

const text: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  lineHeight: 'var(--lh-tight)',
};

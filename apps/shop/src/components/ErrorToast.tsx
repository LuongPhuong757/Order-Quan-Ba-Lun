import type { CSSProperties, JSX } from 'react';

/**
 * Toast lỗi XỔ TỪ TRÊN XUỐNG (chỉ đạo chủ dự án 2026-08-04) — dùng cho lỗi gửi đơn ở
 * checkout: lỗi phải rơi vào đúng tầm mắt bất kể khách đang cuộn ở đâu hay popup nào đang
 * mở. Nằm ở lớp `--z-toast` (400) — trên cả bottom-sheet (310) và nút dính đáy (210).
 *
 * Animation khai bằng thẻ <style> trong component (inline style không viết được
 * @keyframes) — cùng thủ pháp các component khác trong repo. Tôn trọng
 * `prefers-reduced-motion`: máy khách tắt chuyển động thì toast hiện tĩnh, không trượt.
 *
 * KHÔNG tự đóng sau N giây: đây là lỗi chặn luồng đặt hàng (trùng đơn, hết món, mất
 * mạng...), khách cần đọc và bấm nút hành động — tự biến mất là đánh đố. Đóng bằng ✕.
 */
export type ErrorToastAction = { label: string; onClick?: () => void; href?: string } | undefined;

export function ErrorToast({
  message,
  action,
  onClose,
}: {
  message: string;
  action?: ErrorToastAction;
  onClose: () => void;
}): JSX.Element {
  return (
    <div style={wrap} role="alert">
      <style>{`
        @keyframes shop-error-toast-drop {
          from { transform: translateY(-110%); opacity: 0.4; }
          to { transform: translateY(0); opacity: 1; }
        }
        .shop-error-toast { animation: shop-error-toast-drop 260ms cubic-bezier(0.2, 0.8, 0.3, 1); }
        @media (prefers-reduced-motion: reduce) {
          .shop-error-toast { animation: none; }
        }
      `}</style>
      <div className="shop-error-toast" style={card}>
        <span aria-hidden="true" style={icon}>
          ⚠️
        </span>
        <div style={bodyWrap}>
          <p style={text}>{message}</p>
          {action &&
            (action.href ? (
              <a href={`tel:${action.href}`} style={actionBtn}>
                {action.label}
              </a>
            ) : (
              <button type="button" style={actionBtn} onClick={action.onClick}>
                {action.label}
              </button>
            ))}
        </div>
        <button type="button" aria-label="Đóng thông báo lỗi" style={closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>
    </div>
  );
}

const wrap: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 'var(--z-toast)' as unknown as number,
  display: 'flex',
  justifyContent: 'center',
  padding: `calc(env(safe-area-inset-top, 0px) + var(--sp-2)) var(--gutter) 0`,
  // Vùng ngoài card không bắt sự kiện — không chặn thao tác vào trang phía dưới.
  pointerEvents: 'none',
};

const card: CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--sp-2)',
  width: '100%',
  maxWidth: 'var(--content-max)',
  padding: 'var(--sp-3)',
  background: 'var(--danger-100)',
  border: '1px solid var(--danger-600)',
  borderRadius: 'var(--r-card)',
  boxShadow: 'var(--shadow-float)',
};

const icon: CSSProperties = {
  flexShrink: 0,
  fontSize: 'var(--fs-md)',
  lineHeight: 1.4,
};

const bodyWrap: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const text: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--danger-600)',
  lineHeight: 1.5,
  overflowWrap: 'anywhere',
};

const actionBtn: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--danger-600)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  color: 'var(--danger-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
  textDecoration: 'none',
};

const closeBtn: CSSProperties = {
  flexShrink: 0,
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  marginTop: 'calc(var(--sp-2) * -1)',
  marginRight: 'calc(var(--sp-2) * -1)',
  border: 'none',
  background: 'transparent',
  color: 'var(--danger-600)',
  fontSize: 'var(--fs-base)',
  cursor: 'pointer',
};

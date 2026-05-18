// Modal hướng dẫn dùng chung cho KitchenPage / OrdersPage / OrderDrawer.
// Mở qua state ở parent, đóng qua nút ✕ hoặc click overlay.
import type { ReactNode } from 'react';

type Props = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function HelpModal({ title, open, onClose, children }: Props) {
  if (!open) return null;
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{ zIndex: 11000 }}
    >
      <div
        style={{
          background: 'white',
          width: '100%',
          maxWidth: 640,
          maxHeight: '92vh',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#fafafa',
          }}
        >
          <h2 id="help-modal-title" style={{ margin: 0, fontSize: 17 }}>
            ❓ {title}
          </h2>
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            style={{ padding: '6px 10px' }}
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 20px 18px',
            fontSize: 14,
            lineHeight: 1.6,
            color: '#1f2937',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** Nút Hướng dẫn dùng ở header — mobile chỉ icon, desktop có text. */
export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="secondary"
      style={{
        padding: '8px 12px',
        minHeight: 40,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 14,
      }}
      title="Mở hướng dẫn sử dụng"
      aria-label="Mở hướng dẫn sử dụng"
    >
      <span style={{ fontSize: 16 }}>❓</span>
      <span className="hide-on-mobile">Hướng dẫn</span>
    </button>
  );
}

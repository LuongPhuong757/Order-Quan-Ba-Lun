// Bell icon trong header + modal liệt kê thông báo. Dùng notificationStore.
import { useEffect, useState } from 'react';
import { notificationStore, formatTime, type NotificationEntry, type NotificationKind } from '../lib/notification-store.ts';

const KIND_ICON: Record<NotificationKind, string> = {
  ready: '🍽',
  order_open: '🪑',
  order_cancel: '✕',
  order_checkout: '💰',
  info: 'ℹ️',
  error: '⚠️',
};

const KIND_COLOR: Record<NotificationKind, string> = {
  ready: '#059669',
  order_open: '#0f766e',
  order_cancel: '#dc2626',
  order_checkout: '#0284c7',
  info: '#6b7280',
  error: '#dc2626',
};

export function NotificationBell() {
  const [entries, setEntries] = useState<NotificationEntry[]>(notificationStore.getAll());
  const [open, setOpen] = useState(false);

  useEffect(() => notificationStore.subscribe(setEntries), []);

  const unread = entries.filter((e) => !e.read).length;

  const handleOpen = () => {
    setOpen(true);
    // delay markAllRead 500ms để badge fade trước khi mất
    setTimeout(() => notificationStore.markAllRead(), 600);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        title="Thông báo"
        aria-label={`Thông báo${unread > 0 ? ` (${unread} mới)` : ''}`}
        style={{
          position: 'relative',
          background: 'transparent',
          color: 'inherit',
          border: 'none',
          padding: '6px 8px',
          minHeight: 36,
          minWidth: 36,
          cursor: 'pointer',
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: '#dc2626',
              color: 'white',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              minWidth: 18,
              height: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.5)',
            backdropFilter: 'blur(2px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 14,
              maxWidth: 480,
              width: '100%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
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
              }}
            >
              <h2 style={{ margin: 0, fontSize: 17 }}>🔔 Thông báo</h2>
              <button type="button" className="secondary" onClick={() => setOpen(false)} style={{ padding: '6px 10px' }}>
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {entries.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                  Chưa có thông báo nào.
                </div>
              ) : (
                entries.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      padding: '10px 16px',
                      borderTop: '1px solid #f3f4f6',
                      display: 'flex',
                      gap: 10,
                      background: e.read ? 'white' : '#f0fdfa',
                    }}
                  >
                    <div style={{ fontSize: 20, color: KIND_COLOR[e.kind] }}>
                      {KIND_ICON[e.kind]}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: '#1f2937', wordBreak: 'break-word' }}>
                        {e.message}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        {formatTime(e.ts_ms)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {entries.length > 0 && (
              <div
                style={{
                  padding: '10px 18px',
                  borderTop: '1px solid #e5e7eb',
                  background: '#f9fafb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 13,
                  color: '#6b7280',
                }}
              >
                <span>{entries.length} thông báo gần đây</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => notificationStore.clear()}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                >
                  🗑 Xoá hết
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

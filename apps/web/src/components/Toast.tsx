import { useEffect, useState, createContext, useContext, ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info' | 'ready';
type Toast = { id: number; kind: ToastKind; message: string; durationMs: number };

const ToastCtx = createContext<{
  push: (kind: ToastKind, message: string, durationMs?: number) => void;
} | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (kind: ToastKind, message: string, durationMs?: number) => {
    const id = nextId++;
    const dur = durationMs ?? (kind === 'ready' ? 6000 : 3000);
    setToasts((t) => [...t, { id, kind, message, durationMs: dur }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), dur);
  };

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div style={{ position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map((t) => (
          <ToastEl key={t.id} {...t} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastEl({ kind, message }: Toast) {
  // 'ready' = món bếp xong cần lên lấy — đặc biệt nổi bật
  const styles =
    kind === 'ready'
      ? {
          background: 'linear-gradient(135deg, #059669, #10b981)',
          fontSize: 17,
          fontWeight: 600,
          padding: '16px 20px',
          border: '2px solid #fbbf24',
          boxShadow: '0 8px 24px rgba(16, 185, 129, 0.4)',
        }
      : {};

  return (
    <div
      className={`toast ${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      style={{ position: 'static', ...styles }}
    >
      {message}
    </div>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

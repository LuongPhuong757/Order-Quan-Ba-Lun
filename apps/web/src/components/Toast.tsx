import { useEffect, useState, createContext, useContext, ReactNode } from 'react';

type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string };

const ToastCtx = createContext<{
  push: (kind: Toast['kind'], message: string) => void;
} | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = (kind: Toast['kind'], message: string) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {toasts.map((t) => (
        <ToastEl key={t.id} {...t} />
      ))}
    </ToastCtx.Provider>
  );
}

function ToastEl({ kind, message }: Toast) {
  return (
    <div className={`toast ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {message}
    </div>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

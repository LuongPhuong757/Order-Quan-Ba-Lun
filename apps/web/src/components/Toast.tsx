import { useEffect, useRef, useState, createContext, useContext, ReactNode } from 'react';

// 'neworder' = món mới về bếp. Tách riêng khỏi 'info' vì đây là việc bếp PHẢI
// làm ngay, không phải thông tin tham khảo — cần màu + cỡ chữ khác.
type ToastKind = 'success' | 'error' | 'info' | 'ready' | 'neworder';
type ToastData = { id: number; kind: ToastKind; message: string };

const ToastCtx = createContext<{
  push: (kind: ToastKind, message: string, durationMs?: number) => void;
} | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  // Chỉ giữ 1 thông báo tại 1 thời điểm — cái mới ghi đè cái cũ (không xếp chồng
  // che giao diện). Hiển thị dạng banner ngang ngay dưới header.
  const [toast, setToast] = useState<ToastData | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (kind: ToastKind, message: string, durationMs?: number) => {
    const id = nextId++;
    const dur = durationMs ?? (kind === 'ready' || kind === 'neworder' ? 6000 : 3000);
    if (timerRef.current) clearTimeout(timerRef.current); // huỷ timer của cái trước
    setToast({ id, kind, message }); // ghi đè
    timerRef.current = setTimeout(
      () => setToast((cur) => (cur?.id === id ? null : cur)),
      dur,
    );
  };

  const dismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {toast && (
        <div className="toast-banner-wrap">
          {/* key theo id → chạy lại animation trượt xuống mỗi lần ghi đè */}
          <div
            key={toast.id}
            className={`toast-banner ${toast.kind}`}
            role={toast.kind === 'error' || toast.kind === 'neworder' ? 'alert' : 'status'}
          >
            <span className="toast-banner-msg">{toast.message}</span>
            <button
              type="button"
              className="toast-banner-close"
              onClick={dismiss}
              aria-label="Đóng thông báo"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

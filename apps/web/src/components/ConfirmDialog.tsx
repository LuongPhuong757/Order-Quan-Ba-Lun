// Centralized confirm + prompt dialogs — thay native browser confirm()/prompt().
// API hook-based, async/await: const ok = await confirm({ message, variant });
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
  FormEvent,
} from 'react';

export type ConfirmVariant = 'default' | 'danger' | 'warning' | 'success' | 'info';

export type ConfirmOptions = {
  title?: string;
  /** Có thể là string (multi-line với \n) hoặc ReactNode để render rich. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
};

export type PromptOptions = {
  title?: string;
  message?: ReactNode;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  /** Validate input — return error message hoặc null nếu OK. */
  validate?: (value: string) => string | null;
};

type DialogCtx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
};

const Ctx = createContext<DialogCtx | null>(null);

type InternalState =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | null;

const VARIANT_COLORS: Record<ConfirmVariant, { bg: string; border: string; text: string; icon: string }> = {
  default: { bg: '#f0f9ff', border: '#0f766e', text: '#0f766e', icon: '❓' },
  danger:  { bg: '#fef2f2', border: '#dc2626', text: '#dc2626', icon: '⚠️' },
  warning: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', icon: '⚠️' },
  success: { bg: '#ecfdf5', border: '#059669', text: '#059669', icon: '✓' },
  info:    { bg: '#f0f9ff', border: '#0284c7', text: '#0284c7', icon: 'ℹ️' },
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ kind: 'confirm', opts, resolve });
    });
  }, []);

  const prompt = useCallback((opts: PromptOptions): Promise<string | null> => {
    return new Promise((resolve) => {
      setState({ kind: 'prompt', opts, resolve });
    });
  }, []);

  const close = useCallback((value: boolean | string | null) => {
    if (!state) return;
    if (state.kind === 'confirm') state.resolve(value as boolean);
    else state.resolve(value as string | null);
    setState(null);
  }, [state]);

  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      {state?.kind === 'confirm' && (
        <ConfirmModal
          opts={state.opts}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
      {state?.kind === 'prompt' && (
        <PromptModal
          opts={state.opts}
          onConfirm={(v) => close(v)}
          onCancel={() => close(null)}
        />
      )}
    </Ctx.Provider>
  );
}

export function useDialog(): DialogCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDialog must be inside ConfirmProvider');
  return v;
}

// Convenience hooks
export function useConfirm() {
  return useDialog().confirm;
}
export function usePrompt() {
  return useDialog().prompt;
}

// ─── Confirm modal ─────────────────────────────────────────────────────────
function ConfirmModal({
  opts,
  onConfirm,
  onCancel,
}: {
  opts: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const variant = opts.variant ?? 'default';
  const c = VARIANT_COLORS[variant];
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter' && e.target instanceof HTMLElement && e.target.tagName !== 'TEXTAREA') {
        onConfirm();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      style={overlayStyle}
    >
      <div style={modalStyle}>
        <div style={{ ...iconHeaderStyle, background: c.bg, borderBottom: `1px solid ${c.border}33` }}>
          <span style={{ fontSize: 26 }}>{c.icon}</span>
          <h2 id="confirm-title" style={{ margin: 0, fontSize: 17, color: c.text }}>
            {opts.title || 'Xác nhận'}
          </h2>
        </div>
        <div style={bodyStyle}>
          {typeof opts.message === 'string' ? (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5, color: '#1f2937' }}>{opts.message}</div>
          ) : (
            opts.message
          )}
        </div>
        <div style={footerStyle}>
          <button type="button" className="secondary" onClick={onCancel} style={{ flex: 1, minHeight: 44 }}>
            {opts.cancelLabel || 'Huỷ'}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={variant === 'danger' ? 'danger' : ''}
            style={{
              flex: 1,
              minHeight: 44,
              background: variant === 'danger' ? '#dc2626'
                       : variant === 'warning' ? '#f59e0b'
                       : variant === 'success' ? '#059669'
                       : '#0f766e',
              color: 'white',
              fontWeight: 600,
            }}
          >
            {opts.confirmLabel || 'Đồng ý'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Prompt modal ──────────────────────────────────────────────────────────
function PromptModal({
  opts,
  onConfirm,
  onCancel,
}: {
  opts: PromptOptions;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(opts.defaultValue || '');
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const v = value.trim();
    if (opts.validate) {
      const e2 = opts.validate(v);
      if (e2) { setErr(e2); return; }
    }
    onConfirm(v);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
      style={overlayStyle}
    >
      <form onSubmit={submit} style={modalStyle}>
        <div style={{ ...iconHeaderStyle, background: '#fef3c7', borderBottom: '1px solid #f59e0b33' }}>
          <span style={{ fontSize: 26 }}>✎</span>
          <h2 style={{ margin: 0, fontSize: 17, color: '#92400e' }}>
            {opts.title || 'Nhập thông tin'}
          </h2>
        </div>
        <div style={bodyStyle}>
          {opts.message && (
            <div style={{ marginBottom: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5, color: '#1f2937' }}>
              {opts.message}
            </div>
          )}
          {opts.label && (
            <label style={{ display: 'block', fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
              {opts.label}
            </label>
          )}
          {opts.multiline ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(e) => { setValue(e.target.value); setErr(null); }}
              placeholder={opts.placeholder}
              rows={3}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 8,
                border: `1px solid ${err ? '#dc2626' : '#d1d5db'}`,
                fontSize: 16,
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: 80,
              }}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={value}
              onChange={(e) => { setValue(e.target.value); setErr(null); }}
              placeholder={opts.placeholder}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 8,
                border: `1px solid ${err ? '#dc2626' : '#d1d5db'}`,
                fontSize: 16,
                fontFamily: 'inherit',
              }}
            />
          )}
          {err && (
            <div style={{ color: '#dc2626', fontSize: 13, marginTop: 6 }}>{err}</div>
          )}
        </div>
        <div style={footerStyle}>
          <button type="button" className="secondary" onClick={onCancel} style={{ flex: 1, minHeight: 44 }}>
            {opts.cancelLabel || 'Huỷ'}
          </button>
          <button
            type="submit"
            style={{
              flex: 1,
              minHeight: 44,
              background: '#0f766e',
              color: 'white',
              fontWeight: 600,
            }}
          >
            {opts.confirmLabel || 'Đồng ý'}
          </button>
        </div>
      </form>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.5)',
  backdropFilter: 'blur(2px)',
  zIndex: 10010,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  animation: 'cd-fadein 0.12s ease-out',
};

const modalStyle: React.CSSProperties = {
  background: 'white',
  borderRadius: 14,
  maxWidth: 520,
  width: '100%',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
  animation: 'cd-slideup 0.18s ease-out',
};

const iconHeaderStyle: React.CSSProperties = {
  padding: '14px 18px',
  display: 'flex',
  gap: 12,
  alignItems: 'center',
};

const bodyStyle: React.CSSProperties = {
  padding: 18,
  flex: 1,
  overflowY: 'auto',
  fontSize: 14,
};

const footerStyle: React.CSSProperties = {
  padding: '12px 18px',
  borderTop: '1px solid #e5e7eb',
  display: 'flex',
  gap: 8,
  background: '#f9fafb',
};

// Inject keyframes once
if (typeof document !== 'undefined' && !document.getElementById('cd-keyframes')) {
  const s = document.createElement('style');
  s.id = 'cd-keyframes';
  s.textContent = `
    @keyframes cd-fadein { from { opacity: 0; } to { opacity: 1; } }
    @keyframes cd-slideup { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  `;
  document.head.appendChild(s);
}

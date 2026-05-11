// P01.D-17 — re-login modal preserves UI state
import { useEffect, useState } from 'react';
import { api, registerReLoginHandler, extractError } from '../lib/api.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { PasswordInput } from './PasswordInput.tsx';

type PendingRetry = (() => Promise<unknown>) | null;

export function ReLoginModal() {
  const { user, refresh } = useAuth();
  const [retry, setRetry] = useState<PendingRetry>(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    registerReLoginHandler(async (retryFn) => {
      setRetry(() => retryFn);
      setPassword('');
      setError(null);
    });
  }, []);

  if (!retry || !user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/login', { username: user.name, password });
      await refresh();
      const r = retry;
      setRetry(null);
      // Fire retry callback (resolves the original axios call)
      r?.();
    } catch (err) {
      setError(extractError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="relogin-title">
      <form className="modal" onSubmit={submit}>
        <h1 id="relogin-title">Phiên đăng nhập đã hết hạn</h1>
        <p style={{ color: '#6b7280', marginBottom: 16 }}>
          Nhập lại mật khẩu để tiếp tục — giữ nguyên trang hiện tại.
        </p>
        <div className="row">
          <label>Tên đăng nhập</label>
          <input value={user.name} readOnly />
        </div>
        <PasswordInput
          id="relogin-pwd"
          label="Mật khẩu"
          value={password}
          onChange={setPassword}
          error={error || undefined}
          autoComplete="current-password"
        />
        <button type="submit" disabled={submitting || password.length < 8} style={{ width: '100%' }}>
          {submitting && <span className="spinner" />}
          Đăng nhập lại
        </button>
      </form>
    </div>
  );
}

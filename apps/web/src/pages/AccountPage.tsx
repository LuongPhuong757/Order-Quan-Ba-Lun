import { useState, FormEvent } from 'react';
import { api, extractError } from '../lib/api.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { useToast } from '../components/Toast.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';

export function AccountPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newP.length < 8) {
      setErr('Mật khẩu mới tối thiểu 8 ký tự');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await api.post('/auth/change-password', { old: oldP, new: newP });
      toast.push('success', 'Đổi mật khẩu thành công!');
      setOldP('');
      setNewP('');
      await refresh();
    } catch (e) {
      setErr(extractError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container with-bottom-nav">
      <h1>Tài khoản</h1>
      <div className="card">
        {user?.full_name && user.full_name !== user.name && (
          <p style={{ marginBottom: 4 }}>
            Họ và tên: <strong>{user.full_name}</strong>
          </p>
        )}
        <p>
          Tên đăng nhập: <strong>{user?.name}</strong>
          {user?.is_owner && <span style={{ marginLeft: 8, color: '#0f766e' }}>(Chủ quán)</span>}
        </p>

        <h2>Đổi mật khẩu</h2>
        <form onSubmit={submit} noValidate>
          <PasswordInput
            id="old-pwd"
            label="Mật khẩu cũ"
            value={oldP}
            onChange={setOldP}
            autoComplete="current-password"
          />
          <PasswordInput
            id="new-pwd"
            label="Mật khẩu mới"
            value={newP}
            onChange={(v) => {
              setNewP(v);
              setErr(null);
            }}
            error={err || undefined}
            showStrength
            autoComplete="new-password"
          />

          <button type="submit" disabled={submitting || !oldP || newP.length < 8} style={{ width: '100%' }}>
            {submitting && <span className="spinner" />}
            Đổi mật khẩu
          </button>
        </form>
      </div>
    </div>
  );
}

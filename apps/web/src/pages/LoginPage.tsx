import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useAuth } from '../lib/auth-context.tsx';
import { useToast } from '../components/Toast.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';

export function LoginPage() {
  const { refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errU, setErrU] = useState<string | null>(null);
  const [errP, setErrP] = useState<string | null>(null);

  const validateUsername = () => setErrU(username.trim() ? null : 'Bắt buộc nhập tên đăng nhập');
  const validatePassword = () => setErrP(password.length >= 8 ? null : 'Tối thiểu 8 ký tự');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    validateUsername();
    validatePassword();
    if (!username.trim() || password.length < 8) return;

    setSubmitting(true);
    try {
      await api.post('/auth/login', { username, password });
      await refresh();
      toast.push('success', `Đăng nhập thành công, chào bạn!`);
      navigate('/dashboard');
    } catch (err) {
      const e = extractError(err);
      toast.push('error', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <h1>Order Quán Bà Lùn</h1>
        <p style={{ color: '#6b7280', marginTop: -8, marginBottom: 24 }}>Đăng nhập để vào dashboard</p>

        <form onSubmit={submit} noValidate>
          <div className="row">
            <label htmlFor="username">Tên đăng nhập</label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={validateUsername}
              aria-invalid={errU ? 'true' : undefined}
              aria-describedby={errU ? 'username-err' : undefined}
            />
            {errU && (
              <div className="field-error" id="username-err">
                {errU}
              </div>
            )}
          </div>

          <PasswordInput
            id="password"
            label="Mật khẩu"
            value={password}
            onChange={setPassword}
            onBlur={validatePassword}
            error={errP || undefined}
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={submitting || !username.trim() || password.length < 8}
            style={{ width: '100%' }}
          >
            {submitting && <span className="spinner" />}
            Đăng nhập
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 14, color: '#6b7280', textAlign: 'center' }}>
          Quên mật khẩu? <Link to="/recover">Nhập mã khôi phục</Link>
        </p>
      </div>
    </div>
  );
}

import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';

export function SetupPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [errP, setErrP] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ user_id: string; recovery_code: string } | null>(null);

  useEffect(() => {
    api.get('/setup')
      .then((res) => {
        if (res.status === 200) setReady(true);
        else {
          toast.push('info', 'Hệ thống đã setup. Chuyển sang đăng nhập.');
          navigate('/login');
        }
      })
      .catch((err) => {
        const e = extractError(err);
        toast.push('error', e.message);
        if (e.code === 'SETUP_ALREADY_DONE') navigate('/login');
      })
      .finally(() => setChecking(false));
  }, [navigate, toast]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 12) {
      setErrP('Mật khẩu owner nên ≥ 12 ký tự cho an toàn');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ data: { user_id: string; recovery_code: string } }>('/setup', {
        username,
        password,
      });
      setResult(res.data.data);
    } catch (err) {
      toast.push('error', extractError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="container">
        <div className="card">
          <p style={{ textAlign: 'center', color: '#6b7280' }}>
            <span className="spinner" /> Đang kiểm tra trạng thái setup...
          </p>
        </div>
      </div>
    );
  }
  if (!ready) return null;

  if (result) {
    return (
      <div className="container">
        <div className="card">
          <h1>✅ Setup thành công</h1>
          <p>Tài khoản chủ quán đã được tạo. Đây là <strong>mã khôi phục 1 lần</strong>:</p>
          <pre style={{ background: '#fef3c7', padding: 16, borderRadius: 8, fontSize: 18, textAlign: 'center', wordBreak: 'break-all' }}>
            {result.recovery_code}
          </pre>
          <p style={{ color: '#dc2626', fontWeight: 600 }}>
            ⚠ Lưu mã này ngay (chụp màn hình / in giấy / cất chỗ an toàn).
            Mã này KHÔNG hiển thị lại. Nếu mất, owner KHÔNG thể reset password được.
          </p>
          <button onClick={() => navigate('/login')} style={{ width: '100%', marginTop: 16 }}>
            Đăng nhập ngay
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Setup chủ quán</h1>
        <p style={{ color: '#6b7280', marginTop: -8, marginBottom: 24 }}>
          Tạo tài khoản owner đầu tiên cho hệ thống.
        </p>

        <form onSubmit={submit} noValidate>
          <div className="row">
            <label htmlFor="setup-username">Tên đăng nhập owner</label>
            <input
              id="setup-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <PasswordInput
            id="setup-pwd"
            label="Mật khẩu mạnh (khuyến nghị ≥ 12 ký tự)"
            value={password}
            onChange={(v) => {
              setPassword(v);
              setErrP(null);
            }}
            error={errP || undefined}
            showStrength
            autoComplete="new-password"
          />

          <button
            type="submit"
            disabled={submitting || password.length < 8}
            style={{ width: '100%' }}
          >
            {submitting && <span className="spinner" />}
            Tạo owner + sinh mã khôi phục
          </button>
        </form>
      </div>
    </div>
  );
}

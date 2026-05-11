import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useToast } from '../components/Toast.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';

export function RecoverPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [pwd, setPwd] = useState('');
  const [errC, setErrC] = useState<string | null>(null);
  const [errP, setErrP] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cl = code.trim();
    setErrC(cl.length === 16 ? null : 'Mã khôi phục phải đúng 16 ký tự');
    setErrP(pwd.length >= 8 ? null : 'Mật khẩu tối thiểu 8 ký tự');
    if (cl.length !== 16 || pwd.length < 8) return;

    setSubmitting(true);
    try {
      await api.post('/auth/recover', { code: cl, new_password: pwd });
      toast.push('success', 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập.');
      navigate('/login');
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
        <h1>Khôi phục mật khẩu</h1>
        <p style={{ color: '#6b7280', marginTop: -8, marginBottom: 24 }}>
          Nhập mã khôi phục 16 ký tự bạn đã lưu lúc setup, và mật khẩu mới.
        </p>

        <form onSubmit={submit} noValidate>
          <div className="row">
            <label htmlFor="rcode">Mã khôi phục (16 ký tự)</label>
            <input
              id="rcode"
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onBlur={() => setErrC(code.trim().length === 16 ? null : 'Phải đúng 16 ký tự')}
              maxLength={16}
              style={{ letterSpacing: 2, fontFamily: 'monospace' }}
              aria-invalid={errC ? 'true' : undefined}
            />
            {errC && <div className="field-error">{errC}</div>}
          </div>

          <PasswordInput
            id="new-pwd"
            label="Mật khẩu mới"
            value={pwd}
            onChange={(v) => {
              setPwd(v);
              setErrP(null);
            }}
            error={errP || undefined}
            showStrength
            autoComplete="new-password"
          />

          <button type="submit" disabled={submitting} style={{ width: '100%' }}>
            {submitting && <span className="spinner" />}
            Đặt lại mật khẩu
          </button>
        </form>

        <p style={{ marginTop: 24, fontSize: 14, color: '#6b7280', textAlign: 'center' }}>
          <Link to="/login">← Quay lại đăng nhập</Link>
        </p>
      </div>
    </div>
  );
}

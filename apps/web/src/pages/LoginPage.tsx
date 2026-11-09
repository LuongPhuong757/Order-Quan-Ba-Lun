import { useRef, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, extractError } from '../lib/api.ts';
import { useAuth, defaultLandingPath, type Role } from '../lib/auth-context.tsx';
import { useToast } from '../components/Toast.tsx';
import { PasswordInput } from '../components/PasswordInput.tsx';
import { Icon } from '../components/ui/Icon.tsx';

/**
 * Màn đăng nhập trang quản trị — làm lại 2026-11-09 (docs/UI-UX/dang-nhap.md, chủ quán duyệt bản
 * xem thử artifact eec0df54).
 *
 * Ba quyết định đáng nhớ:
 *  1. Nút "Đăng nhập" KHÔNG BAO GIỜ mờ vì ô trống. iPhone tự điền mật khẩu (autofill) mà không
 *     bắn sự kiện `input` → React tưởng ô còn trống → nút mờ, người dùng tưởng app hỏng. Giờ bấm
 *     lúc nào cũng được; thiếu thì báo ngay dưới ô. Chỉ khoá khi ĐANG GỬI (chống bấm 2 lần).
 *  2. Không kiểm "tối thiểu 8 ký tự" ở đây: đăng nhập chỉ cần biết đã gõ chưa, đúng/sai để máy
 *     chủ trả lời. Luật 8 ký tự vẫn ở chỗ ĐẶT mật khẩu mới.
 *  3. Lỗi từ máy chủ (sai mật khẩu, bị khoá 15 phút) hiện KHUNG ĐỎ CỐ ĐỊNH trên nút thay vì
 *     thông báo nổi — thông báo nổi tự tắt sau vài giây, người lớn tuổi hay bỏ lỡ.
 *
 * "Quên mật khẩu / Nhập mã khôi phục" đã BỎ hẳn (2026-11-09): nhân viên quên thì admin đặt lại ở
 * màn Nhân viên.
 */
export function LoginPage() {
  const { refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errU, setErrU] = useState<string | null>(null);
  const [errP, setErrP] = useState<string | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    // Đọc thẳng từ ô nhập, KHÔNG chỉ từ state: autofill của Safari điền chữ mà không bắn
    // `onChange`, nên state có thể vẫn rỗng trong khi ô đã có chữ.
    const form = formRef.current;
    const u = (form?.elements.namedItem('username') as HTMLInputElement | null)?.value ?? username;
    const p = (form?.elements.namedItem('password') as HTMLInputElement | null)?.value ?? password;
    const eu = u.trim() ? null : 'Nhập tên đăng nhập';
    const ep = p ? null : 'Nhập mật khẩu';
    setErrU(eu);
    setErrP(ep);
    setServerErr(null);
    if (eu || ep) {
      document.getElementById(eu ? 'username' : 'password')?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/auth/login', { username: u.trim(), password: p });
      const me = await api.get<{ data: { role: Role | null; is_owner: boolean } }>('/auth/me');
      await refresh();
      toast.push('success', `Đăng nhập thành công, chào bạn!`);
      // Redirect theo role: admin/order → /orders, kitchen → /kitchen
      const role = (me.data?.data?.role ?? (me.data?.data?.is_owner ? 'admin' : null)) as Role | null;
      navigate(defaultLandingPath(role));
    } catch (err) {
      // Câu tiếng Việt đã do máy chủ dịch sẵn (GlobalExceptionFilter → FRIENDLY_VN): sai mật khẩu,
      // tài khoản bị dừng, thử sai quá 5 lần/5 phút…
      setServerErr(extractError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__head">
          <img src="/favicon.svg" width={48} height={48} alt="" />
          <h1>Quán Bà Lùn</h1>
          <p>Trang quản trị · Đăng nhập để quản lý quán</p>
        </div>

        <form ref={formRef} onSubmit={submit} noValidate>
          <div className="row">
            <label htmlFor="username">Tên đăng nhập</label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (errU) setErrU(null);
                if (serverErr) setServerErr(null);
              }}
              aria-invalid={errU ? 'true' : undefined}
              aria-describedby={errU ? 'username-err' : undefined}
            />
            {errU && (
              <div className="field-error" id="username-err" role="alert">
                {errU}
              </div>
            )}
          </div>

          <PasswordInput
            id="password"
            name="password"
            required
            label="Mật khẩu"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (errP) setErrP(null);
              if (serverErr) setServerErr(null);
            }}
            error={errP || undefined}
            autoComplete="current-password"
          />

          {serverErr && (
            <div className="login-alert" role="alert">
              <Icon name="canh-bao" size={20} />
              <span>{serverErr}</span>
            </div>
          )}

          <button type="submit" className="login-submit" disabled={submitting} aria-busy={submitting}>
            {submitting && <span className="spinner" />}
            {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}

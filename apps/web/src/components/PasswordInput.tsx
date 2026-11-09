// P01.D-19 — show/hide toggle + caps-lock warning + optional zxcvbn strength meter
import { useState, KeyboardEvent } from 'react';
import { Icon } from './ui/Icon.tsx';

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  showStrength?: boolean;
  autoComplete?: string;
  ariaDescribedBy?: string;
  /** `name` + `required` cho trình quản lý mật khẩu (iCloud Keychain, Google) nhận ra ô và điền
   *  ổn định — thiếu hai thuộc tính này thì lúc điền lúc không (góp ý 2026-11-09). */
  name?: string;
  required?: boolean;
};

export function PasswordInput({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  showStrength = false,
  autoComplete = 'current-password',
  ariaDescribedBy,
  name,
  required,
}: Props) {
  const [show, setShow] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') {
      setCapsOn(e.getModifierState('CapsLock'));
    }
  };

  let strength = -1;
  let strengthText = '';
  if (showStrength && value) {
    // Lazy load zxcvbn via global if available; fall back to simple heuristic
    const z = (globalThis as { zxcvbn?: (s: string) => { score: number } }).zxcvbn;
    if (z) {
      strength = z(value).score;
    } else {
      strength = Math.min(4, Math.floor(value.length / 4));
    }
    strengthText = ['Rất yếu', 'Yếu', 'Trung bình', 'Khá', 'Mạnh'][strength] || '';
  }

  const strengthColor = ['#dc2626', '#f59e0b', '#f59e0b', '#10b981', '#059669'][Math.max(0, strength)];

  return (
    <div className="row password-row">
      <label htmlFor={id}>{label}</label>
      {/* Bọc ô + nút mắt trong một khung riêng: nút căn theo ĐÚNG ô nhập (top/bottom 0) thay vì
          đoán `top: 28px` theo chiều cao nhãn — nhãn xuống 2 dòng hay đổi cỡ chữ là nút lệch. */}
      <div className="password-box">
      <input
        id={id}
        name={name}
        required={required}
        type={show ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onBlur={onBlur}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[error ? `${id}-err` : null, ariaDescribedBy].filter(Boolean).join(' ') || undefined}
      />
      <button
        type="button"
        className="toggle"
        onClick={() => setShow((s) => !s)}
        aria-pressed={show}
        aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      >
        {/* Đang hiện chữ → icon "ẩn" (bấm để che lại), và ngược lại — giữ đúng nghĩa cặp 🙈/👁 cũ. */}
        <Icon name={show ? 'an' : 'hien'} size={22} />
      </button>
      </div>
      {error && (
        <div className="field-error" id={`${id}-err`} role="alert">
          {error}
        </div>
      )}
      {capsOn && (
        <div className="field-error" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="canh-bao" size={16} />Caps Lock đang bật
        </div>
      )}
      {showStrength && value && (
        <>
          <div className="strength-meter" aria-hidden="true">
            {/* scaleX thay vì width: animate transform không gây reflow (detector: layout-transition). */}
            <div
              className="bar"
              style={{ transform: `scaleX(${(strength + 1) / 5})`, background: strengthColor }}
            />
          </div>
          <div className="strength-text">Độ mạnh: {strengthText}</div>
        </>
      )}
    </div>
  );
}

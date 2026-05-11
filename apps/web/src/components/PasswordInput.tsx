// P01.D-19 — show/hide toggle + caps-lock warning + optional zxcvbn strength meter
import { useState, KeyboardEvent } from 'react';

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
      <input
        id={id}
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
        aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      >
        {show ? '🙈' : '👁'}
      </button>
      {error && (
        <div className="field-error" id={`${id}-err`}>
          {error}
        </div>
      )}
      {capsOn && <div className="field-error">⚠ Caps Lock đang bật</div>}
      {showStrength && value && (
        <>
          <div className="strength-meter" aria-hidden="true">
            <div
              className="bar"
              style={{ width: `${((strength + 1) / 5) * 100}%`, background: strengthColor }}
            />
          </div>
          <div className="strength-text">Độ mạnh: {strengthText}</div>
        </>
      )}
    </div>
  );
}

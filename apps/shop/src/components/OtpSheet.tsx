import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent, JSX } from 'react';
import { PublicOtpRequestResult, PublicPhoneSession } from '@order/schemas';
import { postJson, type ApiError } from '../lib/use-api.ts';
import { readPhoneSession, savePhoneSession, type PhoneSession } from '../lib/customer-token.ts';

/**
 * Bottom-sheet nhập mã OTP (2026-08-04) — bước "đăng nhập bằng SĐT" duy nhất của apps/shop,
 * dùng chung cho checkout (trước popup xác nhận đơn) và trang Đơn của tôi (tra cứu/đổi số).
 *
 * Hành vi đã chốt với chủ dự án:
 *  - Mở sheet là TỰ gửi mã ngay (khách không phải bấm thêm), nút "Gửi lại" đếm ngược theo
 *    `cooldown_s` BE trả về — FE không tự bịa hằng số cooldown.
 *  - Verify thành công: BE thu hồi phiên cũ của thiết bị (gửi kèm `current_session_token`),
 *    sheet tự LƯU phiên mới vào localStorage rồi mới báo `onVerified` — caller không phải
 *    nhớ gọi save, quên là khách bị hỏi OTP lại ở màn sau.
 *  - Lỗi hiện NGAY TRONG sheet (cùng bài học popup checkout 2026-08-04: lỗi phải nằm đúng
 *    nơi mắt khách đang nhìn, không phải banner cuối trang).
 *
 * Nằm GIỮA màn hình chứ không neo đáy như `ConfirmOrderModal` (feedback chủ dự án
 * 2026-08-05): đây là hộp thoại tập trung một việc — nhập 6 số — không phải tờ tóm tắt dài
 * phải cuộn; giữa màn hình là nơi mắt khách đang nhìn bàn phím số bật lên.
 *
 * Ô mã là 6 Ô RIÊNG (cùng feedback): input THẬT tàng hình phủ lên trên 6 ô vẽ — giữ được
 * autofill `one-time-code` từ SMS, dán cả chuỗi, và bàn phím số của một input duy nhất;
 * 6 input rời là tự làm vỡ cả ba thứ đó.
 */
export function OtpSheet({
  phone,
  onVerified,
  onCancel,
}: {
  /** SĐT nhận mã — chuỗi khách gõ, BE tự chuẩn hoá. */
  phone: string;
  onVerified: (session: PhoneSession) => void;
  onCancel: () => void;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [codeFocused, setCodeFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [expiresInMin, setExpiresInMin] = useState<number | null>(null);
  const [sentOnce, setSentOnce] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function requestCode(): Promise<void> {
    setSending(true);
    setError(null);
    const result = await postJson('/api/public/otp/request', { phone }, PublicOtpRequestResult);
    setSending(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setSentOnce(true);
    setCooldownLeft(result.data.cooldown_s);
    setExpiresInMin(Math.round(result.data.expires_in_s / 60));
    inputRef.current?.focus();
  }

  // Tự gửi mã khi sheet mở. Ref guard: StrictMode dev mount 2 lần — không được bắn 2 mã
  // (mã thứ hai dính ngay cooldown 60s của BE và khách thấy lỗi dù không làm gì sai).
  const didAutoSend = useRef(false);
  useEffect(() => {
    if (didAutoSend.current) return;
    didAutoSend.current = true;
    void requestCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Đồng hồ đếm ngược nút "Gửi lại".
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const t = window.setTimeout(() => setCooldownLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldownLeft]);

  async function verify(): Promise<void> {
    if (verifying || code.length !== 6) return;
    setVerifying(true);
    setError(null);

    const currentToken = readPhoneSession()?.session_token;
    const result = await postJson(
      '/api/public/otp/verify',
      {
        phone,
        code,
        ...(currentToken ? { current_session_token: currentToken } : {}),
      },
      PublicPhoneSession,
    );
    setVerifying(false);

    if ('error' in result) {
      setError(result.error);
      // Mã chết hẳn (hết hạn / cạn lượt) thì mã trong ô không còn giá trị gì — dọn luôn cho
      // khách khỏi bấm verify lại vô ích với đúng chuỗi cũ.
      if (result.error.code === 'OTP_EXPIRED' || result.error.code === 'OTP_TOO_MANY_ATTEMPTS') {
        setCode('');
      }
      return;
    }

    savePhoneSession(result.data);
    onVerified(result.data);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void verify();
  }

  return (
    <div
      className="shop-otp-overlay"
      style={overlay}
      role="presentation"
      onClick={() => {
        if (!verifying) onCancel();
      }}
    >
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{OTP_SHEET_CSS}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Xác minh số điện thoại"
        className="shop-otp-sheet"
        style={sheet}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={title}>Xác minh số điện thoại</h2>
        <p style={lead}>
          {sentOnce ? 'Mã xác minh 6 số đã được gửi tới ' : 'Đang gửi mã xác minh 6 số tới '}
          <strong style={phoneStrong}>{phone}</strong>
          {expiresInMin !== null && ` — mã có hiệu lực trong ${expiresInMin} phút`}.
        </p>

        <form style={form} onSubmit={onSubmit}>
          <label style={label} htmlFor="otp-code">
            Mã xác minh
          </label>
          {/* 6 ô hiển thị + 1 input thật tàng hình phủ lên (xem docblock). Bấm đâu trong vùng
              cũng là focus vào input thật; ô "đang chờ số" viền đậm theo con trỏ thật. */}
          <div style={codeBoxWrap}>
            {Array.from({ length: 6 }, (_, i) => {
              const active = codeFocused && i === Math.min(code.length, 5);
              return (
                <span
                  key={i}
                  aria-hidden="true"
                  style={{
                    ...codeBox,
                    ...(active ? codeBoxActive : {}),
                    ...(error ? codeBoxError : {}),
                  }}
                >
                  {code[i] ?? ''}
                </span>
              );
            })}
            <input
              id="otp-code"
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onFocus={() => setCodeFocused(true)}
              onBlur={() => setCodeFocused(false)}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError(null);
              }}
              style={codeGhostInput}
            />
          </div>

          {error && <p style={errorText}>{error.message}</p>}

          <button
            type="submit"
            style={code.length === 6 && !verifying ? confirmBtn : { ...confirmBtn, ...btnDisabled }}
            disabled={code.length !== 6 || verifying}
          >
            {verifying ? 'Đang kiểm tra…' : 'XÁC MINH'}
          </button>
        </form>

        <div style={footerRow}>
          <button
            type="button"
            style={cooldownLeft > 0 || sending ? { ...resendBtn, ...btnDisabled } : resendBtn}
            disabled={cooldownLeft > 0 || sending}
            onClick={() => void requestCode()}
          >
            {sending
              ? 'Đang gửi…'
              : cooldownLeft > 0
                ? `Gửi lại mã (${cooldownLeft}s)`
                : sentOnce
                  ? 'Gửi lại mã'
                  : 'Gửi mã'}
          </button>
          <button type="button" style={cancelBtn} disabled={verifying} onClick={onCancel}>
            Quay lại
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Animation MỞ hộp thoại (chỉ có vào, không có ra — đóng là unmount thẳng, cùng cách
 * `Header.tsx` xử lý drawer để không phải giữ state chờ animation ra).
 *
 * Hộp thoại này nằm GIỮA màn hình (quyết định 2026-08-05, xem docblock đầu file) nên
 * PHÓNG NHẸ TỪ TÂM chứ không trượt từ đáy lên: trượt-từ-đáy là ngôn ngữ của bottom
 * sheet, dùng cho hộp giữa màn hình sẽ thành một khối bay ngang qua nội dung.
 *
 * 0.96 → 1 là mức cố tình nhỏ: sheet chứa 6 ô mã cỡ mono --fs-xl, phóng mạnh hơn thì
 * chữ số bị nhoè trong lúc chạy. Chỉ opacity trên lớp phủ + transform trên sheet.
 * Lớp phủ mờ dần đã kéo theo cả sheet (con của nó) nên keyframe của sheet KHÔNG lặp
 * lại opacity — hai lớp opacity nhân nhau làm nhịp hiện ra bị chậm ở nửa đầu.
 */
const OTP_SHEET_CSS = `
@keyframes shop-otp-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes shop-otp-sheet-in {
  from { transform: scale(0.96); }
  to { transform: scale(1); }
}
.shop-otp-overlay { animation: shop-otp-backdrop-in var(--dur-base) var(--ease-out); }
.shop-otp-sheet { animation: shop-otp-sheet-in var(--dur-base) var(--ease-out); }
@media (prefers-reduced-motion: reduce) {
  .shop-otp-overlay, .shop-otp-sheet { animation: none; }
}
`;

// Cùng thang lớp xếp với popup xác nhận đơn (tokens.css) — thấp hơn là thanh ĐẶT HÀNG dính
// đáy sẽ nổi đè lên sheet (bug 2026-08-04 của ConfirmOrderModal). GIỮA màn hình (feedback
// 2026-08-05), chừa gutter hai bên để không dán sát mép trên điện thoại hẹp.
const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--z-overlay)' as unknown as number,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--sp-4) var(--gutter)',
};

// Hẹp hơn --content-max hẳn: hộp thoại một việc (6 số), bề ngang rộng chỉ làm 6 ô trôi
// lạc giữa khoảng trống.
const sheet: CSSProperties = {
  width: '100%',
  maxWidth: '400px',
  maxHeight: '85vh',
  overflowY: 'auto',
  zIndex: 'var(--z-sheet)' as unknown as number,
  background: 'var(--bg-surface)',
  borderRadius: 'var(--r-card)',
  boxShadow: 'var(--shadow-sheet)',
  padding: 'var(--pad-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const title: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const lead: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  lineHeight: 1.5,
};

const phoneStrong: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-strong)',
};

const form: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const label: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

// ── 6 ô mã (feedback 2026-08-05) ──
// `position: relative` để input thật tàng hình phủ kín vùng ô — bấm ô nào cũng là bấm input.
const codeBoxWrap: CSSProperties = {
  position: 'relative',
  display: 'flex',
  gap: 'var(--sp-2)',
  justifyContent: 'center',
};

const codeBox: CSSProperties = {
  flex: 1,
  maxWidth: '52px',
  aspectRatio: '4 / 5',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-input)',
  background: 'var(--bg-sunken)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xl)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const codeBoxActive: CSSProperties = {
  border: '2px solid var(--brand-600)',
  background: 'var(--bg-surface)',
};

const codeBoxError: CSSProperties = {
  border: '1px solid var(--danger-600)',
};

// Input thật: tàng hình nhưng VẪN focus/gõ/dán được. fontSize ≥16px bắt buộc dù không nhìn
// thấy — Safari iOS vẫn tự zoom theo fontSize của input đang focus. Chữ + caret trong suốt
// để không lộ dòng chữ mờ đè lên các ô.
const codeGhostInput: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  opacity: 0.01,
  border: 'none',
  background: 'transparent',
  color: 'transparent',
  caretColor: 'transparent',
  fontSize: 'var(--fs-base)',
  textAlign: 'center',
};

const errorText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--danger-600)',
};

const confirmBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  cursor: 'pointer',
};

const btnDisabled: CSSProperties = {
  opacity: 'var(--opacity-disabled)',
  cursor: 'not-allowed',
};

const footerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
};

const resendBtn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 'var(--sp-2) 0',
  color: 'var(--brand-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
  textDecoration: 'underline',
};

const cancelBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

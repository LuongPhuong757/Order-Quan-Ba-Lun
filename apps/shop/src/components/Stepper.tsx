import type { CSSProperties, JSX } from 'react';

/**
 * Stepper 2 bước ngang dùng chung cho `/cart` (bước 1 "Giỏ hàng", plan 08-11) và
 * `/checkout` (bước 2 "Thông tin nhận hàng", plan 08-12).
 *
 * Bước đang active: vòng tròn nền `--brand-600` chữ `--text-on-brand`.
 * Bước chưa tới: vòng tròn viền `--border-strong` nền trong suốt, chữ `--text-muted`.
 *
 * Mobile: co lại (nhãn `--fs-caption`) để nằm cùng hàng với logo trong header thu gọn
 * (UI-SPEC "Giỏ hàng (/cart)" — đoạn header thu gọn) — thi công bằng `@media` trong
 * thẻ `<style>`, KHÔNG dùng JS đo kích thước màn hình (cùng khuôn `Header.tsx`/
 * `FloatingCart.tsx`).
 *
 * Thuộc tính ARIA đánh dấu bước đang active chỉ đặt ở 1 nhánh JSX (2 nhánh literal
 * riêng, cùng kỹ thuật `BannerNotice.tsx` dùng cho `role="alert"`/`role="status"`) —
 * dễ kiểm tĩnh bằng grep, và trình đọc màn hình nhận đúng ARIA ngay từ lần render đầu.
 */
type Props = {
  current: 1 | 2;
};

const STEPS: { step: 1 | 2; label: string }[] = [
  { step: 1, label: 'Giỏ hàng' },
  { step: 2, label: 'Thông tin nhận hàng' },
];

export function Stepper({ current }: Props): JSX.Element {
  return (
    <nav style={wrap} aria-label="Tiến trình đặt hàng">
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{MEDIA_CSS}</style>
      {STEPS.map((s, idx) => (
        <span key={s.step} style={stepItem}>
          <StepBadge step={s.step} label={s.label} active={s.step === current} />
          {idx < STEPS.length - 1 && <span style={connector} aria-hidden="true" />}
        </span>
      ))}
    </nav>
  );
}

function StepBadge({
  step,
  label,
  active,
}: {
  step: number;
  label: string;
  active: boolean;
}): JSX.Element {
  if (active) {
    return (
      <span style={stepInner} aria-current="step">
        <span style={circleActive}>{step}</span>
        <span className="shop-stepper-label" style={{ ...labelStyle, ...labelActive }}>
          {label}
        </span>
      </span>
    );
  }
  return (
    <span style={stepInner}>
      <span style={circle}>{step}</span>
      <span className="shop-stepper-label" style={labelStyle}>
        {label}
      </span>
    </span>
  );
}

// Mobile: co nhãn về --fs-caption, giảm khoảng cách để stepper vừa 1 hàng cùng logo.
const MEDIA_CSS = `
.shop-stepper-label { font-size: var(--fs-sm); }
@media (max-width: 480px) {
  .shop-stepper-label { font-size: var(--fs-caption); }
}
`;

const wrap: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) 0',
};

const stepItem: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
};

const stepInner: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
};

const circleBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'var(--sp-6)',
  height: 'var(--sp-6)',
  borderRadius: 'var(--r-badge)',
  fontFamily: 'var(--font-body)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  fontSize: 'var(--fs-sm)',
  flexShrink: 0,
};

const circle: CSSProperties = {
  ...circleBase,
  background: 'transparent',
  border: '1px solid var(--border-strong)',
  color: 'var(--text-muted)',
};

const circleActive: CSSProperties = {
  ...circleBase,
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
};

const labelActive: CSSProperties = {
  color: 'var(--text-strong)',
};

const connector: CSSProperties = {
  width: 'var(--sp-8)',
  height: '1px',
  background: 'var(--border-default)',
};

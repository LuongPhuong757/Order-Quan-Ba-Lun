import type { CSSProperties, JSX, ReactNode } from 'react';

/**
 * Banner dùng chung cho 4 tình huống ở trang khách (`components.banner-notice`,
 * `apps/shop/DESIGN.md`): OFF thủ công, ngoài giờ mở cửa, lỗi tải menu/submit,
 * và "giá một vài món đã được cập nhật" (D-07). KHÔNG sticky — cuộn theo trang.
 *
 * `tone` chọn màu + `role` ARIA:
 *   - brand: OFF thủ công + banner giá đổi (nền `--brand-100`)
 *   - warn: ngoài giờ mở cửa (nền `--warn-100`)
 *   - danger: lỗi tải/lỗi submit (nền `--danger-100`, `role="alert"`)
 *   - info: "Quán đã cập nhật đơn của bạn" ở `/o/:token` (nền `--info-100`, phase 9 / M2.D-47)
 *
 * Vì sao `info` tách khỏi `brand` dù cùng dùng `InfoGlyph`: `brand` là chuyện của QUÁN (đang tắt
 * nhận đơn, giá đổi), `info` là chuyện của ĐƠN NÀY (quán vừa sửa đơn của bạn). Hai loại tin khác
 * nhau về mức liên quan tới khách nên phải khác màu — dùng chung `brand` là để tin về đơn của khách
 * lẫn vào tin chung của quán.
 *
 * `action.href` — nếu có, đây là SỐ ĐIỆN THOẠI quán (không phải URL đầy đủ);
 * component tự dựng liên kết gọi điện để khách gọi 1 chạm (bảng Copywriting
 * `ONLINE_ORDERING_DISABLED`).
 */
type Tone = 'brand' | 'warn' | 'danger' | 'info';

type Props = {
  tone: Tone;
  title: string;
  body?: ReactNode;
  action?: { label: string; onClick?: () => void; href?: string };
};

const TONE_STYLES: Record<Tone, { bg: string; text: string }> = {
  brand: { bg: 'var(--brand-100)', text: 'var(--text-strong)' },
  warn: { bg: 'var(--warn-100)', text: 'var(--warn-600)' },
  danger: { bg: 'var(--danger-100)', text: 'var(--danger-600)' },
  info: { bg: 'var(--info-100)', text: 'var(--info-600)' },
};

export function BannerNotice({ tone, title, body, action }: Props): JSX.Element {
  const palette = TONE_STYLES[tone];
  const containerStyle: CSSProperties = { ...container, background: palette.bg, color: palette.text };

  const content = (
    <>
      <span style={{ ...iconWrap, color: palette.text }}>{renderIcon(tone)}</span>
      <div style={textCol}>
        <p style={titleStyle}>{title}</p>
        {body && <p style={bodyStyle}>{body}</p>}
      </div>
      {action &&
        (action.href ? (
          <a href={`tel:${action.href}`} style={actionLink}>
            {action.label}
          </a>
        ) : (
          <button type="button" onClick={action.onClick} style={actionButton}>
            {action.label}
          </button>
        ))}
    </>
  );

  // 2 nhánh render riêng (thay vì role động) để role="alert"/role="status" là
  // literal trong JSX — dễ kiểm tra tĩnh, và trình đọc màn hình luôn nhận
  // đúng ARIA role ngay từ lần render đầu.
  if (tone === 'danger') {
    return (
      <div style={containerStyle} role="alert">
        {content}
      </div>
    );
  }
  return (
    <div style={containerStyle} role="status">
      {content}
    </div>
  );
}

function renderIcon(tone: Tone): JSX.Element {
  if (tone === 'danger') return <AlertGlyph />;
  if (tone === 'warn') return <ClockGlyph />;
  // `info` và `brand` dùng chung InfoGlyph — cùng là tin cần đọc chứ không phải cảnh báo, phân
  // biệt bằng màu nền. Nhánh này viết tường minh để đọc code biết `info` đã được xử lý, không
  // phải rơi vào default một cách tình cờ.
  if (tone === 'info') return <InfoGlyph />;
  return <InfoGlyph />;
}

function InfoGlyph(): JSX.Element {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </svg>
  );
}

function ClockGlyph(): JSX.Element {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function AlertGlyph(): JSX.Element {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5 21.5 20h-19Z" />
      <path d="M12 9.5v4.5M12 17v.01" />
    </svg>
  );
}

const container: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  width: '100%',
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: 'var(--sp-3) var(--sp-4)',
  borderRadius: 'var(--r-card)',
};

const iconWrap: CSSProperties = {
  display: 'inline-flex',
  flexShrink: 0,
};

const textCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  flex: '1 1 auto',
  minWidth: '50%',
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const actionButton: CSSProperties = {
  flexShrink: 0,
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid currentColor',
  borderRadius: 'var(--r-button)',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const actionLink: CSSProperties = {
  ...actionButton,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
};

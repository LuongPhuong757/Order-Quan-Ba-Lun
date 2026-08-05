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

// Bản thiết kế lại 2026-08-05 (feedback "banner khối màu đặc trông xấu"): banner giờ là CARD
// nền trắng cùng họ với card món/hoá đơn của trang — tông màu chỉ nói qua 2 kênh nhỏ: mép
// trái 4px + huy hiệu icon tròn nền nhạt. Chữ luôn là --text-strong/--text-muted như mọi
// card khác, KHÔNG nhuộm cả đoạn theo tông màu (chữ màu trên nền màu là thứ làm nó rối).
const TONE_STYLES: Record<Tone, { edge: string; badgeBg: string; badgeText: string }> = {
  brand: { edge: 'var(--brand-600)', badgeBg: 'var(--brand-100)', badgeText: 'var(--brand-600)' },
  warn: { edge: 'var(--warn-600)', badgeBg: 'var(--warn-100)', badgeText: 'var(--warn-600)' },
  danger: { edge: 'var(--danger-600)', badgeBg: 'var(--danger-100)', badgeText: 'var(--danger-600)' },
  info: { edge: 'var(--info-600)', badgeBg: 'var(--info-100)', badgeText: 'var(--info-600)' },
};

export function BannerNotice({ tone, title, body, action }: Props): JSX.Element {
  const palette = TONE_STYLES[tone];
  const containerStyle: CSSProperties = { ...container, borderLeft: `4px solid ${palette.edge}` };

  const content = (
    <>
      <span style={{ ...iconBadge, background: palette.badgeBg, color: palette.badgeText }}>
        {renderIcon(tone)}
      </span>
      <div style={textCol}>
        <p style={titleStyle}>{title}</p>
        {body && <p style={bodyStyle}>{body}</p>}
      </div>
      {action &&
        (action.href ? (
          <a href={`tel:${action.href}`} style={{ ...actionLink, color: palette.edge }}>
            {action.label}
          </a>
        ) : (
          <button type="button" onClick={action.onClick} style={{ ...actionButton, color: palette.edge }}>
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
  // flex-start chứ không center: body dài xuống nhiều dòng thì icon phải neo cạnh TIÊU ĐỀ,
  // không trôi lơ lửng giữa khối chữ.
  alignItems: 'flex-start',
  gap: 'var(--sp-3)',
  width: '100%',
  // apps/shop KHÔNG có reset `box-sizing` toàn cục — thiếu dòng này thì width 100% + padding
  // ngang làm banner phình rộng hơn khung 32px, tràn khỏi mép phải màn hình điện thoại.
  boxSizing: 'border-box',
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: 'var(--sp-3) var(--sp-4)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
};

// Huy hiệu tròn nền nhạt — kênh màu thứ hai bên cạnh mép trái, thay cho việc nhuộm cả banner.
const iconBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '36px',
  height: '36px',
  borderRadius: '50%',
};

const textCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  flex: '1 1 auto',
  minWidth: '50%',
  // Đẩy khối chữ xuống cho dòng tiêu đề canh giữa với huy hiệu 36px.
  paddingTop: '2px',
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
  lineHeight: 'var(--lh-snug)',
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  lineHeight: 1.55,
};

const actionButton: CSSProperties = {
  flexShrink: 0,
  alignSelf: 'center',
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

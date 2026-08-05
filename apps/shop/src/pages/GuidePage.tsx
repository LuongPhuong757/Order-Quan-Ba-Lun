import type { CSSProperties, JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PublicStoreStatus } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';

/**
 * `/guide` — trang hướng dẫn đặt món cho khách lần đầu (chỉ đạo chủ dự án 2026-08-05).
 *
 * Minh hoạ là MOCK-UI vẽ bằng chính token của theme, KHÔNG dùng ảnh chụp màn hình:
 * ảnh chụp sẽ lệch theme ngay khi chủ quán đổi màu/đổi menu, còn mock-UI thì tự ăn
 * theo tokens.css và nhẹ hơn nhiều trên 3G. Mock-UI nằm trong khối `aria-hidden` +
 * chặn con trỏ — nút "+ Thêm" giả mà bấm được là lừa khách.
 *
 * Bước OTP hiện THEO CỜ `otp_required` của `GET /api/public/store` (cùng cờ mà
 * CheckoutPage dùng để quyết định mở OtpSheet): quán tắt OTP thì bước này biến mất
 * và các bước tự đánh số lại — hướng dẫn không bao giờ tả một màn không tồn tại.
 * Lúc API chưa về / lỗi thì MẶC ĐỊNH HIỆN (thừa một bước vô hại, thiếu thì khách
 * gặp màn OTP mà không được báo trước).
 *
 * Layout chốt với chủ dự án 2026-08-05 (sau AskUserQuestion):
 *   - Mobile: timeline dọc — text rồi minh hoạ, mỗi bước một cụm.
 *   - ≥768px: ZIGZAG xen kẽ trái–phải, đường kẻ đứt dọc giữa nối các bước.
 *     Kỹ thuật 2 layout bằng CSS `@media` qua thẻ `<style>` (mẫu Header.tsx) —
 *     không JS đo màn hình, không nhấp nháy lúc mount.
 */

type Step = {
  key: string;
  title: string;
  desc: string;
  cta?: { to: string; label: string };
  art: ReactNode;
};

export function GuidePage(): JSX.Element {
  const store = useApi('/api/public/store', PublicStoreStatus);
  // `!== false`: chưa biết (đang tải/lỗi) thì cứ hiện bước OTP — xem doc đầu file.
  const showOtp = store.data?.otp_required !== false;

  const steps: Step[] = [
    {
      key: 'menu',
      title: 'Chọn món',
      desc: 'Lướt dải danh mục hoặc gõ tên món vào ô tìm kiếm, rồi bấm nút "Thêm" trên món bạn thích. Món đang hết hàng sẽ bị làm mờ.',
      cta: { to: '/', label: 'Xem menu' },
      art: <FakeDishCard />,
    },
    {
      key: 'cart',
      title: 'Kiểm tra giỏ hàng',
      desc: 'Bấm biểu tượng giỏ ở góc phải màn hình để xem lại. Chỉnh số lượng bằng nút − / +, thêm ghi chú cho quán nếu cần, rồi bấm TIẾP TỤC.',
      cta: { to: '/cart', label: 'Mở giỏ hàng' },
      art: <FakeCart />,
    },
    {
      key: 'info',
      title: 'Điền thông tin nhận hàng',
      desc: 'Chọn "Đến lấy tại quán" hoặc "Giao tận nơi", điền họ tên và số điện thoại. Giao tận nơi thì thêm địa chỉ — bấm "Chia sẻ vị trí" để quán biết khoảng cách chính xác (không bắt buộc).',
      art: <FakeForm />,
    },
    ...(showOtp
      ? [
          {
            key: 'otp',
            title: 'Xác minh số điện thoại',
            desc: 'Lần đầu đặt món, bạn sẽ nhận được mã 6 số gửi tới số điện thoại vừa điền. Nhập mã là xong — thiết bị được ghi nhớ, lần sau không cần nhập lại.',
            art: <FakeOtp />,
          } satisfies Step,
        ]
      : []),
    {
      key: 'submit',
      title: 'Đặt hàng & theo dõi đơn',
      desc: 'Bấm ĐẶT HÀNG, xem lại tóm tắt trong hộp xác nhận rồi gửi. Quán sẽ gọi điện xác nhận trước khi chuẩn bị món, và bạn theo dõi được tiến độ đơn trực tiếp trên trang theo dõi.',
      art: <FakeProgress />,
    },
    {
      key: 'history',
      title: 'Xem lại đơn đã đặt',
      desc: 'Vào "Đơn của tôi" để xem đơn đang chạy và các đơn trước đó. Muốn sửa hay huỷ đơn, gọi thẳng cho quán theo số ở cuối trang — người thật xử lý nhanh nhất.',
      cta: { to: '/history', label: 'Đơn của tôi' },
      art: <FakeHistory />,
    },
  ];

  return (
    <div style={page}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{RESPONSIVE_CSS}</style>

      <header style={hero}>
        <h1 style={heading}>Hướng dẫn đặt món</h1>
        <p style={subtitle}>
          Từ chọn món đến nhận hàng chỉ mất vài phút — làm theo {steps.length} bước dưới đây.
        </p>
      </header>

      <ol className="shop-guide-list" style={list}>
        {steps.map((step, i) => (
          <li key={step.key} className="shop-guide-step" style={stepItem}>
            <div style={stepText}>
              <div style={stepHead}>
                <span style={stepBadge}>{i + 1}</span>
                <h2 style={stepTitle}>{step.title}</h2>
              </div>
              <p style={stepDesc}>{step.desc}</p>
              {step.cta && (
                <Link to={step.cta.to} style={stepCta}>
                  {step.cta.label}
                  <ArrowGlyph />
                </Link>
              )}
            </div>

            {/* Minh hoạ thuần trang trí: ẩn với trình đọc, chặn con trỏ để nút giả
                không bấm được — nội dung thật đã nằm hết ở phần chữ bên trên. */}
            <div style={stepArtWrap} aria-hidden="true">
              {step.art}
            </div>
          </li>
        ))}
      </ol>

      <Link to="/" style={ctaButton}>
        Bắt đầu đặt món
      </Link>
    </div>
  );
}

/* ═══ Mock-UI minh hoạ — toàn bộ màu/chữ lấy từ token, số liệu là ví dụ tĩnh ═══ */

/** Bước 1: card món thu nhỏ theo đúng ngôn ngữ CardItem (viền, không bóng, nút đỏ). */
function FakeDishCard(): JSX.Element {
  return (
    <div style={artCard}>
      <div style={fakeMedia}>
        <BowlGlyph />
      </div>
      <div style={fakeDishBody}>
        <span style={fakeDishName}>Lẩu hải sản</span>
        <div style={fakeDishRow}>
          <span style={fakeDishPrice}>299.000 ₫</span>
          <span style={fakeAddBtn}>+ Thêm</span>
        </div>
      </div>
    </div>
  );
}

/** Bước 2: 2 dòng giỏ hàng + tạm tính + nút TIẾP TỤC. */
function FakeCart(): JSX.Element {
  return (
    <div style={{ ...artCard, padding: 'var(--pad-card)', gap: 'var(--sp-3)' }}>
      <FakeCartRow name="Lẩu hải sản" price="299.000 ₫" qty={1} />
      <FakeCartRow name="Ba chỉ bò Mỹ" price="149.000 ₫" qty={1} />
      <div style={fakeDivider} />
      <div style={fakeTotalRow}>
        <span style={fakeTotalLabel}>Tạm tính</span>
        <span style={fakeTotalValue}>448.000 ₫</span>
      </div>
      <span style={fakeCtaBar}>TIẾP TỤC</span>
    </div>
  );
}

function FakeCartRow({ name, price, qty }: { name: string; price: string; qty: number }): JSX.Element {
  return (
    <div style={fakeCartRow}>
      <div style={fakeCartInfo}>
        <span style={fakeCartName}>{name}</span>
        <span style={fakeCartPrice}>{price}</span>
      </div>
      <span style={fakeStepper}>
        <span style={fakeStepperBtn}>−</span>
        <span style={fakeStepperQty}>{qty}</span>
        <span style={fakeStepperBtn}>+</span>
      </span>
    </div>
  );
}

/** Bước 3: segment PICKUP/DELIVERY + 3 ô form như /checkout. */
function FakeForm(): JSX.Element {
  return (
    <div style={{ ...artCard, padding: 'var(--pad-card)', gap: 'var(--sp-3)' }}>
      <div style={fakeSegmentRow}>
        <span style={fakeSegment}>Đến lấy tại quán</span>
        <span style={fakeSegmentActive}>Giao tận nơi</span>
      </div>
      <FakeField label="Họ và tên" value="Nguyễn Văn A" />
      <FakeField label="Số điện thoại" value="0901 234 567" />
      <FakeField label="Địa chỉ giao hàng" value="12 Nguyễn Trãi, Q.1" />
    </div>
  );
}

function FakeField({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={fakeFieldWrap}>
      <span style={fakeFieldLabel}>{label}</span>
      <span style={fakeFieldInput}>{value}</span>
    </div>
  );
}

/** Bước 4 (khi quán bật OTP): 6 ô mã — 3 số đã nhập, 3 ô trống như OtpSheet. */
function FakeOtp(): JSX.Element {
  const digits = ['4', '8', '2', '', '', ''];
  return (
    <div style={{ ...artCard, padding: 'var(--pad-card)', gap: 'var(--sp-3)', alignItems: 'center' }}>
      <span style={fakeOtpHint}>Mã xác minh đã gửi tới 0901 ••• 567</span>
      <div style={fakeOtpRow}>
        {digits.map((d, i) => (
          <span key={i} style={d ? { ...fakeOtpBox, ...fakeOtpBoxFilled } : fakeOtpBox}>
            {d}
          </span>
        ))}
      </div>
      <span style={fakeOtpResend}>Gửi lại (42s)</span>
    </div>
  );
}

/** Bước 5: thanh tiến trình đơn theo ngôn ngữ OrderStepper — chấm nối vạch + 1 nhãn. */
function FakeProgress(): JSX.Element {
  // 4 mốc như đơn PICKUP: nhận đơn → xác nhận → chuẩn bị → chờ lấy; đang ở mốc 3.
  const dots = [true, true, true, false];
  return (
    <div style={{ ...artCard, padding: 'var(--pad-card)', gap: 'var(--sp-3)', alignItems: 'center' }}>
      <span style={fakePercent}>60%</span>
      <div style={fakeTrackRow}>
        {dots.map((done, i) => (
          <span key={i} style={fakeTrackSeg}>
            {i > 0 && <span style={done ? { ...fakeTrackLine, ...fakeTrackLineDone } : fakeTrackLine} />}
            <span style={done ? { ...fakeTrackDot, ...fakeTrackDotDone } : fakeTrackDot} />
          </span>
        ))}
      </div>
      <span style={fakeStageLabel}>Đang chuẩn bị món…</span>
    </div>
  );
}

/** Bước 6: 2 dòng lịch sử đơn với badge trạng thái. */
function FakeHistory(): JSX.Element {
  return (
    <div style={{ ...artCard, padding: 'var(--pad-card)', gap: 'var(--sp-2)' }}>
      <div style={fakeHistoryRow}>
        <div style={fakeCartInfo}>
          <span style={fakeCartName}>Hôm nay · 2 món</span>
          <span style={fakeCartPrice}>448.000 ₫</span>
        </div>
        <span style={{ ...fakeBadge, background: 'var(--ok-100)', color: 'var(--ok-600)' }}>Đang giao</span>
      </div>
      <div style={fakeHistoryRow}>
        <div style={fakeCartInfo}>
          <span style={fakeCartName}>28/07 · 3 món</span>
          <span style={fakeCartPrice}>615.000 ₫</span>
        </div>
        <span style={{ ...fakeBadge, background: 'var(--bg-sunken)', color: 'var(--text-muted)' }}>Hoàn tất</span>
      </div>
    </div>
  );
}

/* ═══ Glyph tự vẽ (giữ nguyên tắc D-22: không thêm package icon) ═══ */

function BowlGlyph(): JSX.Element {
  return (
    <svg
      width={32}
      height={32}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 11h18a9 8 0 0 1-18 0Z" />
      <path d="M5 11c0-2.5 3-6 7-6s7 3.5 7 6" strokeDasharray="1 3" />
      <path d="M17 4.5 20 2" />
    </svg>
  );
}

function ArrowGlyph(): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/* ═══ Responsive: mobile timeline dọc / ≥768px zigzag + kẻ đứt giữa ═══ */

const RESPONSIVE_CSS = `
/* flex-direction + gap của từng bước CỐ Ý chỉ khai trong class, KHÔNG khai inline:
   inline style đè chết @media (bài học đã ghi ở TopDishesPage.tsx — và chính trang
   này từng dính khi khai inline, zigzag không bao giờ kích hoạt). */
.shop-guide-step {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}
@media (min-width: 768px) {
  .shop-guide-list {
    position: relative;
  }
  /* Đường timeline đứt dọc chính giữa — nằm SAU nội dung (z âm không cần vì
     các cột đều có nền riêng hoặc nằm lệch 2 bên khoảng hở giữa). */
  .shop-guide-list::before {
    content: '';
    position: absolute;
    top: var(--sp-4);
    bottom: var(--sp-4);
    left: 50%;
    border-left: 2px dashed var(--border-default);
  }
  .shop-guide-step {
    flex-direction: row;
    align-items: center;
    gap: var(--sp-12);
  }
  .shop-guide-step:nth-child(even) {
    flex-direction: row-reverse;
  }
  .shop-guide-step > * {
    flex: 1 1 0;
    min-width: 0;
  }
}
`;

/* ═══ Style trang ═══ */

const page: CSSProperties = {
  maxWidth: '880px',
  margin: '0 auto',
  padding: `var(--sp-6) var(--gutter) var(--sp-12)`,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-8)',
};

const hero: CSSProperties = {
  textAlign: 'center',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-2xl)',
  lineHeight: 'var(--lh-tight)',
  letterSpacing: 'var(--ls-tight)',
  color: 'var(--text-strong)',
};

const subtitle: CSSProperties = {
  margin: 'var(--sp-2) auto 0',
  maxWidth: 'var(--measure)',
  fontSize: 'var(--fs-base)',
  lineHeight: 'var(--lh-normal)',
  color: 'var(--text-muted)',
};

const list: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-10)',
};

// display/flex-direction/gap nằm trong RESPONSIVE_CSS (class .shop-guide-step) —
// khai inline là zigzag desktop chết vì inline đè @media.
const stepItem: CSSProperties = {
  margin: 0,
};

const stepText: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 'var(--sp-3)',
};

const stepHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
};

const stepBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '40px',
  height: '40px',
  flexShrink: 0,
  borderRadius: 'var(--r-badge)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
};

const stepTitle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  lineHeight: 'var(--lh-tight)',
  color: 'var(--text-strong)',
};

const stepDesc: CSSProperties = {
  margin: 0,
  maxWidth: 'var(--measure)',
  fontSize: 'var(--fs-base)',
  lineHeight: 'var(--lh-normal)',
  color: 'var(--text-body)',
};

const stepCta: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--sp-1)',
  minHeight: 'var(--tap-min)',
  color: 'var(--brand-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  textTransform: 'uppercase',
  textDecoration: 'none',
};

// Chặn mọi tương tác với mock-UI: nút giả không được bấm, chữ giả không cần bôi đen.
const stepArtWrap: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
  userSelect: 'none',
};

const ctaButton: CSSProperties = {
  alignSelf: 'center',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-8)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
  textTransform: 'uppercase',
  textDecoration: 'none',
};

/* ═══ Style mock-UI ═══ */

// Khung chung của mọi minh hoạ — đúng công thức card của theme: viền, KHÔNG bóng.
const artCard: CSSProperties = {
  width: '100%',
  maxWidth: '340px',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  overflow: 'hidden',
};

const fakeMedia: CSSProperties = {
  aspectRatio: 'var(--ratio-card-media)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--wood-100)',
  color: 'var(--wood-500)',
};

const fakeDishBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: 'var(--pad-card)',
};

const fakeDishName: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const fakeDishRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
};

const fakeDishPrice: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-price)',
};

const fakeAddBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--sp-2) var(--sp-4)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const fakeCartRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

const fakeCartInfo: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

const fakeCartName: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const fakeCartPrice: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-price-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const fakeStepper: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  flexShrink: 0,
};

const fakeStepperBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  borderRadius: 'var(--r-button)',
  border: '1px solid var(--border-default)',
  color: 'var(--brand-600)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const fakeStepperQty: CSSProperties = {
  minWidth: '20px',
  textAlign: 'center',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
  fontVariantNumeric: 'tabular-nums',
};

const fakeDivider: CSSProperties = {
  height: '1px',
  background: 'var(--border-subtle)',
};

const fakeTotalRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
};

const fakeTotalLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const fakeTotalValue: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-price)',
};

const fakeCtaBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '40px',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  letterSpacing: 'var(--ls-wide)',
};

const fakeSegmentRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
};

const fakeSegment: CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '36px',
  padding: '0 var(--sp-2)',
  borderRadius: 'var(--r-button)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-muted)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textAlign: 'center',
};

const fakeSegmentActive: CSSProperties = {
  ...fakeSegment,
  border: '1px solid var(--border-brand)',
  background: 'var(--brand-050)',
  color: 'var(--brand-600)',
};

const fakeFieldWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

const fakeFieldLabel: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-muted)',
};

const fakeFieldInput: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: '36px',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-input)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-sunken)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-body)',
};

const fakeOtpHint: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  textAlign: 'center',
};

const fakeOtpRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
};

const fakeOtpBox: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '36px',
  height: '44px',
  borderRadius: 'var(--r-input)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-sunken)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const fakeOtpBoxFilled: CSSProperties = {
  border: '1px solid var(--border-brand)',
  background: 'var(--bg-surface)',
};

const fakeOtpResend: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-faint)',
};

const fakePercent: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-3xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  lineHeight: 'var(--lh-tight)',
  color: 'var(--text-price)',
};

const fakeTrackRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  maxWidth: '240px',
};

const fakeTrackSeg: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flex: 1,
};

// Chấm đầu tiên không có vạch dẫn nên flex tự co — vạch nằm TRƯỚC chấm trong DOM.
const fakeTrackLine: CSSProperties = {
  flex: 1,
  height: '3px',
  borderRadius: 'var(--r-badge)',
  background: 'var(--bg-sunken)',
};

const fakeTrackLineDone: CSSProperties = {
  background: 'var(--herb-600)',
};

const fakeTrackDot: CSSProperties = {
  width: '14px',
  height: '14px',
  flexShrink: 0,
  borderRadius: 'var(--r-badge)',
  border: '2px solid var(--border-default)',
  background: 'var(--bg-surface)',
};

const fakeTrackDotDone: CSSProperties = {
  border: '2px solid var(--herb-600)',
  background: 'var(--herb-600)',
};

const fakeStageLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const fakeHistoryRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-2) 0',
};

const fakeBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: 'var(--sp-1) var(--sp-3)',
  borderRadius: 'var(--r-badge)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  flexShrink: 0,
};

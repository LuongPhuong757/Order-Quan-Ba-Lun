import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicOrderStatus } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { formatVnd } from '../lib/cart-store.ts';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { OrderStepper } from '../components/OrderStepper.tsx';
import { detectOrderUpdate } from '../lib/order-update.ts';

/**
 * `/o/:token` — trang khách theo dõi đơn (REQ-O, 09-UI-SPEC § B).
 *
 * `order_token` trong URL **chính là credential** của đơn (M2.D-11, P08.D-74: 32 byte
 * random hex, lưu plaintext, HTTPS là lớp bảo vệ duy nhất). Nên:
 *  - KHÔNG bao giờ render token đầy đủ ra text — chỉ 4 ký tự đầu.
 *  - Đây là lý do Task 11 đặt `Referrer-Policy: no-referrer` cho site block
 *    `order.<domain>`: URL không được rò qua header Referer sang asset bên ngoài.
 *
 * ── 3 ranh giới của phase 9, đừng vượt ──
 *
 * 1. **FE không tính lại tiến độ.** `percent`, `stage`, `stage_label`, `cancelled_note` render
 *    NGUYÊN VĂN từ API. BE đã đảm bảo % đơn điệu (M2.D-19); FE tự suy diễn là mở đường cho số %
 *    tụt trên màn hình dù BE không hề tụt (T-09-60).
 * 2. **Không có trạng thái từng món** (M2.D-23 / G-1). Response cố ý không trả field đó — đừng đi
 *    tìm, đừng suy ra từ `percent`.
 * 3. **Món bị huỷ PHẢI hiện** (M2.D-21 — ngoại lệ bắt buộc của G-1): `cancelled_count > 0` thì
 *    banner info hiện, dùng đúng câu `cancelled_note` BE soạn. Che đi là lừa khách (T-09-61).
 */

/** Nhịp poll (T-09-62). 8s nằm giữa khoảng 5-10s của REQ-O: đủ nhanh để khách thấy quán vừa duyệt,
 * đủ thưa để không hao pin. Poll DỪNG HẲN khi đơn đã kết thúc — xem `isEnded`. */
const POLL_MS = 8_000;

/** Banner "quán vừa cập nhật đơn" tự ẩn sau 30s. Nó là tin một-lần, không phải trạng thái; để
 * vĩnh viễn thì lần cập nhật sau không còn gây chú ý nữa. */
const UPDATE_NOTICE_MS = 30_000;

export function OrderTrackPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const masked = token ? `${token.slice(0, 4).toUpperCase()}…` : '—';
  const { data, loading, error, reload } = useApi(
    `/api/public/orders/${token ?? ''}`,
    PublicOrderStatus,
    { skip: !token },
  );

  // `useApi` bật `loading` và xoá `data` ở MỌI lần gọi lại, kể cả lần poll nền. Render thẳng từ
  // `data` thì trang khách nháy sang skeleton mỗi 8 giây, và một lần poll rớt mạng (rất thường
  // trên 3G) sẽ xoá sạch đơn trên màn hình. Nên trang giữ bản đọc tốt gần nhất và luôn render từ
  // nó — poll hỏng chỉ là không có gì mới, không phải mất đơn.
  const [shown, setShown] = useState<PublicOrderStatus | null>(null);
  const prevRef = useRef<PublicOrderStatus | null>(null);
  const [justUpdated, setJustUpdated] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (detectOrderUpdate(prevRef.current, data)) setJustUpdated(true);
    prevRef.current = data;
    setShown(data);
  }, [data]);

  useEffect(() => {
    if (!justUpdated) return;
    const timer = setTimeout(() => setJustUpdated(false), UPDATE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [justUpdated]);

  // Đơn đã kết thúc: từ chối · khách tự huỷ · hoàn tất. Poll tiếp là hao pin + băng thông của
  // khách để đọc lại đúng một kết quả không bao giờ đổi nữa (T-09-62).
  const isEnded =
    shown !== null &&
    (shown.status === 'REJECTED' ||
      shown.status === 'CANCELLED_BY_CUSTOMER' ||
      shown.stage === 'COMPLETED');

  useEffect(() => {
    if (!token || isEnded) return;
    const id = setInterval(() => reload(), POLL_MS);
    return () => clearInterval(id);
  }, [token, isEnded, reload]);

  // Tách 1 biến duy nhất để literal mã lỗi chỉ xuất hiện đúng 1 lần trong file
  // (grep dễ kiểm, dùng lại kỹ thuật BannerNotice.tsx áp cho role="alert"/"status").
  const isTokenNotFound = error?.code === 'ORDER_TOKEN_NOT_FOUND';
  const showError = error !== null && shown === null;
  const [editHelpOpen, setEditHelpOpen] = useState(false);

  return (
    <div style={page}>
      {loading && !shown && <SkeletonBlock />}

      {showError && (
        <BannerNotice
          tone="danger"
          title={isTokenNotFound ? 'Không tìm thấy đơn này. Có thể link đã cũ.' : error.message}
          action={isTokenNotFound ? undefined : { label: 'Thử lại', onClick: reload }}
        />
      )}
      {showError && isTokenNotFound && (
        <Link to="/" style={ctaButton}>
          Về menu
        </Link>
      )}

      {shown && (
        <>
          <div style={successHead}>
            <CheckGlyph />
            {/* Sau khi quán đã duyệt, tiêu đề "Đã gửi đơn thành công!" mâu thuẫn với stepper —
                đổi sang chính nhãn mốc của API để hai chỗ nói cùng một chuyện. */}
            <h1 style={heading}>
              {shown.status === 'WAITING' ? 'Đã gửi đơn thành công!' : shown.stage_label}
            </h1>
          </div>
          <p style={orderCode}>
            Mã đơn: <span style={mono}>{masked}</span>
          </p>
          {shown.status === 'WAITING' && <p style={statusLine}>Quán sẽ xác nhận sớm nhất có thể</p>}

          {(justUpdated || shown.cancelled_count > 0) && (
            <BannerNotice
              tone="info"
              title="Quán đã cập nhật đơn của bạn"
              body={
                shown.cancelled_note ??
                'Danh sách món và tổng tiền bên dưới đã là bản mới nhất.'
              }
            />
          )}

          {/* BE gộp "quán từ chối" và "khách tự huỷ" vào cùng `stage = 'REJECTED'` nhưng khác
              `stage_label` — đây là chỗ duy nhất tách 2 câu chữ ra, không tách bằng cách tính
              lại stage. Nhánh này THAY HẲN khối %+stepper: ẩn số %, không vẽ node dở dang. */}
          {shown.stage === 'REJECTED' ? (
            <BannerNotice
              tone="danger"
              title={
                shown.status === 'CANCELLED_BY_CUSTOMER' ? shown.stage_label : 'Đơn đã bị từ chối'
              }
              body={
                shown.status === 'CANCELLED_BY_CUSTOMER'
                  ? 'Bạn có thể đặt lại bất cứ lúc nào từ trang menu.'
                  : (shown.reject_reason ?? '')
              }
              action={{ label: 'Gọi quán', href: shown.store_phone }}
            />
          ) : (
            <div style={progressBlock} aria-live="polite">
              <p style={percentText}>{shown.percent}%</p>
              <OrderStepper stage={shown.stage} fulfillmentType={shown.fulfillment_type} />
              <p style={stageLabelText}>{shown.stage_label}</p>
              {shown.eta_min !== null && shown.eta_max !== null && (
                <p style={etaText}>
                  Dự kiến còn khoảng {shown.eta_min}–{shown.eta_max} phút
                </p>
              )}
            </div>
          )}

          <ul style={itemList}>
            {shown.items.map((item, idx) => (
              <li key={idx} style={itemRow}>
                <span style={itemName}>
                  {item.name} × {item.qty}
                </span>
                <span style={itemPrice}>{formatVnd(item.unit_price * item.qty)}</span>
              </li>
            ))}
          </ul>
          <div style={totalRow}>
            <span style={totalLabel}>Tổng cộng</span>
            <span style={totalValue}>{formatVnd(shown.subtotal)}</span>
          </div>

          {/* M2.D-45/D-46 — sau khi quán đã xác nhận, khách KHÔNG tự sửa đơn được nữa. Không có ô
              nhập nào ở đây là cố ý: đơn đã vào bếp, mọi thay đổi phải qua người thật. Nút gọi
              1 chạm nằm ngay bên dưới. Đơn còn WAITING thì không hiện khối này — đó là trường
              hợp M2.D-44 (khách tự huỷ), xử lý riêng. */}
          {shown.status === 'CONFIRMED' && (
            <div style={editHelpBlock}>
              <button
                type="button"
                style={textButton}
                aria-expanded={editHelpOpen}
                onClick={() => setEditHelpOpen((open) => !open)}
              >
                Muốn sửa đơn?
              </button>
              {editHelpOpen && <p style={editHelpText}>Đơn đã vào bếp, vui lòng gọi quán để đổi.</p>}
            </div>
          )}

          <a href={`tel:${shown.store_phone.replace(/[^0-9+]/g, '')}`} style={ctaButton}>
            Gọi quán: {shown.store_phone}
          </a>
        </>
      )}

      <Link to="/" data-testid="order-track-back-link" style={backLink}>
        ← Về trang menu
      </Link>
    </div>
  );
}

function CheckGlyph(): JSX.Element {
  return (
    <svg
      width={40}
      height={40}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--herb-600)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.5 2.5L16 9.5" />
    </svg>
  );
}

function SkeletonBlock(): JSX.Element {
  return (
    <div style={skeletonWrap} aria-hidden="true">
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{SKELETON_CSS}</style>
      <div className="shop-track-skel" style={skeletonLine} />
      <div className="shop-track-skel" style={{ ...skeletonLine, width: '60%' }} />
      <div className="shop-track-skel" style={{ ...skeletonLine, height: 'var(--sp-16)' }} />
    </div>
  );
}

const SKELETON_CSS = `
.shop-track-skel { animation: shop-track-pulse 1.1s ease-in-out infinite; }
@keyframes shop-track-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
  .shop-track-skel { animation: none; }
}
`;

const page: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: `var(--sp-6) var(--gutter)`,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
};

const successHead: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  textAlign: 'center',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  color: 'var(--text-strong)',
};

const orderCode: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

const mono: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-strong)',
};

const statusLine: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const progressBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
};

const percentText: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-3xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--ok-600)',
  lineHeight: 1,
};

const stageLabelText: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const etaText: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const itemList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const itemRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-strong)',
};

const itemName: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const itemPrice: CSSProperties = {
  flexShrink: 0,
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const totalRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `0 var(--sp-1)`,
};

const totalLabel: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const totalValue: CSSProperties = {
  fontSize: 'var(--fs-2xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-strong)',
};

const editHelpBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-1)',
};

const textButton: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: 'none',
  background: 'transparent',
  color: 'var(--brand-600)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textDecoration: 'underline',
  cursor: 'pointer',
};

const editHelpText: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

// Dùng chung cho cả nút gọi quán và nút "Về menu" khi token sai — cùng 1 kiểu
// nút hành động chính, tránh khai 2 object CSS trùng nhau.
const ctaButton: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textDecoration: 'none',
};

const skeletonWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const skeletonLine: CSSProperties = {
  height: 'var(--sp-6)',
  width: '100%',
  borderRadius: 'var(--r-card)',
  background: 'var(--bg-sunken)',
};

const backLink: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  borderRadius: 'var(--r-button)',
  fontSize: 'var(--fs-base)',
  color: 'var(--brand-600)',
  textDecoration: 'none',
  alignSelf: 'center',
};

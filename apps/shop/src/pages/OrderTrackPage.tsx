import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicOrderStatus, PublicStoreStatus } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { formatVnd } from '../lib/cart-store.ts';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { ImagePlaceholder } from '../components/ImagePlaceholder.tsx';
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

  // D-11/D-14 — câu xác nhận lúc quán Đóng cửa. Gọi 1 LẦN, KHÔNG poll: câu chữ đổi rất thưa (chủ
  // quán sửa tay), không đáng thêm một request mỗi 8 giây.
  // Đọc từ `/api/public/store` thay vì nhận qua router state từ trang checkout, vì khách RẤT hay
  // tải lại trang này (họ giữ link để theo dõi đơn) — router state mất ngay lần refresh đầu.
  const store = useApi('/api/public/store', PublicStoreStatus);

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

  // ⚠ 2026-08-04, chỉ đạo chủ dự án: BỎ nút "Huỷ đơn" (khách tự huỷ, M2.D-44) lẫn "Muốn sửa
  // đơn?"/"Gọi quán" khỏi màn này — thay bằng MỘT dòng thông tin "muốn sửa/huỷ thì gọi quán".
  // Mọi thay đổi đơn đều qua người thật; endpoint DELETE tự-huỷ phía BE vẫn còn, chỉ UI bỏ.

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
                đổi sang chính nhãn mốc của API để hai chỗ nói cùng một chuyện.
                D-11/D-14: đơn còn chờ duyệt VÀ quán đang Đóng cửa → dùng câu xác nhận chủ quán tự
                soạn trong Cài đặt. Nếu quán mở lại trong lúc khách đang xem thì lần đọc
                sau tự về câu bình thường — đó là lý do câu này đọc từ API chứ không nhớ trong URL.
                Chuỗi dài được phép xuống dòng tự do, không giới hạn số dòng. */}
            <h1 style={heading}>
              {shown.status !== 'WAITING'
                ? shown.stage_label
                : store.data && store.data.ordering_enabled === false
                  ? store.data.closed_submit_confirm_text
                  : 'Đã gửi đơn thành công!'}
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

          {/* 2026-08-04: dòng món có ảnh giống giỏ hàng (CartPage) cho hấp dẫn hơn. Tên món
              được WRAP thay vì cắt "…" — thêm ảnh làm hẹp bề ngang, cắt chữ nữa là vỡ layout. */}
          <ul style={itemList}>
            {shown.items.map((item, idx) => (
              <li key={idx} style={itemRow}>
                <div style={thumbWrap}>
                  {item.image ? (
                    <img src={item.image} alt={item.name} style={thumbImg} />
                  ) : (
                    <div style={thumbPlaceholder}>
                      <ImagePlaceholder name={item.name} />
                    </div>
                  )}
                </div>
                <div style={itemBody}>
                  <span style={itemName}>{item.name}</span>
                  <span style={itemQtyLine}>
                    {item.qty} × {formatVnd(item.unit_price)}
                  </span>
                </div>
                <span style={itemPrice}>{formatVnd(item.unit_price * item.qty)}</span>
              </li>
            ))}
          </ul>
          <div style={totalRow}>
            <span style={totalLabel}>Tổng cộng</span>
            <span style={totalValue}>{formatVnd(shown.subtotal)}</span>
          </div>


          {shown.status === 'CANCELLED_BY_CUSTOMER' && (
            <Link to="/" style={ctaButton}>
              Xem menu
            </Link>
          )}

          {/* MỘT dòng thông tin thay cho cụm nút Huỷ/Sửa/Gọi (chỉ đạo 2026-08-04) — muốn sửa
              hay huỷ đơn đều qua người thật: SĐT vẫn bấm gọi được (link tel), nhưng là chữ
              trong câu, không phải nút. */}
          <p style={contactHelpText}>
            Nếu muốn sửa đơn, vui lòng gọi quán:{' '}
            <a href={`tel:${shown.store_phone.replace(/[^0-9+]/g, '')}`} style={contactPhoneLink}>
              {shown.store_phone}
            </a>
          </p>
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
  alignItems: 'center',
  gap: 'var(--sp-3)',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-strong)',
};

// Ảnh 56px vuông — cùng cỡ với thumbnail giỏ hàng (CartPage) để 2 màn nhìn đồng bộ.
const thumbWrap: CSSProperties = {
  width: '56px',
  height: '56px',
  flexShrink: 0,
  borderRadius: 'var(--r-card)',
  overflow: 'hidden',
  background: 'var(--wood-100)',
};

const thumbImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const thumbPlaceholder: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// minWidth 0 để phần chữ được PHÉP co lại trong flex row — thiếu nó thì tên món dài đẩy
// cột giá tràn ra ngoài card (đúng kiểu "vỡ giao diện" cần tránh).
const itemBody: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

const itemName: CSSProperties = {
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  overflowWrap: 'anywhere',
};

const itemQtyLine: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
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

// Nút mở hộp xác nhận: chữ, không phải nút đặc — huỷ đơn không phải hành động chính của trang
// này, để nó nổi ngang nút "Gọi quán" là mời khách bấm nhầm.
/** Dòng thông tin liên hệ thay cho cụm nút Huỷ/Sửa/Gọi (2026-08-04). */
const contactHelpText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  textAlign: 'center',
  lineHeight: 1.6,
};

const contactPhoneLink: CSSProperties = {
  color: 'var(--brand-600)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  textDecoration: 'underline',
  whiteSpace: 'nowrap',
};

// Chỉ nút xác nhận CUỐI CÙNG mới đặc màu danger — đây là bước không hoàn tác được.
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

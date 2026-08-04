import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent, JSX } from 'react';
import { Link } from 'react-router-dom';
import { PublicOrderHistory, type PublicOrderHistoryEntry } from '@order/schemas';
import { postJson, type ApiError } from '../lib/use-api.ts';
import { formatVnd } from '../lib/cart-store.ts';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { readLastCustomer, readLookupPhone, saveLookupPhone } from '../lib/customer-token.ts';

/**
 * `/history` — "Đơn của tôi": tra cứu lịch sử đơn theo SĐT (2026-08-04).
 *
 * Thay empty state tĩnh của phase 8 bằng luồng thật: nhập SĐT → `POST
 * /api/public/orders/lookup` → danh sách đơn, bấm vào đơn mở trang theo dõi `/o/:token`.
 *
 * 3 quyết định UX đã chốt với chủ dự án (2026-08-04):
 *  - SĐT là credential duy nhất (ranh giới quyền: xem docblock `PublicOrderLookup`).
 *  - Trả TOÀN BỘ lịch sử, mới nhất trước, không phân trang.
 *  - SĐT tra thành công được nhớ (`qbl.lookup_phone`, bản BE đã chuẩn hoá) — lần sau mở
 *    trang là tự tra ngay. Chưa từng tra thì mồi bằng SĐT checkout gần nhất (autofill
 *    M2.D-12) vì gần như chắc chắn đó là số khách muốn tra.
 *
 * FE KHÔNG tự dựng nhãn trạng thái — `stage_label` render nguyên văn từ API (cùng nguyên
 * tắc "FE không tính lại tiến độ" của OrderTrackPage). FE chỉ chọn MÀU chip theo `stage`,
 * và màu không bao giờ là kênh nghĩa duy nhất (rule color-only-meaning) vì chữ đã khác nhau.
 *
 * Bố cục card kiểu HOÁ ĐƠN (2026-08-04, sau feedback "xấu, lệch theme"): cột nội dung
 * hẹp 640px (danh sách dọc trên desktop 1200px làm card dãn ngang, dòng món thành chuỗi
 * dài không đọc nổi), từng món một dòng có ×qty thẳng hàng, kẻ đứt như hoá đơn giấy,
 * tổng tiền màu đỏ thương hiệu — cùng họ với card món và trang theo dõi đơn.
 */

/** Validate cục bộ trước khi gọi BE — cùng ngưỡng lỏng với checkout (`computeFieldErrors`):
 * chỉ chặn chuỗi rõ ràng không phải SĐT, chuẩn hoá thật để BE làm (nguồn sự thật duy nhất
 * là `normalizePhone` phía API — FE mà chuẩn hoá chặt hơn là tự chế nguồn thứ hai). */
const PHONE_INVALID_MSG = 'Số điện thoại không hợp lệ';
const PICKUP_LABEL = 'Đến lấy tại quán';
const DELIVERY_LABEL = 'Giao tận nơi';

/** Quá ngưỡng này thì gấp phần còn lại thành "+N món khác" — card giữ chiều cao đều
 * nhau, khách muốn xem đủ thì bấm vào đơn (trang /o/:token có danh sách đầy). */
const MAX_ITEM_ROWS = 3;

function isLikelyPhone(raw: string): boolean {
  return raw.replace(/\D/g, '').length >= 9;
}

const dateFmt = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' });

function formatSubmittedAt(ms: number): string {
  const d = new Date(ms);
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
}

/** Màu chip theo stage. Chữ trong chip là `stage_label` từ BE — hàm này CHỈ lo màu. */
function chipPalette(entry: PublicOrderHistoryEntry): { bg: string; text: string } {
  if (entry.status === 'CANCELLED_BY_CUSTOMER') {
    // Khách tự huỷ là kết cục trung tính, không phải lỗi — không dùng đỏ như quán từ chối.
    return { bg: 'var(--bg-sunken)', text: 'var(--text-muted)' };
  }
  switch (entry.stage) {
    case 'RECEIVED':
      return { bg: 'var(--warn-100)', text: 'var(--warn-600)' };
    case 'COMPLETED':
      return { bg: 'var(--ok-100)', text: 'var(--ok-600)' };
    case 'REJECTED':
      return { bg: 'var(--danger-100)', text: 'var(--danger-600)' };
    default:
      // Các mốc đang chạy: đã xác nhận / đang nấu / chờ giao / đang giao / sẵn sàng lấy.
      return { bg: 'var(--info-100)', text: 'var(--info-600)' };
  }
}

export function HistoryPage(): JSX.Element {
  // Mồi ô nhập: SĐT tra thành công lần trước > SĐT checkout gần nhất > rỗng.
  const [phone, setPhone] = useState<string>(
    () => readLookupPhone() ?? readLastCustomer()?.customer_phone ?? '',
  );
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [history, setHistory] = useState<PublicOrderHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Đánh số lần gọi để bỏ response cũ về muộn (khách sửa số rồi bấm tra lại khi request
  // trước chưa xong) — `postJson` không có AbortController như `useApi`.
  const seqRef = useRef(0);

  async function lookup(raw: string): Promise<void> {
    if (!isLikelyPhone(raw)) {
      setFieldError(PHONE_INVALID_MSG);
      return;
    }
    const seq = ++seqRef.current;
    setFieldError(null);
    setLoading(true);
    setError(null);

    const result = await postJson('/api/public/orders/lookup', { phone: raw }, PublicOrderHistory);
    if (seq !== seqRef.current) return;
    setLoading(false);

    if ('error' in result) {
      setError(result.error);
      return;
    }
    setHistory(result.data);
    // Nhớ bản BE đã chuẩn hoá (phone.ts) — không phải chuỗi khách gõ.
    saveLookupPhone(result.data.phone);
    setPhone(result.data.phone);
  }

  // Có số mồi hợp lệ thì tra luôn, khách khỏi bấm — đây chính là giá trị của việc nhớ SĐT.
  // Ref guard: StrictMode dev mount 2 lần, không bắn 2 request trùng.
  const didAutoLookup = useRef(false);
  useEffect(() => {
    if (didAutoLookup.current) return;
    didAutoLookup.current = true;
    if (phone && isLikelyPhone(phone)) void lookup(phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    void lookup(phone);
  }

  return (
    <div style={page}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{HISTORY_CSS}</style>

      <header style={pageHead}>
        <h1 style={heading}>Đơn của tôi</h1>
        <p style={subheading}>Tra cứu các đơn đã đặt bằng số điện thoại</p>
      </header>

      <form style={lookupCard} onSubmit={onSubmit}>
        <label style={fieldLabel} htmlFor="history-phone">
          Số điện thoại đã dùng đặt hàng
        </label>
        <div style={lookupRow}>
          <input
            id="history-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="VD: 0912 345 678"
            value={phone}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setPhone(e.target.value);
              setFieldError(null);
            }}
            style={{ ...inputBase, ...(fieldError ? inputErrorBorder : {}) }}
          />
          <button type="submit" style={lookupButton} disabled={loading}>
            {loading ? 'Đang tra…' : 'Tra cứu'}
          </button>
        </div>
        {fieldError && <p style={errorText}>{fieldError}</p>}
      </form>

      {error && (
        <BannerNotice
          tone="danger"
          title={error.message}
          action={{ label: 'Thử lại', onClick: () => void lookup(phone) }}
        />
      )}

      {loading && <SkeletonCards />}

      {!loading && history && (
        <section style={resultBlock} aria-live="polite">
          {history.orders.length === 0 ? (
            <div style={emptyBlock}>
              <span style={emptyIcon} aria-hidden="true">
                🍲
              </span>
              <p style={emptyText}>
                Chưa tìm thấy đơn nào của số <span style={monoPhone}>{history.phone}</span>.
              </p>
              <Link to="/" style={ctaButton}>
                Xem menu và đặt món
              </Link>
            </div>
          ) : (
            <>
              <p style={resultSummary}>
                {history.orders.length} đơn của số <span style={monoPhone}>{history.phone}</span>
              </p>
              <ul style={orderList}>
                {history.orders.map((entry) => (
                  <OrderCard key={entry.order_token} entry={entry} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <Link to="/" data-testid="history-back-link" style={backLink}>
        ← Về trang menu
      </Link>
    </div>
  );
}

function OrderCard({ entry }: { entry: PublicOrderHistoryEntry }): JSX.Element {
  const palette = chipPalette(entry);
  const shown = entry.items.slice(0, MAX_ITEM_ROWS);
  const hiddenCount = entry.items.length - shown.length;
  // Đơn bị từ chối / huỷ trước khi duyệt có thể không còn dòng món và subtotal = 0 —
  // hiện "—" với "0đ" trông như lỗi render. Thay bằng một dòng mời xem chi tiết, giấu 0đ.
  const hasItems = entry.items.length > 0;

  return (
    <li>
      {/* Cả card là MỘT vùng bấm (≥ tap-min) mở trang theo dõi đơn — trên mobile không bắt
          khách nhắm vào một nút nhỏ. Mũi tên › chỉ là dấu hiệu "bấm được", không phải nút riêng. */}
      <Link to={`/o/${entry.order_token}`} className="shop-history-card" style={cardLink}>
        <div style={cardMain}>
          <div style={cardTopRow}>
            <span style={cardDate}>{formatSubmittedAt(entry.submitted_at_ms)}</span>
            <span style={{ ...statusChip, background: palette.bg, color: palette.text }}>
              {entry.stage_label}
            </span>
          </div>

          {hasItems ? (
            <ul style={itemList}>
              {shown.map((it, idx) => (
                <li key={idx} style={itemRow}>
                  <span style={itemName}>{it.name}</span>
                  <span style={itemQty}>×{it.qty}</span>
                </li>
              ))}
              {hiddenCount > 0 && (
                <li style={itemMore}>+{hiddenCount} món khác</li>
              )}
            </ul>
          ) : (
            <p style={cardNoItems}>Bấm để xem chi tiết đơn</p>
          )}

          <div style={cardBottomRow}>
            <span style={cardFulfillment}>
              <span aria-hidden="true">{entry.fulfillment_type === 'PICKUP' ? '🏪' : '🛵'}</span>
              {entry.fulfillment_type === 'PICKUP' ? PICKUP_LABEL : DELIVERY_LABEL}
            </span>
            {(hasItems || entry.subtotal > 0) && (
              <span style={cardTotal}>{formatVnd(entry.subtotal)}</span>
            )}
          </div>
        </div>
        <span style={chevron} aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}

function SkeletonCards(): JSX.Element {
  return (
    <div style={skeletonWrap} aria-hidden="true">
      <div className="shop-history-skel" style={skeletonCard} />
      <div className="shop-history-skel" style={skeletonCard} />
      <div className="shop-history-skel" style={skeletonCard} />
    </div>
  );
}

/* Hover "nổi lên" dùng đúng --shadow-lift (tokens.css khai báo riêng cho hover card).
 * Phải là CSS thật vì inline style không có :hover; skeleton pulse gộp chung một block. */
const HISTORY_CSS = `
.shop-history-card {
  transition:
    box-shadow var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}
.shop-history-card:hover {
  box-shadow: var(--shadow-lift);
  transform: translateY(-2px);
  border-color: var(--border-default);
}
.shop-history-skel { animation: shop-history-pulse 1.1s ease-in-out infinite; }
@keyframes shop-history-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) {
  .shop-history-card { transition: none; }
  .shop-history-card:hover { transform: none; }
  .shop-history-skel { animation: none; }
}
`;

/* Cột hẹp 640px thay vì --content-max 1200px: đây là danh sách DỌC một cột — trải hết
 * 1200px thì dòng món và khoảng giữa ngày/chip dãn tới mức mắt phải quét ngang cả màn. */
const page: CSSProperties = {
  maxWidth: '640px',
  margin: '0 auto',
  padding: `var(--sp-6) var(--gutter) var(--sp-8)`,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
};

const pageHead: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-xl)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  letterSpacing: 'var(--ls-tight)',
  color: 'var(--text-strong)',
};

const subheading: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const lookupCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
};

const fieldLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const lookupRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
};

// fontSize 16px BẮT BUỘC cho input (tokens.css: dưới 16px Safari iOS tự zoom khi focus).
const inputBase: CSSProperties = {
  flex: 1,
  minWidth: 0,
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-input)',
  background: 'var(--bg-sunken)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-base)',
  boxSizing: 'border-box',
};

const inputErrorBorder: CSSProperties = {
  border: '1px solid var(--danger-600)',
};

const errorText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--danger-600)',
};

// Cùng idiom nút chính của StickyCta: IN HOA + giãn chữ rộng trên nền --brand-600.
const lookupButton: CSSProperties = {
  flexShrink: 0,
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-5)',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textTransform: 'uppercase',
  letterSpacing: 'var(--ls-wide)',
  cursor: 'pointer',
};

const resultBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const resultSummary: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const monoPhone: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-strong)',
};

const orderList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const cardLink: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  textDecoration: 'none',
};

const cardMain: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const cardTopRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--sp-3)',
};

const cardDate: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const statusChip: CSSProperties = {
  flexShrink: 0,
  padding: 'var(--sp-1) var(--sp-3)',
  borderRadius: 'var(--r-badge)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  whiteSpace: 'nowrap',
};

/* Từng món một dòng, ×qty ghim mép phải — thay chuỗi "A ×1 · B ×2 · …" cũ bị cắt
 * ellipsis ngay từ món thứ hai. */
const itemList: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

const itemRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 'var(--sp-3)',
};

const itemName: CSSProperties = {
  minWidth: 0,
  fontSize: 'var(--fs-base)',
  lineHeight: 'var(--lh-snug)',
  color: 'var(--text-strong)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const itemQty: CSSProperties = {
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const itemMore: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const cardNoItems: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  fontStyle: 'italic',
  color: 'var(--text-muted)',
};

/* Kẻ đứt phía trên hàng tổng — nhịp "hoá đơn giấy" cho hợp quán ăn. */
const cardBottomRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 'var(--sp-3)',
  paddingTop: 'var(--sp-2)',
  borderTop: '1px dashed var(--border-default)',
};

const cardFulfillment: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--wood-700)',
};

const cardTotal: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-price-sm)',
};

const chevron: CSSProperties = {
  flexShrink: 0,
  fontSize: 'var(--fs-xl)',
  color: 'var(--text-faint)',
  lineHeight: 1,
};

const emptyBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-8) var(--pad-card)',
  textAlign: 'center',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
};

const emptyIcon: CSSProperties = {
  fontSize: 'var(--fs-3xl)',
  lineHeight: 1,
};

const emptyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

const ctaButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-6)',
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

const skeletonCard: CSSProperties = {
  height: 'var(--sp-16)',
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

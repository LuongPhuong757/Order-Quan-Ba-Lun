import { useState, type ChangeEvent, type CSSProperties, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { formatVnd, readCartNote, saveCartNote, useCart, type CartLine } from '../lib/cart-store.ts';
import { ImagePlaceholder } from '../components/ImagePlaceholder.tsx';
import { Stepper } from '../components/Stepper.tsx';
import { StickyCta } from '../components/StickyCta.tsx';

/**
 * `/cart` — bước 1 "Giỏ hàng" của luồng đặt hàng (P08.D-04 lưu localStorage chỉ
 * {menu_item_id, qty, note}, P08.D-46 stepper 2 bước — 2 quyết định gốc từ phase 07,
 * giữ lại ở đây theo lịch sử, không xoá).
 *
 * D-07: món hết hàng GIỮ dòng (không im lặng xoá), làm mờ, và CHẶN nút chuyển bước tới
 * khi khách tự xoá — quy tắc "khách không bao giờ bất ngờ ở bước cuối".
 * D-19: card "Nhận hàng" (PICKUP/DELIVERY) chuyển hẳn sang bước 2 `/checkout`, nên dòng
 * "Phí giao hàng" ở đây chỉ ghi copy hẹn bước sau, không tự đoán số tiền.
 *
 * Giảm số lượng về 0 xoá dòng NGAY, không hộp xác nhận (UI-SPEC: "Destructive
 * confirmation: không có" — dữ liệu chưa gửi server, thêm lại được ngay lập tức).
 */
export function CartPage(): JSX.Element {
  const { lines, subtotal, count, setQty } = useCart();
  const [note, setNote] = useState<string>(() => readCartNote());

  const hasUnavailable = lines.some((l) => l.unavailable);
  const isEmpty = count === 0;

  const handleNoteChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value;
    setNote(value);
    saveCartNote(value);
  };

  return (
    <div style={isEmpty ? { ...page, ...pageEmpty } : page}>
      <Stepper current={1} />

      <div style={headerRow}>
        <h1 style={heading}>GIỎ HÀNG CỦA BẠN ({count} món)</h1>
        <Link to="/" data-testid="cart-back-link" style={addMoreLink}>
          + THÊM MÓN
        </Link>
      </div>

      {isEmpty ? (
        <EmptyCart />
      ) : (
        <>
          <ul style={list}>
            {lines.map((line) => (
              <CartLineRow key={line.menu_item_id} line={line} onSetQty={setQty} />
            ))}
          </ul>

          <div style={noteBlock}>
            <label style={noteLabel} htmlFor="cart-note">
              Ghi chú đơn hàng
            </label>
            <textarea
              id="cart-note"
              value={note}
              onChange={handleNoteChange}
              maxLength={500}
              placeholder="Ví dụ: ít cay, giao giờ trưa..."
              style={noteInput}
              rows={2}
            />
            {note.length > 400 && (
              <p style={noteCounter}>Còn {500 - note.length} ký tự</p>
            )}
          </div>

          <div style={summaryCard}>
            <div style={summaryRow}>
              <span style={summaryLabel}>Tạm tính</span>
              <span style={summaryValue}>{formatVnd(subtotal)}</span>
            </div>
            <div style={summaryRow}>
              <span style={summaryLabel}>Phí giao hàng</span>
              <span style={shipHint}>Chọn phương thức nhận hàng ở bước sau để xem phí ship</span>
            </div>
            <div style={summaryRowTotal}>
              <span style={totalLabel}>Tổng cộng</span>
              <span style={totalValue}>{formatVnd(subtotal)}</span>
            </div>
          </div>

          <StickyCta
            label="TIẾP TỤC"
            to="/checkout"
            disabled={hasUnavailable}
            hint={hasUnavailable ? 'Vui lòng xoá món đã hết trước khi tiếp tục' : undefined}
          />
        </>
      )}
    </div>
  );
}

function CartLineRow({
  line,
  onSetQty,
}: {
  line: CartLine;
  onSetQty: (menu_item_id: string, qty: number) => void;
}): JSX.Element {
  const isOut = Boolean(line.unavailable);
  const lineTotal = line.unit_price * line.qty;

  return (
    <li style={row}>
      <div style={thumbWrap}>
        {line.image ? (
          <img src={line.image} alt={line.name} style={isOut ? { ...thumbImg, ...dimmed } : thumbImg} />
        ) : (
          <div style={isOut ? { ...thumbPlaceholder, ...dimmed } : thumbPlaceholder}>
            <ImagePlaceholder name={line.name} />
          </div>
        )}
      </div>

      <div style={isOut ? { ...rowBody, ...dimmed } : rowBody}>
        <div style={rowTop}>
          <span style={rowName}>{line.name}</span>
          {isOut && <span style={outOfStockChip}>Hết hàng</span>}
        </div>
        <span style={unitPrice}>{formatVnd(line.unit_price)}</span>
      </div>

      <div style={rowRight}>
        <div style={qtyStepper}>
          <button
            type="button"
            aria-label={`Giảm số lượng ${line.name}`}
            style={isOut ? { ...qtyButton, ...qtyButtonDisabled } : qtyButton}
            disabled={isOut}
            onClick={() => onSetQty(line.menu_item_id, line.qty - 1)}
          >
            −
          </button>
          <span style={qtyValue}>{line.qty}</span>
          <button
            type="button"
            aria-label={`Tăng số lượng ${line.name}`}
            style={isOut ? { ...qtyButton, ...qtyButtonDisabled } : qtyButton}
            disabled={isOut}
            aria-disabled={isOut}
            onClick={() => onSetQty(line.menu_item_id, line.qty + 1)}
          >
            +
          </button>
        </div>
        <span style={lineTotalStyle}>{isOut ? '—' : formatVnd(lineTotal)}</span>
        {isOut && (
          <button
            type="button"
            style={removeButton}
            onClick={() => onSetQty(line.menu_item_id, 0)}
          >
            Xoá món này
          </button>
        )}
      </div>
    </li>
  );
}

function EmptyCart(): JSX.Element {
  return (
    <div style={emptyWrap}>
      <EmptyCartGlyph />
      <h2 style={emptyHeading}>Giỏ hàng đang trống</h2>
      <p style={emptyBody}>Xem menu và thêm món bạn thích nhé</p>
      <Link to="/" style={emptyCta}>
        Xem menu
      </Link>
    </div>
  );
}

function EmptyCartGlyph(): JSX.Element {
  return (
    <svg
      width={120}
      height={96}
      viewBox="0 0 120 96"
      fill="none"
      aria-hidden="true"
      style={emptyGlyph}
    >
      <ellipse cx="60" cy="86" rx="40" ry="6" fill="var(--wood-100)" />
      <rect x="24" y="30" width="72" height="46" rx="10" fill="var(--brand-100)" />
      <path
        d="M24 44h72M40 30v-4a20 20 0 0 1 40 0v4"
        stroke="var(--wood-500)"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx="46" cy="60" r="4" fill="var(--brand-500)" />
      <circle cx="74" cy="60" r="4" fill="var(--brand-500)" />
    </svg>
  );
}

const page: CSSProperties = {
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  padding: `var(--sp-4) var(--gutter)`,
  paddingBottom: 'calc(var(--sticky-cta-h) + var(--safe-bottom) + var(--sp-4))',
};

const pageEmpty: CSSProperties = {
  paddingBottom: 'var(--sp-4)',
};

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  marginBottom: 'var(--sp-4)',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const addMoreLink: CSSProperties = {
  flexShrink: 0,
  color: 'var(--brand-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

const list: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
};

const row: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-3)',
  paddingBottom: 'var(--sp-4)',
  borderBottom: '1px solid var(--border-subtle)',
};

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

// Áp cho ảnh/placeholder + nội dung dòng khi hết hàng (D-07) — chip "Hết hàng" và
// nút "Xoá món này" nằm ngoài style này nên luôn giữ opacity 1, luôn đọc/bấm được.
const dimmed: CSSProperties = {
  opacity: 'var(--opacity-out-of-stock)',
};

const rowBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  flex: 1,
  minWidth: 0,
};

const rowTop: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
};

const rowName: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const outOfStockChip: CSSProperties = {
  flexShrink: 0,
  opacity: 1,
  background: 'var(--danger-100)',
  color: 'var(--danger-600)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  padding: '0 var(--sp-2)',
  borderRadius: 'var(--r-badge)',
  whiteSpace: 'nowrap',
};

const unitPrice: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-price-sm)',
};

const rowRight: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
  flexShrink: 0,
};

const qtyStepper: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
};

const qtyButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontSize: 'var(--fs-lg)',
  cursor: 'pointer',
};

const qtyButtonDisabled: CSSProperties = {
  opacity: 'var(--opacity-disabled)',
  cursor: 'not-allowed',
};

const qtyValue: CSSProperties = {
  minWidth: 'var(--sp-6)',
  textAlign: 'center',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const lineTotalStyle: CSSProperties = {
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const removeButton: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  border: '1px solid var(--danger-600)',
  borderRadius: 'var(--r-button)',
  background: 'transparent',
  color: 'var(--danger-600)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const noteBlock: CSSProperties = {
  marginTop: 'var(--sp-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
};

const noteLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const noteInput: CSSProperties = {
  border: 'none',
  borderBottom: '1px solid var(--border-default)',
  background: 'transparent',
  padding: 'var(--sp-2) 0',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-strong)',
  resize: 'none',
};

const noteCounter: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  textAlign: 'right',
};

const summaryCard: CSSProperties = {
  marginTop: 'var(--sp-6)',
  padding: 'var(--pad-card)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const summaryRow: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

const summaryLabel: CSSProperties = {
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
  flexShrink: 0,
};

const summaryValue: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const shipHint: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
  textAlign: 'right',
};

const summaryRowTotal: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 'var(--sp-3)',
  borderTop: '1px solid var(--border-subtle)',
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

const emptyWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-12) var(--sp-4)',
};

const emptyGlyph: CSSProperties = {
  marginBottom: 'var(--sp-2)',
};

const emptyHeading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  color: 'var(--text-strong)',
};

const emptyBody: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

const emptyCta: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-6)',
  marginTop: 'var(--sp-2)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textDecoration: 'none',
};

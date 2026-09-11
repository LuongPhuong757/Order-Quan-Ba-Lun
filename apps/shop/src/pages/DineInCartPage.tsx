import { useState, type CSSProperties, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DineInCartCreateResult } from '@order/schemas';
import { postJson, type ApiError } from '../lib/use-api.ts';
import { formatVnd, MAX_ITEM_NOTE_LEN } from '../lib/cart-store.ts';
import { saveRememberedCode, useDineInCart } from '../lib/dine-in-cart-store.ts';
import { getOrCreateCustomerToken } from '../lib/customer-token.ts';
import { QtyInput } from '../components/QtyInput.tsx';
import { BannerNotice } from '../components/BannerNotice.tsx';

/**
 * Giỏ món của khách ngồi bàn, và chỗ bấm **"Sinh mã"** (M4.D-05).
 *
 * ── MÃ CHỈ SINH KHI BẤM NÚT, KHÔNG SINH LÚC CHỌN MÓN (M4.D-03) ──
 * Trước lúc bấm, giỏ nằm HOÀN TOÀN ở `localStorage` — server không biết gì. Nhờ vậy khách xem
 * menu rồi bỏ đi không để lại gì phải dọn: không hàng chờ, không giỏ rác, không bảng phình.
 * Đây cũng là lý do mã chỉ cần sống 15 phút: lúc nó ra đời thì nhân viên đã ở cạnh bàn.
 *
 * Khách sửa giỏ tự do ở trang này — thêm, bớt, ghi chú — mà không tốn một request nào.
 */
export function DineInCartPage(): JSX.Element {
  const cart = useDineInCart();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const hasUnavailable = cart.lines.some((l) => l.unavailable);

  const handleCreateCode = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    // Dòng `unavailable` KHÔNG gửi lên: BE sẽ từ chối cả giỏ vì món hết (`create-cart.ts`), và
    // khách thì không sửa được gì ngoài việc bỏ dòng đó ra. Bỏ giúp họ, nhưng dòng vẫn HIỆN
    // trên màn (xem `syncCartWithMenu`) để họ biết món nào vừa hết.
    const items = cart.lines
      .filter((l) => !l.unavailable)
      .map((l) => ({
        menu_item_id: l.menu_item_id,
        qty: l.qty,
        ...(l.note ? { note: l.note } : {}),
      }));

    const res = await postJson(
      '/api/public/dine-in-carts',
      { customer_token: getOrCreateCustomerToken(), items },
      DineInCartCreateResult,
    );
    setSubmitting(false);

    if ('error' in res) {
      setError(res.error);
      return;
    }

    // Nhớ mã để khách đóng tab mở lại vẫn đọc được (M4.D-08).
    saveRememberedCode({ code: res.data.code, expires_at: res.data.expires_at });
    navigate(`/tai-ban/ma/${res.data.code}`, { replace: true });
  };

  if (cart.lines.length === 0) {
    return (
      <div style={wrap}>
        <p style={emptyText}>Bạn chưa chọn món nào.</p>
        <Link to="/tai-ban" style={secondaryCta}>
          Xem menu
        </Link>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h1 style={heading}>Món bạn đã chọn</h1>

      {error && (
        <BannerNotice
          tone="danger"
          title="Chưa tạo được mã"
          body={error.message}
          action={{ label: 'Đóng', onClick: () => setError(null) }}
        />
      )}

      {hasUnavailable && (
        <BannerNotice
          tone="warn"
          title="Có món vừa hết"
          body="Món được đánh dấu bên dưới quán vừa hết. Bạn bỏ món đó ra rồi tạo mã nhé — các món còn lại vẫn gọi được."
        />
      )}

      <ul style={list}>
        {cart.lines.map((line) => (
          <li key={line.menu_item_id} style={line.unavailable ? { ...row, ...rowOut } : row}>
            <div style={rowTop}>
              <div style={rowInfo}>
                <p style={name}>{line.name}</p>
                {line.unavailable ? (
                  <p style={outNote}>Quán vừa hết món này</p>
                ) : (
                  <p style={price}>
                    {formatVnd(line.unit_price)} × {line.qty} ={' '}
                    <strong>{formatVnd(line.unit_price * line.qty)}</strong>
                  </p>
                )}
              </div>
              <QtyInput
                value={line.qty}
                onCommit={(qty) => cart.setQty(line.menu_item_id, qty)}
                label={`Số lượng ${line.name}`}
              />
            </div>

            {/* Ghi chú từng món (M4.D-10) — "ít cay", "không hành". Đây là thứ khách hay phải
                nói miệng với nhân viên nhất, nên nó phải nằm ngay dòng món. */}
            <input
              type="text"
              value={line.note ?? ''}
              onChange={(e) => cart.setNote(line.menu_item_id, e.target.value)}
              maxLength={MAX_ITEM_NOTE_LEN}
              placeholder="Ghi chú (ít cay, không hành…)"
              aria-label={`Ghi chú cho ${line.name}`}
              style={noteInput}
            />

            <button
              type="button"
              onClick={() => cart.setQty(line.menu_item_id, 0)}
              style={removeButton}
            >
              Bỏ món này
            </button>
          </li>
        ))}
      </ul>

      <div style={totalRow}>
        <span>Tổng cộng</span>
        <strong style={totalValue}>{formatVnd(cart.subtotal)}</strong>
      </div>

      <Link to="/tai-ban" style={secondaryCta}>
        ＋ Chọn thêm món
      </Link>

      <div style={stickyBar}>
        <button
          type="button"
          onClick={handleCreateCode}
          disabled={submitting || cart.count === 0}
          style={submitting || cart.count === 0 ? { ...primaryCta, ...ctaDisabled } : primaryCta}
        >
          {submitting ? 'Đang tạo mã…' : 'Sinh mã cho nhân viên'}
        </button>
        <p style={ctaHint}>
          Bấm khi nhân viên đã ở bàn — mã chỉ có hiệu lực 15 phút.
        </p>
      </div>
    </div>
  );
}

const wrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-4)',
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
};

const heading: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-lg)',
  fontFamily: 'var(--font-display)',
};

const list: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const row: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
};

const rowOut: CSSProperties = {
  borderColor: 'var(--warn-600)',
  background: 'var(--warn-100)',
};

const rowTop: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

const rowInfo: CSSProperties = { minWidth: 0 };

const name: CSSProperties = {
  margin: 0,
  fontWeight: 600,
  fontSize: 'var(--fs-md)',
  // Tên món dài phải xuống dòng, không được tràn ngang đẩy stepper ra khỏi màn.
  overflowWrap: 'anywhere',
};

const price: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const outNote: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--warn-600)',
  fontWeight: 600,
};

const noteInput: CSSProperties = {
  width: '100%',
  padding: 'var(--sp-2)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  color: 'var(--text-strong)',
  background: 'var(--bg-page)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-input)',
  minHeight: 'var(--tap-min)',
};

const removeButton: CSSProperties = {
  alignSelf: 'flex-start',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-2)',
  background: 'none',
  border: 'none',
  color: 'var(--danger-600)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const totalRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--sp-3)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  fontSize: 'var(--fs-md)',
};

const totalValue: CSSProperties = { fontSize: 'var(--fs-lg)', color: 'var(--text-price)' };

const secondaryCta: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  borderRadius: 'var(--r-button)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  fontWeight: 600,
  textDecoration: 'none',
};

const stickyBar: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
  padding: 'var(--sp-3) 0',
  paddingBottom: 'calc(var(--sp-3) + env(safe-area-inset-bottom, 0px))',
  background: 'var(--bg-page)',
};

const primaryCta: CSSProperties = {
  minHeight: 52,
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-md)',
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const ctaDisabled: CSSProperties = {
  background: 'var(--disabled-600)',
  color: 'var(--text-on-disabled)',
  cursor: 'not-allowed',
};

const ctaHint: CSSProperties = {
  margin: 0,
  textAlign: 'center',
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const emptyText: CSSProperties = { margin: 0, color: 'var(--text-muted)' };

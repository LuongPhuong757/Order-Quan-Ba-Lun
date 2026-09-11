import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { z } from 'zod';
import { DineInCartCreateResult, PublicDineInCartStatus } from '@order/schemas';
import { deleteJson, postJson, type ApiError } from '../lib/use-api.ts';
import { formatVnd, MAX_ITEM_NOTE_LEN, type CartLine } from '../lib/cart-store.ts';
import {
  clearDineInCart,
  clearRememberedCode,
  saveRememberedCode,
} from '../lib/dine-in-cart-store.ts';
import { getOrCreateCustomerToken } from '../lib/customer-token.ts';

/**
 * Hai lớp phủ của luồng gọi món tại bàn, sống TRÊN quyển menu (`/thuc-don`).
 *
 * ── VÌ SAO LÀ LỚP PHỦ, KHÔNG PHẢI TRANG RIÊNG ─────────────────────────────────────────
 * Quyển menu được phục vụ ở HAI nơi: `/thuc-don` trên tên miền chính (có router) và toàn
 * bộ `menu.<domain>` (KHÔNG có router — `main.tsx` render thẳng `MenuBookPage`, cố ý bỏ
 * `BrowserRouter` để trang không có đường nào đi sang màn đặt hàng).
 *
 * Nếu giỏ và mã là hai route thì chúng chỉ chạy ở một trong hai nơi, và mã QR dán trong
 * quán trỏ vào nơi nào cũng sai một nửa. Lớp phủ thì không cần router, nên cùng một luồng
 * chạy giống nhau ở cả hai địa chỉ.
 *
 * Cả hai dùng bảng màu `--menu-*` (nền tối) của quyển menu, không phải token của trang đặt
 * hàng online.
 */

const CancelResult = z.object({ cancelled: z.boolean() });

// ── Lớp phủ GIỎ ───────────────────────────────────────────────────────────────────────

type CartSheetProps = {
  lines: CartLine[];
  subtotal: number;
  count: number;
  onSetQty: (menu_item_id: string, qty: number) => void;
  onSetNote: (menu_item_id: string, note: string) => void;
  onClose: () => void;
  /** Sinh mã xong → mở lớp phủ mã. */
  onCodeCreated: (code: string, expiresAt: number) => void;
};

export function DineInCartSheet({
  lines,
  subtotal,
  count,
  onSetQty,
  onSetNote,
  onClose,
  onCodeCreated,
}: CartSheetProps): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const hasUnavailable = lines.some((l) => l.unavailable);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const createCode = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    // Dòng `unavailable` KHÔNG gửi lên — BE sẽ từ chối cả giỏ vì món hết. Bỏ giúp khách,
    // nhưng dòng vẫn HIỆN trên lớp phủ để họ biết món nào vừa hết.
    const items = lines
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
    saveRememberedCode({ code: res.data.code, expires_at: res.data.expires_at });
    onCodeCreated(res.data.code, res.data.expires_at);
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Món bạn đã chọn">
      <div style={sheet}>
        <div style={sheetHead}>
          <p style={sheetTitle}>Món bạn đã chọn</p>
          <button type="button" onClick={onClose} aria-label="Đóng" style={closeBtn}>
            ✕
          </button>
        </div>

        {error && <p style={errorBox}>{error.message}</p>}
        {hasUnavailable && (
          <p style={warnBox}>
            Món đánh dấu bên dưới quán vừa hết. Bạn bỏ món đó ra rồi tạo mã nhé — các món còn
            lại vẫn gọi được.
          </p>
        )}

        <div style={sheetBody}>
          {lines.map((line) => (
            <div key={line.menu_item_id} style={line.unavailable ? { ...cartRow, ...rowOut } : cartRow}>
              <div style={cartRowTop}>
                <div style={{ minWidth: 0 }}>
                  <p style={cartName}>{line.name}</p>
                  {line.unavailable ? (
                    <p style={outText}>Quán vừa hết món này</p>
                  ) : (
                    <p style={cartPrice}>
                      {formatVnd(line.unit_price)} × {line.qty} ={' '}
                      <strong>{formatVnd(line.unit_price * line.qty)}</strong>
                    </p>
                  )}
                </div>
                <div style={stepper}>
                  <button
                    type="button"
                    onClick={() => onSetQty(line.menu_item_id, line.qty - 1)}
                    aria-label={line.qty === 1 ? `Bỏ ${line.name}` : `Giảm ${line.name}`}
                    style={stepBtn}
                  >
                    −
                  </button>
                  <span aria-hidden="true" style={qtyText}>
                    {line.qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSetQty(line.menu_item_id, line.qty + 1)}
                    aria-label={`Tăng ${line.name}`}
                    style={stepBtn}
                    disabled={line.unavailable}
                  >
                    +
                  </button>
                </div>
              </div>

              <input
                type="text"
                value={line.note ?? ''}
                onChange={(e) => onSetNote(line.menu_item_id, e.target.value)}
                maxLength={MAX_ITEM_NOTE_LEN}
                placeholder="Ghi chú (ít cay, không hành…)"
                aria-label={`Ghi chú cho ${line.name}`}
                style={noteInput}
              />
            </div>
          ))}
        </div>

        <div style={sheetFoot}>
          <div style={totalRow}>
            <span>Tổng cộng</span>
            <strong style={totalValue}>{formatVnd(subtotal)}</strong>
          </div>
          <button
            type="button"
            onClick={() => void createCode()}
            disabled={submitting || count === 0}
            style={submitting || count === 0 ? { ...primaryBtn, ...disabledBtn } : primaryBtn}
          >
            {submitting ? 'Đang tạo mã…' : 'Sinh mã cho nhân viên'}
          </button>
          <p style={footHint}>Bấm khi nhân viên đã ở bàn — mã chỉ có hiệu lực 15 phút.</p>
        </div>
      </div>
    </div>
  );
}

// ── Lớp phủ MÃ (kiểu ô OTP) ───────────────────────────────────────────────────────────

type CodeSheetProps = {
  code: string;
  expiresAt: number;
  /** Đóng lớp phủ. KHÔNG huỷ mã — khách còn quay lại xem mã được. */
  onClose: () => void;
  /** Khách bấm "Sửa lại" → mã đã huỷ, mở lại lớp phủ giỏ. */
  onEdit: () => void;
};

/** Nhịp hỏi lại trạng thái mã. 5 giây là đủ để khách thấy "đã nhận" gần như ngay lúc nhân
 * viên bấm, mà cả vòng đời 15 phút của mã cũng chỉ ~180 request bé. */
const POLL_MS = 5_000;

export function DineInCodeSheet({ code, expiresAt, onClose, onEdit }: CodeSheetProps): JSX.Element {
  const [state, setState] = useState<'ACTIVE' | 'USED' | 'CANCELLED' | 'EXPIRED'>('ACTIVE');
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Hỏi lại trạng thái trong lúc mã còn sống. Mã chết rồi thì dừng — không còn gì đổi.
  useEffect(() => {
    if (state !== 'ACTIVE') return;
    let stop = false;
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch(`/api/public/dine-in-carts/${code}`, {
          headers: { Accept: 'application/json' },
        });
        if (!r.ok || stop) return;
        const j: unknown = await r.json();
        const parsed = PublicDineInCartStatus.safeParse((j as { data?: unknown }).data);
        if (parsed.success && !stop) setState(parsed.data.state);
      } catch {
        // Mất mạng một nhịp thì bỏ qua — nhịp sau hỏi lại. Không hiện lỗi cho khách vì mã
        // trên màn vẫn đúng và vẫn đọc được cho nhân viên.
      }
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [state, code]);

  // Nhân viên đã nhận → dọn giỏ để lần sau khách bắt đầu sạch. Dọn ở ĐÂY chứ không lúc
  // sinh mã: dọn sớm mà mã hết hạn thì khách mất hết món đã chọn.
  useEffect(() => {
    if (state === 'USED') {
      clearDineInCart();
      clearRememberedCode();
    }
  }, [state]);

  const remainMs = Math.max(0, expiresAt - now);
  const reallyExpired = state === 'EXPIRED' || (state === 'ACTIVE' && remainMs === 0);

  const edit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await deleteJson(`/api/public/dine-in-carts/${code}`, CancelResult, {
      customer_token: getOrCreateCustomerToken(),
    });
    setBusy(false);
    if ('error' in res) {
      setError(res.error.message);
      return;
    }
    clearRememberedCode();
    onEdit();
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Mã gọi món">
      <div style={{ ...sheet, textAlign: 'center' }}>
        <div style={sheetHead}>
          <p style={sheetTitle}>Mã gọi món</p>
          <button type="button" onClick={onClose} aria-label="Đóng" style={closeBtn}>
            ✕
          </button>
        </div>

        {state === 'USED' ? (
          <div style={{ padding: 'var(--sp-5) var(--sp-4)' }}>
            <p style={doneTitle}>Nhân viên đã nhận món của bạn</p>
            <p style={doneBody}>
              Món đang được kiểm lại trước khi chuyển xuống bếp. Cần gọi thêm thì bạn chọn
              món tiếp rồi tạo mã mới nhé.
            </p>
            <button type="button" onClick={onClose} style={primaryBtn}>
              Xem tiếp menu
            </button>
          </div>
        ) : state === 'CANCELLED' || reallyExpired ? (
          <div style={{ padding: 'var(--sp-5) var(--sp-4)' }}>
            <p style={doneTitle}>{reallyExpired ? 'Mã đã hết hạn' : 'Mã đã được huỷ'}</p>
            <p style={doneBody}>
              Món bạn chọn vẫn còn trong giỏ. Bạn tạo mã mới giúp quán nhé.
            </p>
            <button type="button" onClick={onEdit} style={primaryBtn}>
              Tạo mã mới
            </button>
          </div>
        ) : (
          <div style={{ padding: 'var(--sp-5) var(--sp-4)' }}>
            <p style={codeLabel}>MÃ GỌI MÓN CỦA BẠN</p>

            {/* 5 ô rời — mã luôn đúng 5 chữ số (số cuối là số kiểm tra Luhn). Ô rời để đọc
                to từng số không bị nhầm nhịp trong quán ồn. */}
            <div style={boxRow} aria-label={`Mã gọi món ${code.split('').join(' ')}`}>
              {code.split('').map((d, i) => (
                <span key={i} style={digitBox}>
                  {d}
                </span>
              ))}
            </div>

            <p style={readAloud}>Đọc mã này cho nhân viên</p>
            <p style={countdownText}>Còn hiệu lực {fmtRemain(remainMs)}</p>

            {error && <p style={errorBox}>{error}</p>}

            <button
              type="button"
              onClick={() => void edit()}
              disabled={busy}
              style={busy ? { ...secondaryBtn, ...disabledBtn } : secondaryBtn}
            >
              {busy ? 'Đang huỷ mã…' : 'Sửa lại món'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** "2 phút 30 giây" thay vì "02:30" — khách đọc câu tiếng Việt nhanh hơn đọc đồng hồ. */
function fmtRemain(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const min = Math.floor(total / 60);
  const sec = total % 60;
  if (min === 0) return `${sec} giây`;
  if (sec === 0) return `${min} phút`;
  return `${min} phút ${sec} giây`;
}

// ── Style dùng chung (bảng màu --menu-*, nền tối của quyển menu) ───────────────────────

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--z-sheet)' as unknown as number,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.55)',
  // Lớp phủ nằm trên quyển menu đang có cử chỉ vuốt lật trang: chặn cuộn/vuốt xuyên qua.
  touchAction: 'none',
};

const sheet: CSSProperties = {
  width: '100%',
  maxWidth: 520,
  maxHeight: '92vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--menu-chrome)',
  color: 'var(--menu-text)',
  borderTopLeftRadius: 'var(--r-sheet)',
  borderTopRightRadius: 'var(--r-sheet)',
  border: '1px solid var(--menu-line)',
  // Thanh gạt dưới của iPhone che mất nút nếu không trừ vùng an toàn.
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  touchAction: 'auto',
};

const sheetHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--sp-4)',
  borderBottom: '1px solid var(--menu-line)',
};

const sheetTitle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-semibold)',
};

const closeBtn: CSSProperties = {
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  border: 'none',
  background: 'transparent',
  color: 'var(--menu-text-muted)',
  fontSize: 'var(--fs-md)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
};

const sheetBody: CSSProperties = {
  overflowY: 'auto',
  padding: 'var(--sp-3) var(--sp-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  textAlign: 'left',
};

const cartRow: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  paddingBottom: 'var(--sp-3)',
  borderBottom: '1px solid var(--menu-line)',
};

const rowOut: CSSProperties = { opacity: 0.65 };

const cartRowTop: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
};

const cartName: CSSProperties = {
  margin: 0,
  fontWeight: 'var(--fw-semibold)',
  // Tên món dài phải xuống dòng, không đẩy stepper ra khỏi màn.
  overflowWrap: 'anywhere',
};

const cartPrice: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

const outText: CSSProperties = {
  margin: '2px 0 0',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-danger)',
  fontWeight: 'var(--fw-semibold)',
};

const noteInput: CSSProperties = {
  width: '100%',
  padding: 'var(--sp-2)',
  // 16px trở lên: iOS Safari tự phóng to cả trang khi chạm vào ô nhập nhỏ hơn thế.
  fontSize: 16,
  fontFamily: 'inherit',
  color: 'var(--menu-text)',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid var(--menu-line)',
  borderRadius: 'var(--r-input)',
  minHeight: 'var(--tap-min)',
};

const stepper: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  padding: '2px',
  borderRadius: 999,
  border: '1px solid var(--menu-line)',
  flexShrink: 0,
};

const stepBtn: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: '50%',
  border: 'none',
  background: 'transparent',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-lg)',
  lineHeight: 1,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
};

const qtyText: CSSProperties = {
  minWidth: 18,
  textAlign: 'center',
  color: 'var(--menu-price)',
  fontWeight: 'var(--fw-semibold)',
  fontVariantNumeric: 'tabular-nums',
};

const sheetFoot: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--sp-4) var(--sp-4)',
  borderTop: '1px solid var(--menu-line)',
};

const totalRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 'var(--fs-md)',
};

const totalValue: CSSProperties = { fontSize: 'var(--fs-lg)', color: 'var(--menu-price)' };

const primaryBtn: CSSProperties = {
  minHeight: 52,
  width: '100%',
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--menu-price)',
  // Nền hổ phách sáng → chữ phải TỐI. Để chữ trắng là gần như không đọc được.
  color: '#2b1d08',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const secondaryBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-4)',
  borderRadius: 'var(--r-button)',
  border: '1px solid var(--menu-line)',
  background: 'transparent',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-md)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const disabledBtn: CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };

const errorBox: CSSProperties = {
  margin: 'var(--sp-3) var(--sp-4) 0',
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--r-input)',
  background: 'rgba(255,157,146,0.15)',
  color: 'var(--menu-danger)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  textAlign: 'left',
};

const warnBox: CSSProperties = {
  margin: 'var(--sp-3) var(--sp-4) 0',
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 'var(--r-input)',
  background: 'rgba(232,163,61,0.15)',
  color: 'var(--menu-price)',
  fontSize: 'var(--fs-sm)',
  textAlign: 'left',
};

const footHint: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-caption)',
  color: 'var(--menu-text-muted)',
  textAlign: 'center',
};

const codeLabel: CSSProperties = {
  margin: '0 0 var(--sp-3)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  letterSpacing: '0.08em',
  color: 'var(--menu-text-muted)',
};

const boxRow: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
  justifyContent: 'center',
  flexWrap: 'nowrap',
};

const digitBox: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 56,
  height: 68,
  // Máy 320px: ô co lại chứ không đẩy nhau ra ngoài màn.
  minWidth: 0,
  flexShrink: 1,
  background: 'rgba(255,255,255,0.06)',
  border: '2px solid var(--menu-line)',
  borderRadius: 'var(--r-card)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-3xl)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--menu-text)',
  // Không cho chọn/copy: tránh khách bấm giữ ra menu copy giữa lúc đang đọc số.
  userSelect: 'none',
};

const readAloud: CSSProperties = {
  margin: 'var(--sp-3) 0 0',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-semibold)',
};

const countdownText: CSSProperties = {
  margin: '4px 0 var(--sp-4)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

const doneTitle: CSSProperties = {
  margin: '0 0 var(--sp-2)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-semibold)',
};

const doneBody: CSSProperties = {
  margin: '0 0 var(--sp-4)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

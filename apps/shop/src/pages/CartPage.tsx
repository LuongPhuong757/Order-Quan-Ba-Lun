import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  MAX_ITEM_NOTE_LEN,
  formatVnd,
  readCartNote,
  saveCartNote,
  useCart,
  type CartLine,
} from '../lib/cart-store.ts';
import { ImagePlaceholder } from '../components/ImagePlaceholder.tsx';
import { FadeInImage } from '../components/FadeInImage.tsx';
import { Stepper } from '../components/Stepper.tsx';
import { StickyCta } from '../components/StickyCta.tsx';
import { useCountUp } from '../lib/use-count-up.ts';

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
/** Thời lượng số tiền chạy tới giá trị mới. Xem lý do chọn 350ms ở chỗ gọi. */
const MONEY_COUNT_MS = 350;

/** Thời gian dòng trôi ra trước khi bị xoá khỏi giỏ. PHẢI khớp 200ms trong `HEADING_CSS`. */
const ROW_EXIT_MS = 200;

export function CartPage(): JSX.Element {
  const { lines, subtotal, count, setQty, setNote: setLineNote } = useCart();
  const [note, setNote] = useState<string>(() => readCartNote());

  // Tiền CHẠY tới số mới thay vì nhảy bậc: bấm `+` một cái mà con số tổng đổi tức thì thì
  // mắt không bắt được là nó vừa đổi, khách phải đọc lại để tự kiểm tra. 350ms (không phải
  // 1200ms mặc định của hook, dành cho lần mở trang Top món): đây là phản hồi cho thao tác
  // vừa xảy ra, chậm hơn nữa là thành trễ. Hook tự nhảy thẳng khi máy giảm chuyển động.
  const shownSubtotal = useCountUp(subtotal, MONEY_COUNT_MS);

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

      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{HEADING_CSS}</style>
      <div style={headerRow}>
        {/* Số món tách thành chip riêng (2026-08-04): để trong ngoặc ngay trong <h1> thì
            trên màn 390px tiêu đề gãy dòng giữa "(0" và "món)" — chip nowrap thì hoặc nằm
            cạnh tiêu đề, hoặc xuống dòng NGUYÊN CỤM, không bao giờ gãy giữa chừng. */}
        <div style={headingGroup}>
          <h1 style={heading} className="shop-cart-heading">
            GIỎ HÀNG CỦA BẠN
          </h1>
          <span style={countChip}>{count} món</span>
        </div>
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
              <CartLineRow
                key={line.menu_item_id}
                line={line}
                onSetQty={setQty}
                onSetNote={setLineNote}
              />
            ))}
          </ul>

          <div style={noteBlock}>
            {/* Nhãn nói rõ "cả đơn" từ khi mỗi món có ô ghi chú riêng — không thì khách gõ
                "món 2 ít cay" vào đây và bếp phải tự đoán món nào. */}
            <label style={noteLabel} htmlFor="cart-note">
              Ghi chú cho cả đơn
            </label>
            <textarea
              id="cart-note"
              value={note}
              onChange={handleNoteChange}
              maxLength={500}
              placeholder="Ví dụ: giao giờ trưa, gọi trước khi tới..."
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
              <span style={summaryValue}>{formatVnd(shownSubtotal)}</span>
            </div>
            <div style={summaryRow}>
              <span style={summaryLabel}>Phí giao hàng</span>
              <span style={shipHint}>Chọn phương thức nhận hàng ở bước sau để xem phí ship</span>
            </div>
            <div style={summaryRowTotal}>
              <span style={totalLabel}>Tổng cộng</span>
              <span style={totalValue}>{formatVnd(shownSubtotal)}</span>
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
  onSetNote,
}: {
  line: CartLine;
  onSetQty: (menu_item_id: string, qty: number) => void;
  onSetNote: (menu_item_id: string, note: string) => void;
}): JSX.Element {
  const isOut = Boolean(line.unavailable);
  const lineTotal = line.unit_price * line.qty;
  // Mở sẵn ô nhập khi món ĐÃ có ghi chú (khách quay lại giỏ phải thấy ngay mình đã dặn gì,
  // không phải bấm mở mới biết). Món hết hàng thì không cho ghi chú — khách sẽ phải xoá dòng.
  const [noteOpen, setNoteOpen] = useState<boolean>(() => Boolean(line.note));

  // Dòng đang trôi ra khỏi giỏ. Xoá tức thì (bản cũ) thì khách bấm `−` ở qty 1 và dòng bốc
  // hơi giữa danh sách — không kịp thấy dòng NÀO vừa mất, phải đọc lại cả giỏ để chắc mình
  // không xoá lầm món khác.
  const [leaving, setLeaving] = useState(false);
  const exitTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const requestRemove = (): void => {
    if (leaving) return;
    // Máy bật giảm chuyển động: xoá thẳng, không giữ dòng lại 200ms để chờ một hiệu ứng
    // mà khách đã nói là không muốn xem.
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      onSetQty(line.menu_item_id, 0);
      return;
    }
    setLeaving(true);
    exitTimer.current = window.setTimeout(() => onSetQty(line.menu_item_id, 0), ROW_EXIT_MS);
  };

  return (
    <li
      className={leaving ? 'shop-cart-row shop-cart-row-leaving' : 'shop-cart-row'}
      // Dòng đang trôi ra thì khoá thao tác: 200ms vẫn đủ để một ngón tay nhanh bấm thêm
      // `−` lần nữa, và lần đó sẽ rơi vào dòng kế tiếp sau khi danh sách co lại.
      style={leaving ? { ...row, pointerEvents: 'none' } : row}
    >
      <div style={thumbWrap}>
        {line.image ? (
          <FadeInImage
            src={line.image}
            alt={line.name}
            style={isOut ? { ...thumbImg, ...dimmed } : thumbImg}
          />
        ) : (
          <div style={isOut ? { ...thumbPlaceholder, ...dimmed } : thumbPlaceholder}>
            <ImagePlaceholder name={line.name} />
          </div>
        )}
      </div>

      {/* MỘT cột nội dung, không còn cột phải riêng (sửa 2026-08-05 theo ảnh chủ dự án gửi):
          bản cũ để cụm số lượng + tiền dòng ở cột phải với `justify-content: space-between`,
          nên tiền dòng bị đẩy xuống ĐÁY dòng và đứng ngang hàng với link "Thêm ghi chú" —
          nhìn như một con số lạc, không thuộc về đâu. Nay số lượng và tiền dòng nằm CÙNG một
          hàng ngay dưới giá món, còn tên món được cả chiều ngang nên bớt bị ngắt dòng xấu. */}
      <div style={isOut ? { ...rowBody, ...dimmed } : rowBody}>
        <div style={rowTop}>
          <span style={rowName}>{line.name}</span>
          {isOut && <span style={outOfStockChip}>Hết hàng</span>}
        </div>
        {/* "/ món" để phân vai rõ với tiền dòng bên dưới: qty 1 thì hai con số bằng nhau, không
            có chữ này thì khách thấy 150.000đ hiện hai lần bằng hai màu và tưởng tính lỗi. */}
        <span style={unitPrice}>{formatVnd(line.unit_price)} / món</span>

        <div style={lineControls}>
          <div style={qtyStepper}>
            <button
              type="button"
              aria-label={`Giảm số lượng ${line.name}`}
              style={isOut ? { ...qtyButton, ...qtyButtonDisabled } : qtyButton}
              disabled={isOut}
              onClick={() => (line.qty <= 1 ? requestRemove() : onSetQty(line.menu_item_id, line.qty - 1))}
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
        </div>

        {isOut && (
          <button type="button" style={removeButton} onClick={requestRemove}>
            Xoá món này
          </button>
        )}

        {!isOut &&
          (noteOpen ? (
            <input
              type="text"
              value={line.note ?? ''}
              onChange={(e) => onSetNote(line.menu_item_id, e.target.value)}
              // Đóng lại khi rời ô mà không gõ gì — tránh để lại một ô trống lửng lơ.
              onBlur={() => setNoteOpen(Boolean(line.note))}
              maxLength={MAX_ITEM_NOTE_LEN}
              placeholder="Ví dụ: ít cay, không hành..."
              aria-label={`Ghi chú cho ${line.name}`}
              data-testid={`cart-line-note-${line.menu_item_id}`}
              style={lineNoteInput}
              autoFocus={!line.note}
            />
          ) : (
            <button
              type="button"
              style={lineNoteButton}
              onClick={() => setNoteOpen(true)}
              aria-label={`Thêm ghi chú cho ${line.name}`}
            >
              Thêm ghi chú
            </button>
          ))}
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
  // Ngang = 0, KHÔNG phải --gutter: `<main>` trong AppShell đã bọc mọi route bằng
  // `padding: 0 var(--gutter)`. Khai thêm ở đây là lề bị cộng đôi (32px/bên trên
  // mobile) và cột nội dung teo lại — chủ quán báo 2026-08-05.
  padding: `var(--sp-4) 0`,
  // 0 chứ không phải sp-4: StickyCta giờ sticky TRONG luồng (không còn fixed đè footer),
  // là phần tử cuối trang — khoảng cách với footer do marginTop của chính Footer lo.
  paddingBottom: 0,
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

// Tiêu đề + chip đếm món: flexWrap để trên màn cực hẹp chip rơi xuống dòng dưới
// nguyên cụm, thay vì ép tiêu đề co chữ.
const headingGroup: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 'var(--sp-2)',
  minWidth: 0,
};

// Cỡ chữ tiêu đề CHỈ khai trong class (không inline) để @media thắng được:
// mobile 16px cho cả cụm "tiêu đề + chip + THÊM MÓN" nằm gọn 1 dòng trên màn 390px
// (chỉ đạo 2026-08-04), desktop trả lại fs-lg.
const HEADING_CSS = `
.shop-cart-heading { font-size: var(--fs-base); }
@media (min-width: 768px) {
  .shop-cart-heading { font-size: var(--fs-lg); }
}

/* Dòng trôi sang trái + mờ đi trước khi bị bỏ khỏi giỏ (xem \`requestRemove\`).
 *
 * CỐ Ý không animate \`height\`/\`padding\` để dòng co lại mượt: rule layout-transition của
 * tokens.css cấm, và trên điện thoại tầm trung một danh sách co chiều cao 60fps là chỗ
 * giật khung hình đầu tiên. Đổi lại, khoảng trống của dòng đóng lại tức thì ở khung cuối —
 * đủ, vì thứ khách cần thấy là DÒNG NÀO đang rời đi, không phải cái khe giữa hai dòng.
 *
 * 200ms viết literal chứ không var(--dur-base): con số này phải khớp với \`ROW_EXIT_MS\`
 * bên JS (timer chờ hết hiệu ứng mới gọi setQty 0). Trỏ vào token thì đổi token là lệch
 * âm thầm — dòng biến mất trước khi trôi xong, hoặc đứng chờ sau khi đã mờ hết. */
.shop-cart-row {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
}
.shop-cart-row-leaving {
  opacity: 0;
  transform: translateX(-16px);
}
`;

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
  whiteSpace: 'nowrap',
};

const countChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: 'var(--sp-1) var(--sp-2)',
  borderRadius: 'var(--r-badge)',
  background: 'var(--brand-100)',
  color: 'var(--brand-700)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  whiteSpace: 'nowrap',
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
  // flex-start (không phải center): tên món nay được xuống dòng, chip "Hết hàng" phải neo
  // theo DÒNG ĐẦU của tên chứ không trôi lơ lửng giữa khối 2-3 dòng.
  alignItems: 'flex-start',
  gap: 'var(--sp-2)',
};

const rowName: CSSProperties = {
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
  // KHÔNG cắt 1 dòng + ellipsis (Task.md, chốt 2026-08-04): giỏ hàng là chỗ khách KIỂM TRA
  // LẠI trước khi đặt — "Bún chả cá thác lác đặc b…" thì không kiểm tra được gì. Trên mobile
  // cột tên bị bóp giữa ảnh 56px và cụm nút số lượng nên tên dài gần như luôn bị cắt. Cho
  // xuống dòng trọn vẹn; tên món tối đa 128 ký tự nên xấu nhất ~3 dòng, không cần line-clamp.
  overflowWrap: 'anywhere',
  lineHeight: 1.35,
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

/** Giá một món. Nay là chữ NHẠT chứ không phải đỏ giá: con số đỏ đậm duy nhất trong dòng phải
 *  là tiền dòng (`lineTotalStyle`) — hai số cùng nổi thì mắt không biết đọc số nào. */
const unitPrice: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

/** Hàng điều khiển: cụm số lượng bên trái, tiền dòng dạt phải, CÙNG một đường ngang. */
const lineControls: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  marginTop: 'var(--sp-1)',
};

/** Nút mở ô ghi chú riêng của MỘT món — cố ý nhẹ ký (không viền, cỡ chữ nhỏ) để không
 * cạnh tranh thị giác với tên món và cụm nút số lượng. */
const lineNoteButton: CSSProperties = {
  alignSelf: 'flex-start',
  minHeight: 'var(--tap-min)',
  padding: 0,
  border: 'none',
  background: 'transparent',
  // Bỏ emoji 📝 + màu đỏ đậm (2026-08-05): comment trên nói nút này phải "nhẹ ký", nhưng đỏ +
  // semibold + emoji thì nó là thứ nổi nhất dòng, nổi hơn cả tên món và tiền.
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  textAlign: 'left',
  textDecoration: 'underline',
  cursor: 'pointer',
};

const lineNoteInput: CSSProperties = {
  marginTop: 'var(--sp-1)',
  width: '100%',
  minHeight: 'var(--tap-min)',
  border: 'none',
  borderBottom: '1px solid var(--border-default)',
  background: 'transparent',
  padding: 'var(--sp-1) 0',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-strong)',
};

/** Cụm số lượng là MỘT khối liền (viền ngoài + vạch chia trong), không phải 3 ô trắng rời nhau
 *  cách 8px như bản cũ — 3 vật thể trôi nổi là phần lớn cảm giác "rối" ở ảnh chủ dự án gửi. */
const qtyStepper: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  overflow: 'hidden',
};

const qtyButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Giữ đúng sàn 44px của --tap-min cho nút −/+ (tokens.css § --tap-min).
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-strong)',
  fontSize: 'var(--fs-lg)',
  cursor: 'pointer',
};

const qtyButtonDisabled: CSSProperties = {
  opacity: 'var(--opacity-disabled)',
  cursor: 'not-allowed',
};

const qtyValue: CSSProperties = {
  minWidth: 'var(--sp-10)',
  height: 'var(--tap-min)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Vạch chia của khối liền — thay cho khoảng trống 8px giữa 3 ô rời.
  borderLeft: '1px solid var(--border-subtle)',
  borderRight: '1px solid var(--border-subtle)',
  textAlign: 'center',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
};

const lineTotalStyle: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
  whiteSpace: 'nowrap',
};

const removeButton: CSSProperties = {
  alignSelf: 'flex-start',
  // Nay nút này nằm TRONG khối `rowBody` (khối bị mờ khi hết hàng) nên phải tự giữ opacity 1:
  // món hết hàng chặn nút TIẾP TỤC, xoá nó là việc duy nhất khách cần làm, không được mờ.
  opacity: 1,
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

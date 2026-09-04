import type { CSSProperties, JSX } from 'react';
import type { PublicMenuItem } from '@order/schemas';
import { MAX_QTY, formatVnd } from '../lib/cart-store.ts';
import { ImagePlaceholder } from './ImagePlaceholder.tsx';
import { FadeInImage } from './FadeInImage.tsx';
import { QtyInput } from './QtyInput.tsx';

/**
 * Card món trong lưới menu (`components.card-item`, `apps/shop/DESIGN.md`).
 *
 * Không có dòng mô tả: `menu_items` không có cột mô tả và `/api/public/menu`
 * chỉ trả đúng 7 field whitelist (M2.D-43) — đây là giới hạn dữ liệu hiện có,
 * không phải thiếu sót khi viết component này.
 *
 * Badge "Bán chạy" CHƯA thi công ở phase 8: UI-SPEC yêu cầu badge này phải
 * "suy ra từ dữ liệu bán thật, không gắn tay", nhưng endpoint công khai hiện
 * chỉ trả 7 field theo M2.D-43 — không có trường thống kê bán hàng nào để
 * suy ra. Phase sau (khi có thống kê bán công khai) chèn badge ngay tại
 * `imageWrap` bên dưới, góc trên-trái.
 *
 * ── MÓN ĐÃ Ở TRONG GIỎ THÌ NÚT `+` THÀNH STEPPER `− N +` (2026-08-05) ──────
 * Trước đây card render Y HỆT NHAU dù món đã trong giỏ hay chưa: mọi phản hồi
 * khi thêm món đều là loại hiện-rồi-tắt (toast 1.8s, badge header nảy), nên
 * cuộn qua vài món là khách mất dấu hoàn toàn và phải mở `/cart` mới biết mình
 * đã lấy những gì. `qtyInCart` là trạng thái BỀN duy nhất trên chính món đó.
 * `--tap-min` trong tokens.css đã ghi sẵn "áp cho nút `+`, nút stepper số
 * lượng" từ đầu — đây mới là chỗ dùng phần thứ hai của token đó.
 */
type Props = {
  item: PublicMenuItem;
  /** Chỉ dùng cho bước 0 → 1 (món chưa có trong giỏ). Chỗ gọi lo cả toast. */
  onAdd: (item: PublicMenuItem) => void;
  /**
   * Số lượng món này đang có trong giỏ; 0 = chưa có. Món hết hàng luôn coi như 0
   * (xem nhánh render bên dưới).
   */
  qtyInCart?: number;
  /** Đổi số lượng của món ĐÃ có trong giỏ. `qty` 0 = bỏ món khỏi giỏ. */
  onSetQty?: (item: PublicMenuItem, qty: number) => void;
  /**
   * Vị trí của card trong lưới — chỉ dùng để so le thời điểm hiện ra (xem
   * `CARD_ITEM_CSS`). Không truyền thì card hiện ra ngay, không so le.
   */
  index?: number;
};

/** Số card đầu tiên được so le. Xem lý do ở `CARD_ITEM_CSS`. */
const STAGGER_CAP = 7;
const STAGGER_STEP_MS = 40;

export function CardItem({
  item,
  onAdd,
  qtyInCart = 0,
  onSetQty,
  index = 0,
}: Props): JSX.Element {
  const isOut = item.is_out_of_stock;
  const image = item.images[0] ?? null;
  // Món hết hàng LUÔN giữ nút `+` khoá, kể cả khi nó đang nằm trong giỏ dưới dạng dòng
  // `unavailable` (D-07 giữ dòng chứ không im lặng xoá): cho stepper ở đây thì khách sẽ
  // cộng số lượng cho một món quán không làm được. Việc xử lý dòng đó thuộc `/cart`, nơi
  // có nút "Xoá món này" và câu giải thích.
  const showStepper = !isOut && qtyInCart > 0 && onSetQty !== undefined;

  return (
    <div
      className="shop-card-item shop-card-enter"
      style={{
        ...card,
        animationDelay: `${Math.min(index, STAGGER_CAP) * STAGGER_STEP_MS}ms`,
      }}
    >
      <div style={imageWrap}>
        <div style={isOut ? { ...imageInner, ...dimmed } : imageInner}>
          {image ? (
            <FadeInImage src={image} alt={item.name} style={img} />
          ) : (
            <ImagePlaceholder name={item.name} />
          )}
        </div>
        {isOut && <span style={outOfStockChip}>Hết hàng</span>}
      </div>

      <div style={isOut ? { ...body, ...dimmed } : body}>
        <h3 style={name}>{item.name}</h3>
        <div style={priceRow}>
          <span style={price}>{formatVnd(item.price)}</span>
          {showStepper ? (
            // `role="group"` + nhãn: trình đọc màn hình phải biết 3 phần tử này nói về MÓN
            // NÀO, vì trên lưới có hàng chục stepper giống nhau.
            <div
              role="group"
              aria-label={`Số lượng ${item.name} trong giỏ`}
              style={qtyStepper}
            >
              <button
                type="button"
                // Về 0 là bỏ món khỏi giỏ, KHÔNG hỏi xác nhận — cùng quy tắc `/cart`
                // (UI-SPEC "Destructive confirmation: không có"): dữ liệu chưa gửi server
                // và bấm `+` thêm lại được ngay tại chỗ.
                onClick={() => onSetQty(item, qtyInCart - 1)}
                // Hình vẽ luôn là dấu `−` (chỉ đạo 2026-08-05, đổi từ bản có icon thùng rác
                // ở qty 1). Nhãn cho trình đọc màn hình VẪN nói đúng hậu quả — dấu `−` không
                // tự nói được rằng bấm nữa là món rời giỏ.
                aria-label={
                  qtyInCart === 1
                    ? `Bỏ ${item.name} khỏi giỏ`
                    : `Giảm số lượng ${item.name}`
                }
                style={minusButton}
              >
                <MinusGlyph />
              </button>
              <QtyInput
                value={qtyInCart}
                onCommit={(qty) => onSetQty(item, qty)}
                label={`Số lượng ${item.name}`}
                style={qtyValue}
                testId={`menu-qty-${item.id}`}
              />
              <button
                type="button"
                onClick={() => onSetQty(item, qtyInCart + 1)}
                disabled={qtyInCart >= MAX_QTY}
                aria-disabled={qtyInCart >= MAX_QTY}
                aria-label={`Tăng số lượng ${item.name}`}
                style={
                  qtyInCart >= MAX_QTY ? { ...addButton, ...addButtonDisabled } : addButton
                }
              >
                <PlusGlyph />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onAdd(item)}
              disabled={isOut}
              aria-disabled={isOut}
              aria-label={`Thêm ${item.name} vào giỏ`}
              style={isOut ? { ...addButton, ...addButtonDisabled } : addButton}
            >
              <PlusGlyph />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlusGlyph(): JSX.Element {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusGlyph(): JSX.Element {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

// Hover "nổi lên" chỉ khai trong class (không inline) vì :hover không viết được
// inline. Gói trong `@media (hover: hover)` để điện thoại (gần 100% khách) không
// bị hover dính sau khi chạm; reduced-motion đã được tokens.css đưa --dur-* về
// 0.01ms, thêm tắt transform cho chắc.
export const CARD_ITEM_CSS = `
@media (hover: hover) and (pointer: fine) {
  .shop-card-item {
    transition:
      transform var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .shop-card-item:hover {
    transform: translateY(-8px);
    box-shadow: var(--shadow-lift);
  }
}
@media (prefers-reduced-motion: reduce) {
  .shop-card-item:hover { transform: none; }
}

/* Card hiện ra so le nhau khi lưới vừa có dữ liệu (tắt skeleton, đổi danh mục, gõ tìm
 * kiếm). Không so le thì 6-20 card đập vào mắt cùng một khung hình — mắt không kịp bắt
 * đâu là đâu và trang trông như vừa nhảy một bậc.
 *
 * Trần so le 7 card × 40ms = 280ms: card thứ 20 mà cũng chờ theo thứ tự thì khách phải
 * đợi 800ms mới thấy hết lưới — hiệu ứng biến thành thời gian chờ, đúng thứ cần tránh.
 *
 * "backwards" chứ KHÔNG phải "both"/"forwards": fill về phía trước sẽ giữ nguyên
 * translateY(0) của keyframe sau khi animation kết thúc, và giá trị đến từ animation thắng
 * mọi khai báo thường trong cascade — nghĩa là quy tắc :hover translateY(-8px) ở trên VĨNH
 * VIỄN không còn tác dụng. "backwards" chỉ giữ khung "from" trong lúc chờ delay rồi trả
 * element về trạng thái tự nhiên, nên hover desktop vẫn sống. */
@keyframes shop-card-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.shop-card-enter {
  animation: shop-card-in var(--dur-base) var(--ease-out) backwards;
}
@media (prefers-reduced-motion: reduce) {
  .shop-card-enter { animation: none; }
}
`;

const card: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  // `height: 100%` + `body { flex: 1 }` + `priceRow { marginTop: auto }`:
  // card cao bằng nhau trong cùng hàng lưới VÀ dòng giá/nút `+` luôn thẳng
  // hàng ngang, kể cả khi tên món dài 1 dòng ở card này và 2 dòng ở card kia.
  height: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  padding: 'var(--pad-card)',
};

const imageWrap: CSSProperties = {
  position: 'relative',
};

const imageInner: CSSProperties = {
  width: '100%',
};

// Áp cho cả vùng ảnh và vùng nội dung (tên/giá/nút) khi hết hàng — chip
// "Hết hàng" ở ngoài 2 vùng này nên KHÔNG bị ảnh hưởng, luôn đọc được.
const dimmed: CSSProperties = {
  opacity: 'var(--opacity-out-of-stock)',
};

const img: CSSProperties = {
  width: '100%',
  aspectRatio: 'var(--ratio-card-media)',
  objectFit: 'cover',
  borderRadius: 'var(--r-card)',
  display: 'block',
};

const outOfStockChip: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  opacity: 1,
  background: 'var(--bg-overlay)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  padding: 'var(--sp-1) var(--sp-2)',
  borderRadius: 'var(--r-badge)',
  whiteSpace: 'nowrap',
};

const body: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  flex: 1,
  minHeight: 0,
};

const name: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  lineHeight: 'var(--lh-snug)',
  // Chừa sẵn đúng 2 dòng: tên 1 dòng không làm card co lại so với card cạnh
  // nó, nên khối tên + giá không bị nhảy bậc giữa các card trong hàng.
  minHeight: 'calc(var(--fs-md) * var(--lh-snug) * 2)',
  color: 'var(--text-strong)',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
};

const priceRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  marginTop: 'auto',
  // Hàng này cao cố định bằng đúng một vùng chạm, nên đổi nút `+` (44px) thành stepper
  // (44+4+24+4+44 = 120px) CHỈ đổi bề ngang — card không cao lên, cả hàng lưới không nhảy
  // một bậc khi khách thêm món đầu tiên. Cùng thủ pháp `name` chừa sẵn 2 dòng ở trên.
  minHeight: 'var(--tap-min)',
  // Lưới an toàn: card hẹp nhất là 280px (grid minmax của MenuPage) trừ 2×--pad-card còn
  // 248px. Giá 6 chữ số "250.000đ" ở --fs-xl heavy ≈ 115px, cộng khe 8px + stepper 120px
  // = 243px — vừa đủ. Giá 7 chữ số thì thà cho stepper rơi xuống dòng riêng (card cao lên)
  // còn hơn tràn ra ngoài viền card. Menu thực tế của quán không có mức giá đó.
  flexWrap: 'wrap',
};

// ── Stepper số lượng khi món đã ở trong giỏ ────────────────────────────────────
// `− N +` = 3 × --tap-min + 2 khe: giữ nguyên sàn 44px của Apple HIG cho cả 2 nút, KHÔNG
// bóp nhỏ để tiết kiệm bề ngang (tokens.css ghi rõ --tap-min "áp cho nút stepper số lượng").
const qtyStepper: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-1)',
  flexShrink: 0,
  marginLeft: 'auto',
};

// Nút `−`/thùng rác: viền chứ không tô nền. `+` vẫn là nút tô đỏ đầy như trước — hai nút
// khác hẳn nhau về sắc độ để ngón tay không bấm nhầm chiều trên một cụm rộng 140px.
const minusButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  flexShrink: 0,
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-button)',
  background: 'var(--bg-surface)',
  color: 'var(--text-strong)',
  cursor: 'pointer',
};

// Ô gõ số (`QtyInput`): giữ đúng 24px như span cũ để phép tính bề ngang ở `priceRow` còn đúng,
// cao bằng nút hai bên để vùng chạm không
// hụt. Chữ/canh giữa/tabular-nums do `QtyInput` tự lo.
const qtyValue: CSSProperties = {
  width: 'var(--sp-6)',
  height: 'var(--tap-min)',
  fontFamily: 'var(--font-display)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const price: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  color: 'var(--text-price)',
};

const addButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  flexShrink: 0,
  border: 'none',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  cursor: 'pointer',
};

const addButtonDisabled: CSSProperties = {
  opacity: 'var(--opacity-disabled)',
  cursor: 'not-allowed',
};

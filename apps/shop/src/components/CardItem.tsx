import type { CSSProperties, JSX } from 'react';
import type { PublicMenuItem } from '@order/schemas';
import { formatVnd } from '../lib/cart-store.ts';
import { ImagePlaceholder } from './ImagePlaceholder.tsx';

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
 */
type Props = {
  item: PublicMenuItem;
  onAdd: (item: PublicMenuItem) => void;
};

export function CardItem({ item, onAdd }: Props): JSX.Element {
  const isOut = item.is_out_of_stock;
  const image = item.images[0] ?? null;

  return (
    <div style={card}>
      <div style={imageWrap}>
        <div style={isOut ? { ...imageInner, ...dimmed } : imageInner}>
          {image ? (
            <img
              src={image}
              alt={item.name}
              loading="lazy"
              decoding="async"
              style={img}
            />
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

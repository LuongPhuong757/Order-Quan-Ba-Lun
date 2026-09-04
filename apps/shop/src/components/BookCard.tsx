import type { CSSProperties, JSX } from 'react';
import type { PublicMenuItem } from '@order/schemas';
import { formatVnd } from '../lib/menu-book.ts';
import { ImagePlaceholder } from './ImagePlaceholder.tsx';

/**
 * Ô món trong quyển menu điện tử (`menu.<domain>`).
 *
 * KHÁC HẲN `CardItem.tsx` của trang đặt hàng, và khác có chủ đích:
 *
 * - `CardItem` là card DỌC, ảnh lớn 3:2 phía trên — vì ở đó ảnh là thứ bán hàng và mỗi
 *   màn chỉ cần vài món.
 * - Ở đây là ô NGANG, ảnh vuông nhỏ bên trái — vì đây là quyển menu: một trang phải chứa
 *   được cả chục món cùng lúc để khách quét mắt tìm nhanh trong ~600 món, đúng như cách
 *   người ta đọc menu giấy. Ảnh lớn không mất đi, nó nằm ở màn xem chi tiết khi bấm vào.
 *
 * KHÔNG có nút `+`, không có stepper, không nhận `onAdd`. Cả file này không import gì từ
 * `cart-store.ts` — đó là cách "trang chỉ để xem" được bảo đảm bằng cấu trúc chứ không
 * bằng lời hứa.
 *
 * Chiều cao ô (94px ở 2 cột / 84px ở 3 cột) phải KHỚP với `rowHeight` trong
 * `lib/menu-book.ts`: hàm đó dùng con số này để tính một trang chứa được mấy dòng. Sửa
 * đệm hay cỡ ảnh ở đây mà quên sửa bên kia thì lưới tràn khỏi trang hoặc chừa hụt.
 */
type Props = {
  item: PublicMenuItem;
  /** 3 cột (máy tính/tablet) thì ô cao hơn và ảnh to hơn 2 cột (điện thoại). */
  wide: boolean;
  /**
   * Trang đang xem → ảnh tải ngay. Trang bên cạnh (dựng sẵn để lật cho mượt) → `false`,
   * ảnh chờ tới lượt. Xem `MenuBookPage` để biết vì sao không tải hết một lượt.
   */
  eager: boolean;
  /** Thứ tự trong trang — chỉ dùng để so le lúc hiện ra. */
  index: number;
  /**
   * Có chạy hiệu ứng hiện-ra-so-le không.
   *
   * TẮT khi trang xuất hiện do một cú LẬT: lúc tờ giấy quay xong thì trang mới đã nằm sẵn
   * trước mắt khách suốt nửa sau cú lật rồi — cho các ô mờ đi rồi hiện lại lần nữa là một
   * cú nháy vô nghĩa, và tệ hơn là nó phá mất cảm giác "tờ giấy vừa lật ra đúng trang này".
   * BẬT khi trang xuất hiện không qua cú lật nào: lần tải đầu, bấm chip nhóm, đổi từ khoá.
   */
  animate?: boolean;
  /** Truyền kèm ô ảnh đang đứng ở đâu trên màn, để ảnh lớn bay ra từ đúng chỗ đó. */
  onOpen: (item: PublicMenuItem, from: DOMRect) => void;
};

export function BookCard({ item, wide, eager, index, animate = true, onOpen }: Props): JSX.Element {
  const image = item.images[0] ?? null;
  const isOut = item.is_out_of_stock;
  const thumbSize = wide ? 64 : 48;
  /**
   * Điện thoại 2 cột chỉ chừa ~107px cho phần chữ, mà tên món ở quán này rất dài ("Bạch
   * Tuộc Nướng : 250 : 1 Đĩa"). Cắt ở 2 dòng là cắt đúng vào giữa con số, đọc ra một cái
   * giá sai. 3 dòng khiến ô cao hơn (một trang bớt một dòng món) — đánh đổi đáng, vì một
   * quyển menu mà tên món đọc không ra thì dày mấy cũng vô dụng.
   * Máy tính ô rộng gấp đôi nên 2 dòng là quá đủ.
   */
  const nameLines = wide ? 2 : 3;

  return (
    <button
      type="button"
      className={animate ? 'book-card book-card-enter' : 'book-card'}
      // So le tối đa 12 ô: quá số đó thì ô cuối trang hiện ra chậm tới mức khách kịp
      // nhận ra mình đang chờ. 18ms/ô đủ để mắt thấy một lượt quét, không thấy giật cục.
      style={animate ? { ...card, animationDelay: `${Math.min(index, 12) * 18}ms` } : card}
      onClick={(e) => onOpen(item, e.currentTarget.getBoundingClientRect())}
      aria-label={`${item.name}, ${formatVnd(item.price)} một ${item.unit}${
        isOut ? ', tạm hết' : ''
      }. Xem ảnh lớn`}
    >
      <span
        style={{
          ...thumb,
          width: thumbSize,
          height: thumbSize,
          opacity: isOut ? 'var(--opacity-out-of-stock)' : 1,
        }}
      >
        {image ? (
          <img
            src={image}
            alt=""
            aria-hidden="true"
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            style={thumbImg}
          />
        ) : (
          <ImagePlaceholder name={item.name} />
        )}
      </span>

      <span style={body}>
        <span
          style={{
            ...name,
            WebkitLineClamp: nameLines,
            opacity: isOut ? 'var(--opacity-out-of-stock)' : 1,
          }}
        >
          {item.name}
        </span>
        <span style={priceRow}>
          {/* Món hết hàng: chữ "Tạm hết" đứng THAY chỗ giá, không phải chỉ làm mờ giá đi.
              Màu đơn độc không được mang nghĩa (rule color-only-meaning trong tokens.css). */}
          {isOut ? (
            <span style={outLabel}>Tạm hết</span>
          ) : (
            <>
              <span style={price}>{formatVnd(item.price)}</span>
              {/* "phần" là đơn vị mặc định của gần như mọi món, nên in ra chỉ tổ chiếm chỗ
                  rồi bị cắt cụt thành "/p…" — trông như lỗi vẽ. Đơn vị KHÁC thường (kg,
                  đĩa, chai) mới là thông tin thật, và mới được in. Ảnh lớn luôn hiện đủ. */}
              {item.unit !== 'phần' && <span style={unit}>/{item.unit}</span>}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * Hiệu ứng hiện ra của ô món. Để cạnh component theo lệ của repo (xem `CARD_ITEM_CSS`) —
 * `motion.css` chỉ nhận chuyển động không thuộc riêng component nào.
 *
 * `animation` chạy MỘT LẦN mỗi khi trang đổi: `MenuBookPage` gắn `key` theo chỉ số trang
 * nên React dựng lại các ô, và animation chạy lại từ đầu. Đó là cách để mỗi lần lật trang
 * đều có nhịp "món hiện ra" thay vì trang mới đứng sẵn ở đó một cách vô hồn.
 *
 * Chỉ `opacity` + `transform` (rule layout-transition). Máy bật giảm chuyển động thì
 * `--dur-base` = 0.01ms nên ô hiện tức thì — vẫn thấy món, chỉ không thấy chuyển động.
 */
export const BOOK_CARD_CSS = `
.book-card {
  -webkit-tap-highlight-color: transparent;
}
.book-card-enter {
  animation: book-card-in var(--dur-base) var(--ease-out) both;
}
@keyframes book-card-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
/* Máy có chuột: ô nhấc nhẹ để thấy nó bấm được. Điện thoại không có :hover nên
   phản hồi chạm do rule chung trong motion.css lo (scale 0.97). */
@media (hover: hover) {
  .book-card {
    transition:
      transform var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .book-card:hover {
    transform: translateY(-2px);
    border-color: var(--border-brand);
  }
}
@media (prefers-reduced-motion: reduce) {
  /* Nhấc lên khi rê chuột là trang trí thuần — WCAG 2.3.3 nói tắt được thì tắt.
     Viền đổi màu vẫn giữ, vì đó mới là thứ nói "bấm được". */
  @media (hover: hover) {
    .book-card:hover { transform: none; }
  }
}
`;

const card: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  minWidth: 0,
  width: '100%',
  padding: 'var(--sp-2)',
  textAlign: 'left',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  overflow: 'hidden',
};

const thumb: CSSProperties = {
  flex: 'none',
  display: 'block',
  overflow: 'hidden',
  borderRadius: '10px',
  background: 'var(--wood-100)',
};

const thumbImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const body: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
  flex: 1,
};

const name: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  lineHeight: 'var(--lh-snug)',
  color: 'var(--text-strong)',
  // Cắt sau `nameLines` dòng (2 hoặc 3, xem trên): tên món dài không được tự do đẩy ô cao
  // lên, vì chiều cao ô là thứ quyết định một trang chứa được mấy dòng món.
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const priceRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '3px',
  minWidth: 0,
};

const price: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-heavy)',
  color: 'var(--text-price)',
  whiteSpace: 'nowrap',
};

const unit: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const outLabel: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--danger-600)',
};

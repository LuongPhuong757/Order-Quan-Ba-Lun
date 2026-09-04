import type { CSSProperties, JSX } from 'react';
import type { PublicMenuItem } from '@order/schemas';
import { formatVnd } from '../lib/menu-book.ts';
import { BowlGlyph } from './ImagePlaceholder.tsx';

/**
 * Một dòng món trong quyển menu điện tử (`menu.<domain>`).
 *
 * ── BỐ CỤC SO LE, THEO ẢNH MENU IN CHỦ QUÁN GỬI (2026-09-04) ────────────────────────
 * Ảnh tròn ĐỔI BÊN qua từng món: món này ảnh trái chữ phải, món kế ảnh phải chữ trái. Mắt
 * đi zigzag xuống trang thay vì rơi thẳng một mạch — đó là thứ làm trang menu in có nhịp,
 * và là điều chủ quán chỉ vào khi nói "bố cục chéo nhau".
 *
 * KHÔNG CÓ KHUNG THẺ. Bản trước mỗi món nằm trong một hộp trắng bo góc có viền; menu in
 * không có hộp nào cả, chỉ có ảnh và chữ đặt thẳng lên trang. Bỏ hộp đi thì màu chủ đạo
 * của nhóm mới thật sự là "màu của trang", chứ không phải một dải nền bị chục cái hộp
 * trắng che gần hết.
 *
 * ẢNH TRÒN chứ không phải vuông bo góc: đĩa thức ăn chụp từ trên xuống vốn đã tròn nên cắt
 * tròn là ăn đúng hình món, và hình tròn giữa một trang toàn chữ thẳng hàng tạo ra nhịp
 * mềm mà hình vuông không có được.
 *
 * KHÔNG import gì từ `cart-store.ts` — đó là cách "trang chỉ để xem" được bảo đảm bằng
 * cấu trúc chứ không bằng lời hứa.
 */
type Props = {
  item: PublicMenuItem;
  /** Trang rộng (máy tính, hoặc một nửa trang đôi) → ảnh to hơn, chữ lớn hơn. */
  roomy: boolean;
  /** Thứ tự trong trang. CHẴN = ảnh bên trái, LẺ = ảnh bên phải. Đó là toàn bộ cái "chéo". */
  index: number;
  /** Trang đang đọc → ảnh tải ngay. Trang bên cạnh dựng sẵn để lật cho mượt → chờ tới lượt. */
  eager: boolean;
  /** Có chạy hiệu ứng hiện-ra-so-le không. Tắt sau mỗi cú lật (xem `MenuBookPage`). */
  animate?: boolean;
  onOpen: (item: PublicMenuItem, from: DOMRect) => void;
};

export function BookCard({
  item,
  roomy,
  index,
  eager,
  animate = true,
  onOpen,
}: Props): JSX.Element {
  const image = item.images[0] ?? null;
  const isOut = item.is_out_of_stock;
  const photoRight = index % 2 === 1;
  // Chủ quán: "hình ảnh đang quá bé" (2026-09-04). 88 → 132 trên điện thoại: ô ảnh tròn
  // giờ chiếm hơn 1/3 bề ngang màn, đủ để nhìn ra món ăn chứ không chỉ nhận ra có ảnh.
  // Phần chữ còn ~200px, vẫn đủ cho tên món dài xuống 2 dòng.
  const size = roomy ? 190 : 132;

  return (
    <button
      type="button"
      className={animate ? 'book-row book-row-enter' : 'book-row'}
      style={{
        ...row,
        flexDirection: photoRight ? 'row-reverse' : 'row',
        // So le tối đa 10 dòng rồi thôi: quá số đó thì dòng cuối hiện ra chậm tới mức khách
        // kịp nhận ra mình đang chờ.
        animationDelay: animate ? `${Math.min(index, 10) * 26}ms` : undefined,
      }}
      onClick={(e) => onOpen(item, e.currentTarget.getBoundingClientRect())}
      aria-label={`${item.name}, ${formatVnd(item.price)} một ${item.unit}${
        isOut ? ', tạm hết' : ''
      }. Xem ảnh lớn`}
    >
      <span
        style={{
          ...photo,
          width: size,
          height: size,
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
            style={photoImg}
          />
        ) : (
          /* Món chưa có ảnh. KHÔNG dùng `ImagePlaceholder`: khung của nó là chữ nhật 3:2
             nền kem, nhét vào hình tròn ra một vòng nửa kem nửa tối (đã thấy trên máy
             thật). Ở đây khung là chính hình tròn tối sẵn có, chỉ mượn lại hình bát. */
          <span role="img" aria-label={`${item.name} — chưa có ảnh`} style={noPhoto}>
            <BowlGlyph />
          </span>
        )}
      </span>

      <span style={{ ...body, textAlign: photoRight ? 'right' : 'left' }}>
        <span
          style={{
            ...name,
            fontSize: roomy ? 'var(--fs-lg)' : 'var(--fs-md)',
            opacity: isOut ? 'var(--opacity-out-of-stock)' : 1,
          }}
        >
          {item.name}
        </span>
        <span style={{ ...priceRow, justifyContent: photoRight ? 'flex-end' : 'flex-start' }}>
          {/* Món hết hàng: chữ "Tạm hết" đứng THAY chỗ giá, không phải chỉ làm mờ giá đi.
              Màu đơn độc không được mang nghĩa (rule color-only-meaning trong tokens.css). */}
          {isOut ? (
            <span style={outLabel}>Tạm hết</span>
          ) : (
            <>
              <span style={{ ...price, fontSize: roomy ? 'var(--fs-xl)' : 'var(--fs-md)' }}>
                {formatVnd(item.price)}
              </span>
              {/* "phần" là đơn vị mặc định của gần như mọi món nên in ra chỉ tổ chiếm chỗ.
                  Đơn vị KHÁC thường (kg, đĩa, chai, con) mới là thông tin thật. */}
              {item.unit !== 'phần' && <span style={unit}>/ {item.unit}</span>}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * Hiệu ứng và phản hồi chạm của dòng món. Để cạnh component theo lệ của repo (xem
 * `CARD_ITEM_CSS`) — `motion.css` chỉ nhận chuyển động không thuộc riêng component nào.
 *
 * Dòng món hiện ra TỪ PHÍA ẢNH CỦA NÓ: dòng ảnh-trái trượt từ trái sang, dòng ảnh-phải
 * trượt từ phải sang. Nhờ vậy chính hiệu ứng vào trang cũng vẽ ra cái nhịp zigzag, thay vì
 * mọi dòng cùng trôi lên như nhau.
 *
 * Chỉ `opacity` + `transform` (rule layout-transition). Máy bật giảm chuyển động thì
 * `--dur-base` = 0.01ms nên dòng hiện tức thì.
 */
export const BOOK_CARD_CSS = `
.book-row {
  -webkit-tap-highlight-color: transparent;
}
.book-row-enter {
  animation: book-row-in var(--dur-base) var(--ease-out) both;
}
.book-row-enter:nth-child(even) {
  animation-name: book-row-in-right;
}
@keyframes book-row-in {
  from { opacity: 0; transform: translateX(-14px); }
  to   { opacity: 1; transform: none; }
}
@keyframes book-row-in-right {
  from { opacity: 0; transform: translateX(14px); }
  to   { opacity: 1; transform: none; }
}
/* Máy có chuột: ảnh phóng nhẹ để thấy dòng bấm được. Điện thoại không có :hover nên phản
   hồi chạm do rule chung trong motion.css lo (scale 0.97). */
@media (hover: hover) {
  .book-row > span:first-child {
    transition: transform var(--dur-base) var(--ease-out);
  }
  .book-row:hover > span:first-child {
    transform: scale(1.06);
  }
}
@media (prefers-reduced-motion: reduce) {
  @media (hover: hover) {
    .book-row:hover > span:first-child { transform: none; }
  }
}
`;

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-4)',
  width: '100%',
  padding: 'var(--sp-2) var(--sp-1)',
  // Không nền, không viền: menu in không có hộp nào, chỉ có ảnh và chữ đặt lên trang.
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
};

const photo: CSSProperties = {
  flex: 'none',
  display: 'block',
  overflow: 'hidden',
  // Tròn hẳn. Xem docblock đầu file để biết vì sao không phải vuông bo góc.
  borderRadius: '50%',
  background: 'var(--menu-chrome)',
  /**
   * Trên nền tối, bóng đen vô hình. Thay bằng một vòng sáng mảnh + quầng sáng rất nhẹ —
   * đúng cách một tấm ảnh bóng tách khỏi mặt giấy tối, và nó viền quanh món ăn khiến món
   * trông nổi hẳn lên thay vì dán bẹt vào nền.
   */
  boxShadow: '0 0 0 2px rgb(255 255 255 / 14%), 0 6px 20px rgb(0 0 0 / 35%)',
};

/** Ruột hình tròn khi món chưa có ảnh: sáng hơn nền trang một chút để vẫn thấy có ô ảnh,
 *  nhưng tối hơn hẳn ảnh thật để nó không giành mắt với những món CÓ ảnh bên cạnh. */
const noPhoto: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  background: 'rgb(255 255 255 / 7%)',
  color: 'var(--menu-price)',
  opacity: 0.55,
};

const photoImg: CSSProperties = {
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
  fontFamily: 'var(--font-display)',
  fontWeight: 'var(--fw-bold)',
  lineHeight: 'var(--lh-snug)',
  // Trắng — chủ quán chốt 2026-09-04. Thấp nhất 10.79:1 trên 7 nền nhóm.
  color: 'var(--menu-text)',
  // Tên món dài được xuống dòng thoải mái: trang tự kéo dài xuống nên không còn lý do gì
  // để cắt cụt tên nữa (bản lưới cũ buộc phải cắt vì chiều cao ô là cố định).
  overflowWrap: 'anywhere',
};

const priceRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--sp-1)',
  minWidth: 0,
  flexWrap: 'wrap',
};

const price: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 'var(--fw-heavy)',
  // Hổ phách, KHÔNG phải đỏ thương hiệu: nền giờ là đá phiến tối, mà đỏ ớt trên nền đó chỉ
  // được ~3:1 — không đọc nổi dù giá là cỡ chữ lớn. Hổ phách là màu đèn lồng trong chính
  // ảnh quán nên vẫn đúng tông, và đạt 5.00:1 ở nền tối nhất. Xem --menu-price/tokens.css.
  color: 'var(--menu-price)',
  whiteSpace: 'nowrap',
};

const unit: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

const outLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--menu-danger)',
};

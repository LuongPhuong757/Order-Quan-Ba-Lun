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
 * ẢNH CHỮ NHẬT RỘNG GẦN NỬA DÒNG (đổi 2026-09-04, trước đó là hình tròn nhỏ). Hình tròn
 * đẹp nhưng cắt mất hai đầu đĩa và nhỏ hơn hẳn ở cùng bề ngang; chủ quán cần nhìn ra MÓN
 * ĂN, không cần một hoạ tiết trang trí. Chi tiết tỉ lệ: xem `photoBtn` cuối file.
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

  return (
    <div
      className={animate ? 'book-row book-row-enter' : 'book-row'}
      style={{
        ...row,
        flexDirection: photoRight ? 'row-reverse' : 'row',
        // So le tối đa 10 dòng rồi thôi: quá số đó thì dòng cuối hiện ra chậm tới mức khách
        // kịp nhận ra mình đang chờ.
        animationDelay: animate ? `${Math.min(index, 10) * 26}ms` : undefined,
      }}
    >
      {/*
        CHỈ TẤM ẢNH LÀ NÚT — chủ quán yêu cầu 2026-09-04, và đây là sửa một lỗi thật.
        Trước đây cả dòng là một `<button>` rộng hết bề ngang trang. Vuốt để lật trang mà
        ngón tay đặt ở đâu cũng rơi trúng nút, nên mỗi cú vuốt hụt là bung ảnh lớn của một
        món ngẫu nhiên — lật trang thành ra rất khó. Thu vùng bấm về đúng tấm ảnh thì phần
        chữ (chiếm hơn nửa bề ngang) trở thành chỗ vuốt an toàn.
      */}
      <button
        type="button"
        className="book-row-photo"
        style={{ ...photoBtn, opacity: isOut ? 'var(--opacity-out-of-stock)' : 1 }}
        onClick={(e) => onOpen(item, e.currentTarget.getBoundingClientRect())}
        aria-label={`Xem ảnh lớn: ${item.name}`}
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
      </button>

      <div style={{ ...body, textAlign: photoRight ? 'right' : 'left' }}>
        <p
          style={{
            ...name,
            fontSize: roomy ? 'var(--fs-lg)' : 'var(--fs-md)',
            opacity: isOut ? 'var(--opacity-out-of-stock)' : 1,
          }}
        >
          {item.name}
        </p>
        <p style={{ ...priceRow, justifyContent: photoRight ? 'flex-end' : 'flex-start' }}>
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
        </p>
      </div>
    </div>
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
  .book-row-photo:hover {
    /* Nhấc lên thật: đi lên một quãng ngắn VÀ bóng đổ giãn rộng ra. Chỉ phóng to mà bóng
       giữ nguyên thì ra "ảnh to lên", không ra "ảnh nhấc khỏi mặt giấy". Scale nhẹ thôi —
       6% trên một tấm rộng nửa dòng là một cú giật rất to. */
    transform: translateY(-5px) scale(1.02);
    box-shadow:
      0 0 0 1px rgb(255 255 255 / 22%),
      0 3px 7px rgb(0 0 0 / 40%),
      0 22px 44px rgb(0 0 0 / 58%),
      0 44px 80px rgb(0 0 0 / 38%);
  }
}
@media (prefers-reduced-motion: reduce) {
  @media (hover: hover) {
    /* Bóng vẫn đổi (đó là dấu hiệu bấm được), chỉ bỏ phần dịch chuyển. */
    .book-row-photo:hover { transform: none; }
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
};

/**
 * Tấm ảnh: CHỮ NHẬT, rộng 46% dòng (chủ quán chốt 2026-09-04 — "gần bằng nửa chiều rộng",
 * và đổi từ tròn sang chữ nhật).
 *
 * Rộng theo PHẦN TRĂM chứ không theo px cố định: cùng một dòng món phải chạy trên điện
 * thoại 390px lẫn nửa trang đôi 720px, đặt cứng px là một bên bé tí một bên chình ình.
 * 46% chừa 54% còn lại cho chữ và khoảng cách — tên món dài vẫn đủ chỗ xuống 2 dòng.
 *
 * `aspect-ratio: 4/3` chứ không vuông: ảnh món của quán chụp ngang, khung vuông cắt mất
 * hai đầu đĩa. Cũng KHÔNG dùng `--ratio-card-media` (3/2) của trang đặt hàng: ở đây ảnh
 * đứng cạnh chữ chứ không nằm trên chữ, 3/2 cho một dải quá dẹt so với khối chữ bên cạnh.
 */
const photoBtn: CSSProperties = {
  flex: '0 0 46%',
  display: 'block',
  padding: 0,
  border: 'none',
  cursor: 'pointer',
  overflow: 'hidden',
  aspectRatio: '4 / 3',
  borderRadius: 'var(--r-category)',
  background: 'var(--menu-chrome)',
  /**
   * BÓNG ĐỔ NHIỀU TẦNG để tấm ảnh NỔI HẲN LÊN khỏi mặt trang (chủ quán chốt 2026-09-04).
   *
   * Một lớp bóng duy nhất chỉ ra vệt mờ, không ra cảm giác nâng lên. Vật thật nổi trên mặt
   * phẳng luôn có ba thứ cùng lúc, và đây đúng ba dòng dưới:
   *   1. viền sáng mảnh   — mép trên bắt ánh sáng, đó là thứ tách ảnh khỏi nền tối;
   *   2. bóng TIẾP XÚC    — tối, sát mép, gần như không nhoè: nói "vật này chạm mặt bàn";
   *   3. bóng ĐỔ          — rộng và mờ, lệch xuống dưới: nói "vật này cách mặt bàn một quãng".
   * Thiếu (2) thì ảnh trông như trôi lơ lửng; thiếu (3) thì trông như dán bẹt.
   *
   * `box-shadow` chứ không `filter: drop-shadow`: ảnh là khối chữ nhật bo góc đặc, không có
   * vùng trong suốt, nên drop-shadow chỉ tốn thêm một lượt vẽ lại mà ra cùng kết quả.
   */
  boxShadow: [
    '0 0 0 1px rgb(255 255 255 / 15%)',
    '0 2px 5px rgb(0 0 0 / 38%)',
    '0 14px 30px rgb(0 0 0 / 52%)',
    '0 30px 60px rgb(0 0 0 / 32%)',
  ].join(', '),
  // Bóng cũng phải đổi theo lúc nhấc lên khi rê chuột, không thì ảnh bay lên mà bóng đứng im.
  transition: 'transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)',
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
  // `<p>` nên phải tự dọn margin mặc định của trình duyệt, nếu không hai dòng chữ bị đẩy
  // lệch khỏi tâm tấm ảnh.
  margin: 0,
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
  margin: 0,
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

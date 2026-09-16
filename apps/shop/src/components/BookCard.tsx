import type { CSSProperties, JSX } from 'react';
import type { PublicMenuItem } from '@order/schemas';
import { formatVnd, splitPortion } from '../lib/menu-book.ts';
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
 * ── QUYỂN MENU NAY CŨNG LÀ MÀN GỌI MÓN (M4, 2026-09-11) ──────────────────────────────
 * Chủ quán chốt: mã QR dán trong quán trỏ THẲNG vào trang này, và khách phải cộng món
 * được ngay tại đây, không qua màn trung gian nào. Nên dòng món có thêm nút cộng ở MÉP
 * NGOÀI (phía đối diện tấm ảnh) — chỉ khi chỗ gọi truyền `onAdd`.
 *
 * Nút nằm ở mép ngoài chứ không nằm giữa dòng là có lý do, và là lý do cũ của chính file
 * này: vuốt để lật trang mà ngón tay rơi trúng nút thì mỗi cú vuốt hụt là một lần thêm
 * món mà khách không hề muốn. Phần chữ ở giữa vẫn phải là vùng vuốt an toàn. Lớp chặn thứ
 * hai nằm ở `MenuBookPage`: `onClickCapture` trên khung trang nuốt mọi `click` phát sinh
 * sau một cú kéo thật.
 *
 * Không truyền `onAdd` thì dòng món KHÔNG có nút nào ngoài tấm ảnh — quyển menu quay về
 * đúng trạng thái "chỉ để xem" như trước.
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
  /** Số phần món này đang có trong giỏ. Bỏ trống = quyển menu ở chế độ CHỈ XEM. */
  qtyInCart?: number;
  /** Thêm món (bước 0 → 1). Không truyền = không vẽ nút cộng nào. */
  onAdd?: (item: PublicMenuItem) => void;
  /** Đổi số lượng món đã có trong giỏ. `0` = bỏ khỏi giỏ. */
  onSetQty?: (item: PublicMenuItem, qty: number) => void;
};

export function BookCard({
  item,
  roomy,
  index,
  eager,
  animate = true,
  onOpen,
  qtyInCart = 0,
  onAdd,
  onSetQty,
}: Props): JSX.Element {
  const { name: dishName, portion } = splitPortion(item.name);
  const image = item.images[0] ?? null;
  const isOut = item.is_out_of_stock;
  // Món hết hàng KHÔNG có nút cộng, kể cả khi đang nằm trong giỏ dưới dạng dòng
  // `unavailable` (giỏ giữ dòng chứ không im lặng xoá). Cho cộng ở đây là để khách tăng số
  // lượng một món quán không làm được; việc xử lý dòng đó thuộc màn giỏ, nơi có câu giải
  // thích và nút bỏ món.
  const canOrder = !isOut && onAdd !== undefined;
  const showStepper = canOrder && qtyInCart > 0 && onSetQty !== undefined;

  return (
    <div
      className={animate ? 'book-row book-row-enter' : 'book-row'}
      style={{
        ...row,
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

      <div style={body}>
        <p
          style={{
            ...name,
            fontSize: roomy ? 'var(--fs-lg)' : 'var(--fs-md)',
            opacity: isOut ? 'var(--opacity-out-of-stock)' : 1,
          }}
        >
          {dishName}
        </p>

        {/* Khẩu phần là DÒNG RIÊNG, nhạt hơn tên. Xem `splitPortion` trong menu-book.ts:
            POS gói khẩu phần vào tên ("Ba Chỉ Nướng : 150"), để nguyên thì màn có hai con
            số 150 cạnh nhau với hai nghĩa khác nhau. */}
        {portion !== null && <p style={portionLine}>{portion}</p>}

        {/* Hàng dưới cùng của cột chữ: GIÁ bên trái, khối gọi món bên phải.
            `marginTop: auto` đẩy nó xuống đáy thẻ nên mọi dòng món thẳng một mạch dù tên
            dài ngắn khác nhau. Trước 2026-09-16 nút gọi món là một CỘT RIÊNG canh giữa
            theo chiều cao — thẻ cao lênh khênh và hở một khoảng lớn giữa giá với nút. */}
        <div style={buyRow}>
          <p style={priceRow}>
            {/* Món hết hàng: chữ "Tạm hết" đứng THAY chỗ giá, không phải chỉ làm mờ giá đi.
                Màu đơn độc không được mang nghĩa (rule color-only-meaning trong tokens.css). */}
            {isOut ? (
              <span style={outLabel}>Tạm hết</span>
            ) : (
              <>
                <span style={{ ...price, fontSize: roomy ? 'var(--fs-lg)' : 'var(--fs-md)' }}>
                  {formatVnd(item.price)}
                </span>
                {/* "phần" là đơn vị mặc định của gần như mọi món nên in ra chỉ tổ chiếm chỗ.
                    Đơn vị KHÁC thường (kg, đĩa, chai, con) mới là thông tin thật. */}
                {item.unit !== 'phần' && <span style={unit}>/ {item.unit}</span>}
              </>
            )}
          </p>

          {canOrder && (
            <div style={orderSlot}>
              {showStepper ? (
                <div role="group" aria-label={`Số lượng ${dishName} trong giỏ`} style={stepper}>
                  <button
                    type="button"
                    onClick={() => onSetQty!(item, qtyInCart - 1)}
                    aria-label={qtyInCart === 1 ? `Bỏ ${dishName} khỏi giỏ` : `Giảm số lượng ${dishName}`}
                    style={stepBtn}
                  >
                    −
                  </button>
                  <span aria-hidden="true" style={qtyText}>
                    {qtyInCart}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSetQty!(item, qtyInCart + 1)}
                    aria-label={`Tăng số lượng ${dishName}`}
                    style={stepBtn}
                  >
                    +
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdd!(item)}
                  aria-label={`Thêm ${dishName} vào giỏ`}
                  style={addBtn}
                >
                  +
                </button>
              )}
            </div>
          )}
        </div>
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
@keyframes book-row-in {
  /* Bỏ so le trái/phải cùng lúc bỏ bố cục zigzag (2026-09-16): ảnh giờ neo trái ở mọi dòng
     nên hai hướng trượt ngược nhau chẳng còn vẽ ra nhịp gì, chỉ còn là nhiễu. */
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}
/* Máy có chuột: ảnh phóng nhẹ để thấy dòng bấm được. Điện thoại không có :hover nên phản
   hồi chạm do rule chung trong motion.css lo (scale 0.97). */
@media (hover: hover) {
  .book-row-photo:hover {
    /* Nhấc lên thật: đi lên một quãng ngắn VÀ bóng đổ giãn rộng ra. Chỉ phóng to mà bóng
       giữ nguyên thì ra "ảnh to lên", không ra "ảnh nhấc khỏi mặt giấy". Scale nhẹ thôi —
       6% trên một tấm rộng nửa dòng là một cú giật rất to. */
    transform: translateY(-3px) scale(1.02);
    box-shadow:
      0 2px 4px rgb(42 29 20 / 12%),
      0 12px 26px rgb(42 29 20 / 16%);
  }
}
@media (prefers-reduced-motion: reduce) {
  @media (hover: hover) {
    /* Bóng vẫn đổi (đó là dấu hiệu bấm được), chỉ bỏ phần dịch chuyển. */
    .book-row-photo:hover { transform: none; }
  }
}
`;

/**
 * Dòng món = một THẺ TRẮNG trên nền kem (bảng màu sáng, chủ quán chốt 2026-09-16).
 *
 * Bản cũ không nền không viền — hợp lý khi nền là ảnh gỗ tối, vì ảnh món tự nổi lên.
 * Trên nền kem thì ảnh món và nền gần nhau về độ sáng, không có gì phân tách dòng này với
 * dòng kia. Thẻ trắng giải chuyện đó mà không cần kẻ ngang.
 *
 * Trắng trên kem chỉ chênh 1.11:1 — cố ý. Tách bằng BÓNG MỀM chứ không bằng tương phản
 * sáng/tối, vì nền kem đã sáng sẵn, đẩy thẻ sáng thêm nữa thì cả màn bạc đi.
 */
const row: CSSProperties = {
  display: 'flex',
  // BẮT BUỘC — apps/shop KHÔNG có reset box-sizing toàn cục. Thẻ có `width: 100%` + padding
  // + viền, thiếu dòng này là thẻ rộng hơn khung đọc và mép phải bị `overflow-x: hidden`
  // xén mất (đã thấy trên máy thật 2026-09-16). Cùng một bẫy đã gặp ở BannerNotice,
  // CartPage và lớp phủ giỏ.
  boxSizing: 'border-box',
  // `stretch` chứ không `center`: cột chữ phải cao bằng thẻ để `buyRow` (marginTop:auto)
  // tụt được xuống đáy. Canh giữa thì hàng giá+nút nổi lơ lửng giữa thẻ.
  alignItems: 'stretch',
  gap: 'var(--sp-3)',
  width: '100%',
  padding: 'var(--sp-3)',
  background: 'var(--menu-surface)',
  // Viền mảnh + bo 20px, đúng như bản duyệt. Chỉ bóng thôi thì mép thẻ trắng tan vào nền
  // kem ở những màn hình chỉnh sáng thấp.
  border: '1px solid var(--menu-line)',
  borderRadius: 20,
  boxShadow: '0 1px 2px rgb(42 29 20 / 5%), 0 6px 16px rgb(42 29 20 / 6%)',
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
  flex: '0 0 auto',
  /**
   * 4:3 NGANG, không phải vuông. Ảnh món của quán chụp ngang — khung vuông `object-fit:
   * cover` cắt mất hai đầu đĩa và cắt luôn chữ "QUÁN BÀ LÙN" ở mép ảnh (đã thấy trên máy
   * thật 2026-09-16). Bản mockup dùng ô vuông vì đó chỉ là khối placeholder, không phải ảnh
   * thật. Cạnh ngắn vẫn 104px nên luật thứ bậc "ảnh là khối lớn nhất trong dòng" còn nguyên.
   */
  width: 139,
  height: 104,
  alignSelf: 'flex-start',
  display: 'block',
  padding: 0,
  border: 'none',
  cursor: 'pointer',
  overflow: 'hidden',
  borderRadius: 'var(--r-input)',
  background: 'var(--menu-chrome)',
  /**
   * Bóng NHẸ, hợp nền sáng. Bộ bóng cũ (viền sáng trắng + ba tầng đen tới 58% alpha) được
   * vẽ cho nền gỗ tối; đặt nguyên lên nền kem thì ảnh trông như bị bẩn một quầng xám.
   * Trên nền sáng, cùng một cảm giác "nhấc lên" chỉ cần bóng rất nhạt ám màu than.
   */
  boxShadow: '0 1px 2px rgb(42 29 20 / 10%), 0 6px 14px rgb(42 29 20 / 12%)',
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
  // Nền kem đậm hơn thẻ một nấc. Bản cũ dùng `rgb(255 255 255 / 7%)` — trắng-mờ trên nền
  // gỗ tối thì thấy được, trên thẻ TRẮNG thì tàng hình hoàn toàn.
  background: 'rgb(42 29 20 / 6%)',
  color: 'var(--menu-price)',
  opacity: 0.65,
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
  gap: '4px',
  minWidth: 0,
  flex: '1 1 auto',
};

/** Khẩu phần ("150", "150 / 1 Đĩa") — dòng riêng, nhạt và nhỏ hơn tên. */
const portionLine: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--menu-text-muted)',
};

/** Hàng đáy thẻ: giá bên trái, khối gọi món bên phải. */
const buyRow: CSSProperties = {
  marginTop: 'auto',
  paddingTop: 'var(--sp-2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
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

/**
 * Khối gọi món ở mép ngoài dòng. Dùng bảng màu `--menu-*` (nền TỐI) chứ không phải token
 * của trang đặt hàng — quyển menu có palette riêng, lấy màu của web đặt hàng vào đây là
 * một nút sáng chói giữa trang gỗ tối.
 *
 * `flexShrink: 0` để tên món dài không bóp nút cộng thành một vạch không bấm được.
 */
const orderSlot: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexShrink: 0,
  // Nút vẽ 36px, khe này nới thêm 4px mỗi bên → vùng ngón tay gặp vẫn đủ 44px. Mắt gặp
  // kích thước vẽ, ngón tay gặp vùng chạm; hai cái đó không cần bằng nhau.
  padding: 4,
};

/**
 * Nút cộng: VÒNG TRÒN VIỀN MẢNH, nhỏ và im.
 *
 * Lịch sử hai lần đổi, đọc kỹ trước khi sửa tiếp — hai yêu cầu này kéo ngược chiều nhau:
 *
 * 1. (2026-09-11) Bản đầu là vòng tròn TỐI trên nền gỗ tối → gần như vô hình. Chủ quán mở
 *    trang, không nhận ra gọi món được, hỏi "menu gọi đồ đâu". Đổi thành nền hổ phách đặc.
 * 2. (2026-09-16) Nền đổi sang kem sáng, và trên nền đó mảng hổ phách đặc 44px lại thành
 *    vật rực nhất dòng: "món ăn trông quá bé trong khi button + quá to, không biết đâu là
 *    chủ thể chính". Thu về viền mảnh 36px.
 *
 * Nên ranh giới là: nút phải ĐỌC RA ĐƯỢC là bấm được, nhưng không được giành mắt với ảnh
 * món. Viền đỏ + dấu + đỏ trên thẻ trắng đạt cả hai. Đừng tô đặc lại, cũng đừng làm mờ đi.
 */
const addBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Vẽ 36px nhưng vùng chạm vẫn đủ 44px nhờ `orderSlot` nới ra bằng padding trong suốt.
  // Chủ quán 2026-09-16: "button + quá to, không biết đâu là chủ thể chính" — nút phải
  // nhỏ và im hơn ảnh món, nên bỏ mảng hổ phách đặc, chỉ còn viền mảnh + dấu + màu giá.
  width: 34,
  height: 34,
  borderRadius: '50%',
  // Viền ĐỎ PHA LOÃNG chứ không đỏ đặc: bản duyệt dùng đỏ ở 45% độ đục. Viền đỏ nguyên
  // chất làm cái vòng tròn đậm gần bằng giá tiền, lại thành giành mắt với ảnh món.
  border: '1px solid color-mix(in oklab, var(--menu-price), transparent 55%)',
  background: 'transparent',
  color: 'var(--menu-price)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-semibold)',
  lineHeight: 1,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
};

const stepper: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  padding: '2px',
  borderRadius: 999,
  border: '1px solid var(--menu-line)',
  // Nền kem rất nhạt, KHÔNG dùng `--menu-chrome` nữa: từ 2026-09-16 token đó là nền màn
  // (kem), dùng ở đây thì bộ số lượng tan vào nền và mất luôn hình dáng.
  background: 'rgb(198 55 32 / 5%)',
};

const stepBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 34,
  height: 34,
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
  // `tabular-nums`: 1 → 2 → 10 không làm khối stepper nhảy bề ngang.
  fontVariantNumeric: 'tabular-nums',
};

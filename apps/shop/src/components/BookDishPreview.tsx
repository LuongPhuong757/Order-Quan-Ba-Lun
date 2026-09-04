import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PublicMenuItem } from '@order/schemas';
import { formatVnd } from '../lib/menu-book.ts';
import { BowlGlyph } from './ImagePlaceholder.tsx';

/**
 * Xem ảnh lớn một món trên nền đen mờ (quyển menu điện tử, 2026-09-04).
 *
 * ── VÌ SAO ẢNH PHẢI "BAY" TỪ Ô VỪA BẤM, KHÔNG PHẢI HIỆN RA GIỮA MÀN ──────────────────
 * Trang menu có tới 30 ô giống hệt nhau về hình dáng. Nếu ảnh lớn cứ thế hiện ra giữa
 * màn, khách mất mối liên hệ giữa "ô mình vừa chạm" và "ảnh đang xem" — và khi đóng lại
 * thì phải dò lại xem nãy mình đang đọc tới đâu. Cho ảnh phóng ra từ đúng ô đó rồi thu về
 * đúng chỗ cũ là cách giữ mạch: mắt bám theo được, không phải định vị lại trang.
 *
 * Kỹ thuật là FLIP: dựng ảnh ở vị trí ĐÍCH trước (trình duyệt tự tính layout), rồi đặt
 * `transform` kéo ngược nó về đúng khung ô nhỏ, rồi thả `transform` về không. Nhờ vậy cả
 * quãng đường chỉ là một phép `transform` chạy trên compositor — không tính lại layout
 * frame nào, mượt cả trên máy yếu. Animate `width`/`height`/`top`/`left` là cách làm sai:
 * mỗi frame một lần reflow, giật ngay trên điện thoại tầm trung (rule layout-transition).
 *
 * Ảnh dùng ĐÚNG URL của ô nhỏ nên đã nằm sẵn trong cache trình duyệt — không có nhịp tải
 * lại, không nháy trắng giữa chừng.
 */
type Props = {
  item: PublicMenuItem;
  /** Ô món đang đứng ở đâu trên màn lúc khách bấm — điểm xuất phát của ảnh. */
  from: DOMRect;
  onClose: () => void;
};

/**
 * Chờ bao lâu rồi mới tháo overlay khỏi DOM, tính từ lúc bắt đầu thu ảnh về ô cũ.
 *
 * ĐỌC từ `--dur-slow` chứ không đóng cứng 320ms: máy bật "giảm chuyển động" thì token đó
 * tụt về 0.01ms, và một hằng số 320ms sẽ giam khách trước tấm nền đen thêm một phần ba
 * giây sau khi mọi thứ đã đứng yên. Đọc hụt (token lạ, môi trường test) thì rơi về 320.
 */
function exitDelayMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-slow').trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 320;
  return raw.endsWith('ms') ? value : value * 1000;
}
/** Kéo overlay xuống quá ngần này thì coi như khách muốn đóng. */
const SWIPE_CLOSE_PX = 90;

export function BookDishPreview({ item, from, onClose }: Props): JSX.Element {
  const image = item.images[0] ?? null;
  const figureRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  /** Ngón tay đang kéo overlay xuống — px. Chỉ khác 0 giữa lúc kéo. */
  const [dragY, setDragY] = useState(0);
  const dragStartRef = useRef<number | null>(null);

  /** Phép biến hình đưa khung ảnh lớn về trùng khít ô nhỏ đã bấm. */
  const transformToThumb = useCallback((): string | null => {
    const el = figureRef.current;
    if (!el) return null;
    const to = el.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return null;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    // MỘT hệ số cho cả hai chiều: ô nhỏ vuông còn ảnh lớn thì không, thu theo hai hệ số
    // khác nhau sẽ bóp méo món ăn trong lúc bay. Lấy chiều nào nhỏ hơn để ảnh chui gọn
    // vào trong khung ô chứ không thò ra ngoài lúc bắt đầu.
    const scale = Math.min(from.width / to.width, from.height / to.height);
    return `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
  }, [from]);

  // Bay RA. `useLayoutEffect` chứ không phải `useEffect`: phải đặt được transform xuất
  // phát TRƯỚC khi trình duyệt vẽ frame đầu tiên, nếu không khách kịp thấy một nháy ảnh
  // lớn đứng giữa màn rồi mới nhảy về ô nhỏ.
  useLayoutEffect(() => {
    const el = figureRef.current;
    const start = transformToThumb();
    if (!el || !start) return;
    el.style.transition = 'none';
    el.style.transform = start;
    el.style.opacity = '0.55';
    // Hai lớp rAF: một để trình duyệt ghi nhận trạng thái xuất phát, một để bắt đầu
    // chuyển. Gộp làm một thì Safari iOS gộp luôn hai lần đặt style và ảnh nhảy thẳng
    // tới đích, không có chuyển động nào.
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = `transform var(--dur-slow) var(--ease-out), opacity var(--dur-base) linear`;
        el.style.transform = 'none';
        el.style.opacity = '1';
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [transformToThumb]);

  /** Thu ảnh về ô cũ rồi mới thật sự đóng. */
  const startClose = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    const el = figureRef.current;
    const back = transformToThumb();
    if (el && back) {
      el.style.transition = `transform var(--dur-slow) var(--ease-out), opacity var(--dur-base) linear`;
      el.style.transform = back;
      el.style.opacity = '0.35';
    }
    if (backdropRef.current) backdropRef.current.style.opacity = '0';
    window.setTimeout(onClose, exitDelayMs());
  }, [leaving, onClose, transformToThumb]);

  // Esc để đóng, và giam tiêu điểm bàn phím lại trong overlay: đây là hộp thoại chặn cả
  // trang, để Tab chạy ra mấy nút lật trang phía sau là người dùng bàn phím lạc hẳn.
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        startClose();
      } else if (e.key === 'Tab') {
        // Chỉ có đúng một thứ bấm được trong overlay (nút đóng) nên giam tiêu điểm
        // gọn thành: Tab luôn quay về chính nó.
        e.preventDefault();
        closeBtnRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startClose]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (leaving) return;
    dragStartRef.current = e.clientY;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    // Chỉ theo chiều KÉO XUỐNG. Kéo lên không làm gì — cho overlay đi lên rồi bật lại
    // trông như lỗi vẽ chứ không như một cử chỉ.
    setDragY(Math.max(0, e.clientY - dragStartRef.current));
  };

  const onPointerUp = () => {
    if (dragStartRef.current === null) return;
    const dragged = dragY;
    dragStartRef.current = null;
    setDragY(0);
    if (dragged > SWIPE_CLOSE_PX) startClose();
  };

  return (
    <div
      ref={backdropRef}
      className="book-preview-backdrop"
      style={backdrop}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Bấm ra nền để đóng. Chỉ ăn khi bấm ĐÚNG nền (không phải con của nó) — chạm vào
      // chính tấm ảnh mà cũng đóng thì khách không phóng to ngắm kỹ được.
      onClick={(e) => {
        if (e.target === e.currentTarget) startClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Ảnh món ${item.name}`}
    >
      <button
        ref={closeBtnRef}
        type="button"
        style={closeBtn}
        onClick={startClose}
        aria-label="Đóng ảnh"
      >
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div
        style={{
          ...stage,
          // Kéo xuống: cả khối đi theo ngón tay và mờ dần — phản hồi tức thì cho biết
          // cử chỉ đang được ghi nhận, buông giữa chừng thì nó tự về chỗ cũ.
          transform: dragY ? `translate3d(0, ${dragY}px, 0)` : undefined,
          opacity: dragY ? Math.max(0.4, 1 - dragY / 260) : undefined,
          transition: dragStartRef.current === null ? 'transform var(--dur-base) var(--ease-out)' : 'none',
        }}
      >
        <div ref={figureRef} style={figure}>
          {image ? (
            <img src={image} alt={item.name} style={bigImg} decoding="async" />
          ) : (
            /* Cùng lý do như trong `BookCard`: khung kem 3:2 của `ImagePlaceholder` đặt
               vào khung 4/3 trên nền đen sẽ ra một mảng kem chỏng chơ. Mượn lại hình bát,
               tự dựng khung cho hợp nền tối. */
            <div role="img" aria-label={`${item.name} — chưa có ảnh`} style={placeholderBox}>
              <BowlGlyph />
            </div>
          )}
        </div>

        {/* Chữ đi sau ảnh một nhịp (delay trong CSS): ảnh tới nơi rồi thông tin mới hiện,
            mắt không phải đọc và bám theo chuyển động cùng lúc. */}
        <div className="book-preview-meta" style={meta}>
          <p style={dishName}>{item.name}</p>
          <p style={priceLine}>
            <span style={priceText}>{formatVnd(item.price)}</span>
            <span style={unitText}>/ {item.unit}</span>
          </p>
          {item.is_out_of_stock && <p style={outNote}>Món này hôm nay tạm hết</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * CSS của overlay. Nền đen mờ tự hiện ra thay vì đập vào mắt — nhảy phịch sang đen kịt
 * làm khách giật mình và mất luôn cảm giác "ảnh vừa nở ra từ ô kia".
 *
 * `backdrop-filter` chỉ là gia vị: Safari cũ không hỗ trợ thì nền vẫn đen mờ đủ để đọc
 * chữ trắng, không cần nhánh dự phòng nào.
 */
export const BOOK_PREVIEW_CSS = `
.book-preview-backdrop {
  animation: book-preview-fade var(--dur-base) var(--ease-out) both;
  transition: opacity var(--dur-base) linear;
}
@keyframes book-preview-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.book-preview-meta {
  animation: book-preview-meta-in var(--dur-base) var(--ease-out) both;
  animation-delay: 90ms;
}
@keyframes book-preview-meta-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: none; }
}
`;

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--z-overlay)' as unknown as number,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-4)',
  padding: 'var(--sp-5)',
  // Đen thật, không phải --bg-overlay (nâu trầm 55%): chủ quán yêu cầu "nền đen trong
  // suốt", và ảnh món cần một nền trung tính để màu đồ ăn không bị ám sắc nâu.
  background: 'rgb(0 0 0 / 82%)',
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
  touchAction: 'none',
};

const stage: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-4)',
  maxWidth: 'min(560px, 92vw)',
  width: '100%',
};

const figure: CSSProperties = {
  width: '100%',
  // Cao tối đa 58% màn: chừa chỗ cho tên món + giá bên dưới mà không phải cuộn, kể cả
  // trên iPhone SE nằm ngang.
  maxHeight: '58vh',
  aspectRatio: '4 / 3',
  borderRadius: 'var(--r-category)',
  overflow: 'hidden',
  background: 'var(--wood-100)',
  willChange: 'transform',
};

const bigImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const placeholderBox: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  background: 'rgb(255 255 255 / 6%)',
  color: 'var(--menu-price)',
  opacity: 0.6,
};

const meta: CSSProperties = {
  textAlign: 'center',
  maxWidth: '100%',
};

const dishName: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)',
  lineHeight: 'var(--lh-tight)',
  color: '#ffffff',
};

const priceLine: CSSProperties = {
  margin: 'var(--sp-2) 0 0',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
};

const priceText: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-xl)',
  fontWeight: 'var(--fw-heavy)',
  // Đỏ ớt --brand-500 trên nền đen chỉ được 3.9:1 — không đạt AA cho chữ thường. Trên nền
  // TỐI phải dùng bậc sáng hơn: hổ phách --wood-400 đạt 8.7:1 trên đen, và vẫn là màu
  // thương hiệu (đèn lồng trong ảnh quán), không phải một màu lạ mượn từ đâu.
  color: 'var(--wood-400)',
};

const unitText: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'rgb(255 255 255 / 72%)',
};

const outNote: CSSProperties = {
  margin: 'var(--sp-2) 0 0',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  color: '#ffb4ac',
};

const closeBtn: CSSProperties = {
  position: 'absolute',
  top: 'calc(var(--safe-top) + var(--sp-3))',
  right: 'var(--sp-3)',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 'var(--r-badge)',
  border: '1px solid rgb(255 255 255 / 26%)',
  background: 'rgb(255 255 255 / 12%)',
  color: '#ffffff',
  cursor: 'pointer',
};

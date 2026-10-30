import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import { menuThumbUrl } from '../lib/menu-thumb.ts';

/**
 * `<img>` hiện dần khi ảnh tải xong, thay vì đập vào mắt từng cái một.
 *
 * Vì sao cần: khách đi mạng 3G/4G, lưới menu có 6-20 ảnh món tải xong lệch nhau vài
 * trăm ms — mỗi ảnh "pop" vào chỗ nền xám là thứ làm trang trông rẻ nhất, dù mọi thứ
 * khác đã đúng. Fade 200ms biến chuỗi pop rời rạc đó thành một lượt hiện ra liền mạch.
 *
 * Chỉ animate `opacity` nên không vi phạm rule layout-transition của tokens.css, và
 * KHÔNG cần khung placeholder riêng: mọi chỗ dùng component này đều đã có nền
 * (--wood-100 / --bg-sunken) hoặc `aspect-ratio` giữ đúng chỗ sẵn từ trước, nên trang
 * không nhảy khi ảnh hiện ra.
 *
 * Dùng chung cho lưới menu, dòng giỏ hàng, dòng đơn đang theo dõi, top món, dải danh
 * mục — 5 chỗ; nhân bản `useState(loaded)` ở từng chỗ là 5 lần cơ hội quên `onError`.
 *
 * ── TẢI NHẸ (2026-10-30) ────────────────────────────────────────────────────────────
 * Đo trang chủ: 72 request / 3,6MB, ~60 ảnh món 800px tải hết ngay từ đầu dù đã có
 * `loading="lazy"`. Lý do: ngưỡng lazy NATIVE của Chrome là 1250px (4G) tới 2500px (mạng
 * chậm) dưới mép màn hình — với lưới 2 cột đó là gần hết menu. Khách công nhân đi 4G chờ
 * 15–30s rồi thoát. Hai sửa:
 *  1. Ảnh lazy KHÔNG gắn `src` tới khi còn cách khung nhìn `LAZY_MARGIN` (IntersectionObserver).
 *  2. Mọi chỗ dùng component này là ô ảnh nhỏ → tải thumbnail 400px (~25KB) thay bản 800px.
 *     Thumbnail chưa có (ảnh cũ chưa backfill) → lỗi → tự lùi về ảnh gốc, khách không thấy gì.
 */
type Props = {
  src: string;
  alt: string;
  /**
   * Style của ảnh. Nếu style này có `opacity` (ví dụ món hết hàng truyền
   * `--opacity-out-of-stock`), giá trị đó được dùng làm ĐÍCH của hiệu ứng hiện dần —
   * component không ghi đè nó thành 1. Nhờ vậy chỗ gọi giữ nguyên cách làm mờ cũ.
   */
  style?: CSSProperties;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  /** Ảnh đầu màn hình (vài ô đầu lưới) → tải ngay + `fetchpriority="high"`. */
  priority?: boolean;
  /** Tắt để dùng nguyên ảnh 800px. Mặc định bật — mọi chỗ dùng hiện tại là ô ảnh nhỏ. */
  useThumb?: boolean;
};

/** Bắt đầu tải khi ảnh còn cách mép khung nhìn chừng nửa màn hình điện thoại — đủ sớm để
 *  cuộn thường không thấy ô trống, đủ hẹp để lần mở đầu chỉ tải ảnh khách nhìn thấy. */
const LAZY_MARGIN = '400px 0px';

export function FadeInImage({
  src,
  alt,
  style,
  loading = 'lazy',
  decoding = 'async',
  priority = false,
  useThumb = true,
}: Props): JSX.Element {
  const ref = useRef<HTMLImageElement>(null);
  const [shown, setShown] = useState(false);
  const eager = priority || loading === 'eager';
  const [near, setNear] = useState(eager);
  // URL gốc mà thumbnail của nó đã lỗi → dùng thẳng URL gốc. Lưu theo `src` (không phải
  // boolean) để khi `src` đổi thì tự thử lại thumbnail của ảnh mới.
  const [thumbFailedFor, setThumbFailedFor] = useState<string | null>(null);

  const thumb = useThumb ? menuThumbUrl(src) : src;
  const currentSrc = thumbFailedFor === src ? src : thumb;

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: LAZY_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    // Ảnh nằm trong cache trình duyệt có thể tải xong TRƯỚC khi React kịp gắn `onLoad`
    // — lúc đó không còn sự kiện nào bắn nữa và ảnh sẽ đứng ở opacity 0 vĩnh viễn (khách
    // quay lại trang menu thấy lưới trống). Đọc `.complete` một lần sau khi gắn ref là
    // cách duy nhất bắt được trường hợp đó. Chưa gắn `src` thì `.complete` cũng là true —
    // phải loại trường hợp đó, không thì ô ảnh hiện khung rỗng.
    if (near && ref.current?.complete && ref.current.naturalWidth > 0) setShown(true);
  }, [currentSrc, near]);

  const target = style?.opacity ?? 1;

  return (
    <img
      ref={ref}
      src={near ? currentSrc : undefined}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding={decoding}
      fetchPriority={priority ? 'high' : undefined}
      onLoad={() => setShown(true)}
      onError={() => {
        // Thiếu thumbnail → thử ảnh gốc trước khi chịu thua.
        if (currentSrc !== src) {
          setThumbFailedFor(src);
          return;
        }
        // Ảnh lỗi cũng phải hiện: giữ opacity 0 là biến ảnh hỏng thành một khoảng trắng bí
        // ẩn, trong khi để trình duyệt vẽ khung `alt` thì khách còn đọc được tên món.
        setShown(true);
      }}
      style={{
        ...style,
        opacity: shown ? target : 0,
        transition: 'opacity var(--dur-base) var(--ease-out)',
      }}
    />
  );
}

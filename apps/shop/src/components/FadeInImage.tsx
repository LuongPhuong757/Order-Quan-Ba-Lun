import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';

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
};

export function FadeInImage({
  src,
  alt,
  style,
  loading = 'lazy',
  decoding = 'async',
}: Props): JSX.Element {
  const ref = useRef<HTMLImageElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // Ảnh nằm trong cache trình duyệt có thể tải xong TRƯỚC khi React kịp gắn `onLoad`
    // — lúc đó không còn sự kiện nào bắn nữa và ảnh sẽ đứng ở opacity 0 vĩnh viễn (khách
    // quay lại trang menu thấy lưới trống). Đọc `.complete` một lần sau khi gắn ref là
    // cách duy nhất bắt được trường hợp đó.
    if (ref.current?.complete) setShown(true);
  }, [src]);

  const target = style?.opacity ?? 1;

  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading={loading}
      decoding={decoding}
      onLoad={() => setShown(true)}
      // Ảnh lỗi cũng phải hiện: giữ opacity 0 là biến ảnh hỏng thành một khoảng trắng bí
      // ẩn, trong khi để trình duyệt vẽ khung `alt` thì khách còn đọc được tên món.
      onError={() => setShown(true)}
      style={{
        ...style,
        opacity: shown ? target : 0,
        transition: 'opacity var(--dur-base) var(--ease-out)',
      }}
    />
  );
}

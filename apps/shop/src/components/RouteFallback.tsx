import type { CSSProperties, JSX } from 'react';

/**
 * Chỗ trống hiện trong lúc chunk của một route đang tải (xem `Suspense` ở `AppShell`).
 *
 * Từ 2026-08-07 mỗi route là một file .js riêng, nên có một nhịp NGẮN giữa lúc khách bấm
 * và lúc trang hiện ra — lần đầu vào route đó, hoặc mạng chậm. Không để trống hẳn kẻo
 * đọc thành "bấm không ăn"; cũng không dựng skeleton giả hình từng trang vì 7 trang có
 * bố cục khác nhau, đoán sai còn nhấp nháy khó chịu hơn.
 *
 * Vì vậy: một dải mảnh chạy ngang + chừa sẵn chiều cao.
 *   - Chừa `min-height` để `<Footer/>` không nhảy lên giữa màn rồi tụt xuống (layout shift).
 *   - Chỉ animate `transform` (không width/left) — không gây reflow từng khung hình.
 *   - `--dur-*` đã tự về 0.01ms khi máy bật "giảm chuyển động" (tokens.css), nhưng
 *     `@keyframes` không đọc token nên vẫn phải tắt tay ở media query dưới.
 *   - `role="status"` + `aria-label`: trình đọc màn hình nói được là đang tải.
 */
export function RouteFallback(): JSX.Element {
  return (
    <div style={wrap} role="status" aria-label="Đang tải trang">
      <style>{CSS}</style>
      <div style={track}>
        <div className="shop-route-bar" />
      </div>
    </div>
  );
}

const wrap: CSSProperties = {
  // 60vh: đủ để footer nằm ngoài màn hình như khi trang đã có nội dung thật.
  minHeight: '60vh',
  paddingTop: 'var(--sp-6)',
};

const track: CSSProperties = {
  height: 3,
  borderRadius: 999,
  background: 'var(--bg-sunken)',
  overflow: 'hidden',
};

const CSS = `
@keyframes shop-route-slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
.shop-route-bar {
  width: 33%;
  height: 100%;
  border-radius: 999px;
  background: var(--brand-500);
  animation: shop-route-slide 1.1s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .shop-route-bar { animation: none; width: 100%; opacity: 0.5; }
}
`;

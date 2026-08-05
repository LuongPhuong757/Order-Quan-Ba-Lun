import { useEffect, useState, type CSSProperties, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { PublicTopDishes, type PublicTopDish, type TopDishesWindow } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { useCountUp } from '../lib/use-count-up.ts';
import { formatVnd } from '../lib/cart-store.ts';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { FadeInImage } from '../components/FadeInImage.tsx';

/**
 * `/top` — bảng xếp hạng món được gọi nhiều nhất (chỉ đạo chủ dự án 2026-08-04).
 *
 * Số suất là dữ liệu bán THẬT (SERVED của đơn đã thanh toán, cả POS lẫn online) —
 * DESIGN.md cấm số bịa, nên cảm giác "sống" của màn này đến từ trình bày:
 * số đếm chạy 0 → giá trị thật lúc mở trang (useCountUp), và poll nền 45s — có đơn
 * mới chốt thì số nhích tiếp từ giá trị đang hiển thị, không reset.
 *
 * Dùng lại nguyên bộ pattern của OrderTrackPage: giữ bản đọc tốt gần nhất (`shown`)
 * để một lần poll rớt mạng 3G không xoá trắng bảng; skeleton chỉ hiện lúc chưa có
 * gì để vẽ. Thanh "độ phổ biến" animate bằng transform scaleX — không animate width.
 *
 * Layout MOBILE-FIRST (khách gần như 100% vào bằng điện thoại — góp ý chủ dự án
 * 2026-08-04 sau bản đầu bị vỡ trên mobile): huy hiệu hạng ĐÈ lên góc ảnh thay vì
 * chiếm một cột riêng, để dồn hết bề ngang cho tên món; kích thước ảnh + cỡ chữ tên
 * phóng to ở ≥768px qua khối `<style>` @media (kỹ thuật của Header.tsx) — 2 thuộc
 * tính đó CỐ Ý chỉ khai trong class, không khai inline, vì inline đè chết @media.
 */

const POLL_MS = 45_000;

const WINDOW_LABELS: Record<TopDishesWindow, string> = {
  all: 'từ ngày mở bán',
  '30d': 'trong 30 ngày qua',
  '7d': 'trong 7 ngày qua',
  today: 'trong hôm nay',
};

export function TopDishesPage(): JSX.Element {
  const { data, loading, error, reload } = useApi('/api/public/top-dishes', PublicTopDishes);

  const [shown, setShown] = useState<PublicTopDishes | null>(null);
  useEffect(() => {
    if (data) setShown(data);
  }, [data]);

  useEffect(() => {
    const id = setInterval(() => reload(), POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  const maxQty = shown ? Math.max(1, ...shown.items.map((d) => d.qty)) : 1;

  return (
    <div style={page}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{RESPONSIVE_CSS}</style>
      <header style={hero}>
        <h1 style={heading}>Món được yêu thích</h1>
        {shown?.enabled && shown.items.length > 0 && (
          <p style={subtitle}>
            Số suất quán đã phục vụ {WINDOW_LABELS[shown.window]} — cập nhật liên tục.
          </p>
        )}
      </header>

      {loading && !shown && <SkeletonRows />}

      {error && !shown && (
        <BannerNotice tone="danger" title={error.message} action={{ label: 'Thử lại', onClick: reload }} />
      )}

      {shown && !shown.enabled && (
        <p style={emptyText}>Bảng xếp hạng đang tạm ẩn. Mời bạn xem menu của quán nhé!</p>
      )}

      {shown?.enabled && shown.items.length === 0 && (
        <p style={emptyText}>Chưa đủ dữ liệu để xếp hạng — quay lại sau nhé!</p>
      )}

      {shown?.enabled && shown.items.length > 0 && (
        <ol style={list}>
          {shown.items.map((dish, i) => (
            <TopDishRow key={dish.id} dish={dish} rank={i + 1} maxQty={maxQty} />
          ))}
        </ol>
      )}

      <Link to="/" style={ctaButton}>
        Đặt món ngay
      </Link>
    </div>
  );
}

function TopDishRow({ dish, rank, maxQty }: { dish: PublicTopDish; rank: number; maxQty: number }): JSX.Element {
  const qty = useCountUp(dish.qty);
  // Thanh phổ biến trượt vào sau mount — scaleX (transform), không animate width.
  const [barIn, setBarIn] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarIn(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const image = dish.images[0] ?? null;
  const barScale = barIn ? dish.qty / maxQty : 0;

  return (
    <li style={row}>
      {/* Cả hàng là 1 link về menu với ô tìm kiếm điền sẵn tên món — đường ngắn nhất
          từ "món này hot" đến "cho vào giỏ" mà không phải nhân đôi logic giỏ hàng ở đây. */}
      <Link
        to={`/?q=${encodeURIComponent(dish.name)}`}
        aria-label={`${dish.name} — hạng ${rank}, ${dish.qty.toLocaleString('vi-VN')} ${dish.unit} đã bán, ${formatVnd(dish.price)}. Bấm để đặt món.`}
        style={rowLink}
        className="shop-top-row"
      >
        {/* Huy hiệu hạng đè góc ảnh — không chiếm cột riêng, dồn bề ngang cho tên món. */}
        <span style={thumbWrap} className="shop-top-thumb" aria-hidden="true">
          {image ? (
            <FadeInImage src={image} alt="" style={thumbImg} />
          ) : (
            <span style={thumbPlaceholder}>
              <BowlGlyph />
            </span>
          )}
          <span style={rank <= 3 ? { ...rankBadge, ...RANK_TOP[rank as 1 | 2 | 3] } : rankBadge}>{rank}</span>
        </span>

        <span style={mid}>
          <span style={dishName} className="shop-top-name">
            {dish.name}
          </span>
          <span style={priceLine}>
            {formatVnd(dish.price)} / {dish.unit}
          </span>
          <span style={barTrack} aria-hidden="true">
            <span
              style={{
                ...barFill,
                transform: `scaleX(${barScale})`,
                background: rank <= 3 ? 'var(--wood-400)' : 'var(--brand-100)',
              }}
            />
          </span>
        </span>

        <span style={qtyCol}>
          <span style={qtyNumber}>{qty.toLocaleString('vi-VN')}</span>
          <span style={qtyUnit}>{dish.unit} đã bán</span>
        </span>
      </Link>
    </li>
  );
}

/** Skeleton 5 hàng lúc chưa có dữ liệu — cùng nhịp pulse với MenuPage. */
function SkeletonRows(): JSX.Element {
  return (
    <div aria-hidden="true" style={list}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{SKELETON_CSS}</style>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="shop-top-skeleton" style={skeletonRow} />
      ))}
    </div>
  );
}

function BowlGlyph(): JSX.Element {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 11h18a9 8 0 0 1-18 0Z" />
      <path d="M5 11c0-2.5 3-6 7-6s7 3.5 7 6" strokeDasharray="1 3" />
      <path d="M17 4.5 20 2" />
    </svg>
  );
}

// Kích thước ảnh + cỡ chữ tên món CHỈ khai ở đây (không inline) để @media thắng được.
// Mobile-first: giá trị ngoài @media là bản điện thoại.
const RESPONSIVE_CSS = `
.shop-top-thumb { width: 56px; height: 56px; }
.shop-top-name { font-size: var(--fs-base); }
@media (min-width: 768px) {
  .shop-top-thumb { width: 72px; height: 72px; }
  .shop-top-name { font-size: var(--fs-md); }
}
/* Hover "nổi lên" cho hàng món — chỉ thiết bị có chuột, khỏi hover dính khi chạm
   trên điện thoại; reduced-motion tắt transform (shadow giữ để vẫn thấy focus). */
@media (hover: hover) and (pointer: fine) {
  .shop-top-row {
    transition:
      transform var(--dur-base) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .shop-top-row:hover {
    transform: translateY(-6px);
    box-shadow: var(--shadow-lift);
  }
}
@media (prefers-reduced-motion: reduce) {
  .shop-top-row:hover { transform: none; }
}
`;

const SKELETON_CSS = `
@keyframes shop-top-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.shop-top-skeleton { animation: shop-top-skeleton-pulse 1.4s var(--ease-in-out) infinite; }
@media (prefers-reduced-motion: reduce) {
  .shop-top-skeleton { animation: none; }
}
`;

const page: CSSProperties = {
  maxWidth: '720px',
  margin: '0 auto',
  // Ngang = 0: `<main>` trong AppShell đã lo lề --gutter cho mọi route (xem CartPage).
  padding: `var(--sp-6) 0 var(--sp-12)`,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-4)',
};

const hero: CSSProperties = {
  textAlign: 'center',
};

const heading: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-2xl)',
  lineHeight: 'var(--lh-tight)',
  letterSpacing: 'var(--ls-tight)',
  color: 'var(--text-strong)',
};

const subtitle: CSSProperties = {
  margin: 'var(--sp-2) 0 0',
  fontSize: 'var(--fs-sm)',
  lineHeight: 'var(--lh-normal)',
  color: 'var(--text-muted)',
};

const emptyText: CSSProperties = {
  margin: 'var(--sp-6) 0',
  textAlign: 'center',
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

const list: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const row: CSSProperties = {
  margin: 0,
};

const rowLink: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-3)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  textDecoration: 'none',
  minHeight: 'var(--tap-min)',
};

// Khung ảnh: kích thước do class `.shop-top-thumb` quyết định (mobile 56 / desktop 72).
const thumbWrap: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
};

const thumbImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  borderRadius: 'var(--r-button)',
  display: 'block',
};

const thumbPlaceholder: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  borderRadius: 'var(--r-button)',
  background: 'var(--wood-100)',
  color: 'var(--wood-500)',
};

// Huy hiệu hạng đè góc trên-trái ảnh; viền màu nền card để tách khỏi ảnh phía dưới.
const rankBadge: CSSProperties = {
  position: 'absolute',
  top: '-6px',
  left: '-6px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '22px',
  height: '22px',
  borderRadius: 'var(--r-badge)',
  border: '2px solid var(--bg-surface)',
  background: 'var(--bg-sunken)',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

// Hạng 1 nổi nhất trên nền --wood-400 (token dành sẵn cho badge "Bán chạy" — chữ tối,
// KHÔNG dùng wood-400 làm màu chữ); hạng 2-3 dịu hơn trên --wood-100.
const RANK_TOP: Record<1 | 2 | 3, CSSProperties> = {
  1: { background: 'var(--wood-400)', color: 'var(--text-strong)' },
  2: { background: 'var(--wood-100)', color: 'var(--wood-700)' },
  3: { background: 'var(--wood-100)', color: 'var(--wood-700)' },
};

const mid: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-1)',
};

// Cỡ chữ do class `.shop-top-name` quyết định (mobile fs-base / desktop fs-md).
const dishName: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  lineHeight: 'var(--lh-snug)',
  color: 'var(--text-strong)',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
};

const priceLine: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const barTrack: CSSProperties = {
  display: 'block',
  height: '6px',
  borderRadius: 'var(--r-badge)',
  background: 'var(--bg-sunken)',
  overflow: 'hidden',
};

const barFill: CSSProperties = {
  display: 'block',
  height: '100%',
  width: '100%',
  borderRadius: 'var(--r-badge)',
  transformOrigin: 'left center',
  transition: 'transform var(--dur-slow) var(--ease-out)',
};

const qtyCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  textAlign: 'right',
  flexShrink: 0,
};

const qtyNumber: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-xl)',
  fontWeight: 'var(--fw-heavy)' as unknown as number,
  lineHeight: 'var(--lh-tight)',
  color: 'var(--text-price)',
  fontVariantNumeric: 'tabular-nums',
};

const qtyUnit: CSSProperties = {
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-faint)',
};

const skeletonRow: CSSProperties = {
  height: '88px',
  borderRadius: 'var(--r-card)',
  background: 'var(--bg-sunken)',
};

const ctaButton: CSSProperties = {
  alignSelf: 'center',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-6)',
  marginTop: 'var(--sp-2)',
  borderRadius: 'var(--r-button)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  textDecoration: 'none',
};

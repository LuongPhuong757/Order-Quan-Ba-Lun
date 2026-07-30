import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import type { PublicMenuGroup } from '@order/schemas';

/**
 * Dải danh mục sticky ngay dưới `<Header/>`, cuộn ngang. Trên mobile chỉ hiện
 * được ~3.5 tile cùng lúc nên thêm dot pagination bên dưới (theo ảnh ref
 * mobile Lotteria thật, xem docs/design-refs/lotteria/README.md).
 *
 * `top` tính hoàn toàn từ token thay vì đo `<Header/>` bằng JS: padding trên
 * dưới `--sp-3` cộng vùng nội dung cao `--tap-min` (nav/search/cart-icon đều
 * đặt `minHeight: var(--tap-min)`) cộng `--safe-top` cho notch iPhone — xấp xỉ
 * đúng chiều cao thật của cả 2 biến thể Header (desktop/mobile đều ≈ cùng
 * chiều cao vì cùng công thức padding + tap-min).
 */
type Props = {
  groups: PublicMenuGroup[];
  activeCode: string | null;
  onSelect: (code: string | null) => void;
};

export function CategoryRail({ groups, activeCode, onSelect }: Props): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeDot, setActiveDot] = useState(0);

  const dotCount = Math.max(1, Math.ceil(groups.length / 3));
  const showDots = groups.length > 3;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !showDots) return;
    const onScroll = (): void => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) {
        setActiveDot(0);
        return;
      }
      const fraction = el.scrollLeft / maxScroll;
      setActiveDot(Math.min(dotCount - 1, Math.round(fraction * (dotCount - 1))));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [dotCount, showDots]);

  return (
    <div style={wrapper}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{RAIL_CSS}</style>

      <div ref={scrollRef} className="shop-category-scroll" style={rail}>
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={activeCode === null}
          style={activeCode === null ? { ...tile, ...tileActive } : tile}
        >
          <span style={{ ...tileSwatch, background: 'var(--wood-100)' }}>
            <AllGlyph />
          </span>
          <span style={tileLabel}>Tất cả</span>
        </button>

        {groups.map((group, index) => {
          // Gán màu pastel theo index nhóm, lặp lại sau 7 nhóm (§8-bis).
          const n = (index % 7) + 1;
          const isActive = activeCode === group.code;
          const representativeImage = group.icon
            ? null
            : (group.items.find((it) => it.images[0])?.images[0] ?? null);

          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onSelect(group.code)}
              aria-pressed={isActive}
              style={isActive ? { ...tile, ...tileActive } : tile}
            >
              <span style={{ ...tileSwatch, background: `var(--cat-${n})` }}>
                {representativeImage ? (
                  <img src={representativeImage} alt="" style={tileImg} />
                ) : (
                  <span aria-hidden="true" style={tileGlyphText}>
                    {group.icon ?? group.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <span style={tileLabel}>{group.name}</span>
            </button>
          );
        })}
      </div>

      {showDots && (
        <div className="shop-category-dots" style={dotsRow} aria-hidden="true">
          {Array.from({ length: dotCount }).map((_, i) => (
            <span key={i} style={i === activeDot ? { ...dot, ...dotActive } : dot} />
          ))}
        </div>
      )}
    </div>
  );
}

function AllGlyph(): JSX.Element {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

// Chiều cao ô vuông danh mục — tổng hợp từ tap-min thay vì px cố định, để
// luôn tỉ lệ với sàn vùng bấm 44px chứ không phải một con số tuỳ chọn.
const swatchSize = 'calc(var(--tap-min) * 1.4)';

const RAIL_CSS = `
.shop-category-scroll {
  display: flex;
  gap: var(--sp-3);
  overflow-x: auto;
  scroll-snap-type: x proximity;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.shop-category-scroll::-webkit-scrollbar { display: none; }
.shop-category-dots { display: flex; }
@media (min-width: 768px) {
  .shop-category-dots { display: none; }
}
`;

const wrapper: CSSProperties = {
  position: 'sticky',
  top: 'calc(var(--safe-top) + var(--sp-3) * 2 + var(--tap-min))',
  zIndex: 'var(--z-category-rail)' as unknown as number,
  background: 'var(--bg-page)',
  borderBottom: '1px solid var(--border-subtle)',
  padding: 'var(--sp-3) var(--gutter) 0',
};

const rail: CSSProperties = {
  paddingBottom: 'var(--sp-3)',
};

const tile: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-1)',
  flexShrink: 0,
  minHeight: 'var(--tap-min)',
  minWidth: 'var(--tap-min)',
  padding: 'var(--sp-1)',
  border: '2px solid transparent',
  borderRadius: 'var(--r-category)',
  background: 'transparent',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
  scrollSnapAlign: 'start',
};

const tileActive: CSSProperties = {
  border: '2px solid var(--border-brand)',
  color: 'var(--brand-600)',
};

const tileSwatch: CSSProperties = {
  width: swatchSize,
  height: swatchSize,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  borderRadius: 'var(--r-category)',
  color: 'var(--wood-700)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
};

const tileGlyphText: CSSProperties = {
  lineHeight: 1,
};

const tileImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const tileLabel: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: swatchSize,
};

const dotsRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  paddingBottom: 'var(--sp-2)',
};

const dot: CSSProperties = {
  width: 'calc(var(--sp-1) * 1.5)',
  height: 'calc(var(--sp-1) * 1.5)',
  borderRadius: 'var(--r-badge)',
  background: 'var(--border-default)',
};

const dotActive: CSSProperties = {
  background: 'var(--brand-500)',
};

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react';
import { z } from 'zod';
import { PublicMenuGroup, type PublicMenuItem } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import {
  computeGrid,
  findFirstPageOfGroup,
  findPageOfItem,
  paginateGroups,
  searchItems,
  type BookGrid,
} from '../lib/menu-book.ts';
import { BookCard, BOOK_CARD_CSS } from '../components/BookCard.tsx';
import { BookDishPreview, BOOK_PREVIEW_CSS } from '../components/BookDishPreview.tsx';
import { Wordmark } from '../components/Wordmark.tsx';

/**
 * Quyển menu điện tử của quán — `menu.<domain>` (chủ quán yêu cầu 2026-09-04).
 *
 * ── TRANG NÀY LÀ GÌ, VÀ KHÔNG PHẢI GÌ ────────────────────────────────────────────────
 * Là quyển menu để khách NGẮM: nhà đang thiếu menu giấy, cần một địa chỉ ai mở cũng xem
 * được toàn bộ món. KHÔNG phải trang đặt hàng — không giỏ, không nút thêm món, không
 * form, không thu thập gì. Cả file này (và 2 component nó dùng) không import một dòng nào
 * từ `cart-store.ts`, và dữ liệu vào bằng đúng MỘT lệnh GET công khai. "Không ảnh hưởng
 * tới logic hay DB" ở đây là tính chất của cấu trúc, không phải một lời hứa suông.
 *
 * ── VÌ SAO LẬT TRANG CHỨ KHÔNG CUỘN ─────────────────────────────────────────────────
 * Cuộn dọc 600 món là một dải bất tận, không ai biết mình đang ở đâu và còn bao xa. Chia
 * trang cho khách một mốc: mỗi nhóm mở một trang mới, một trang là đúng một màn hình, lật
 * là hết trang. Đúng cảm giác cầm quyển menu.
 *
 * ── BA THỨ QUYẾT ĐỊNH ĐỘ MƯỢT, ĐỪNG PHÁ ─────────────────────────────────────────────
 * 1. Dải trang chỉ dựng 3 trang (trước / đang xem / kế) chứ không dựng cả 50 trang. Quán
 *    ~600 món; dựng hết là ~600 nút và ~600 thẻ ảnh nằm trong DOM, điện thoại tầm trung
 *    đứng hình ngay lúc mở trang.
 * 2. Lật bằng MỘT phép `transform` trên dải đó — không đổi `left`, không đổi `width`.
 *    Chuyển động chạy trên compositor, không frame nào phải tính lại layout.
 * 3. Ảnh của trang bên cạnh chỉ bắt đầu tải khi máy rảnh (xem `neighboursReady`). Tải
 *    ngay cùng lúc với trang đang xem là 3 trang ảnh giành nhau băng thông 3G, và trang
 *    khách ĐANG NHÌN là trang xong sau cùng.
 */

const MenuBookResponse = z.object({ groups: PublicMenuGroup.array() });
type MenuBookResponse = z.infer<typeof MenuBookResponse>;

/** Vuốt quá ngần này (hoặc 18% bề ngang, lấy số nhỏ hơn) thì lật hẳn sang trang. */
const SWIPE_COMMIT_PX = 64;

export function MenuBookPage(): JSX.Element {
  const menu = useApi('/api/public/menu-book', MenuBookResponse);
  const groups = useMemo(() => menu.data?.groups ?? [], [menu.data]);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [preview, setPreview] = useState<{ item: PublicMenuItem; from: DOMRect } | null>(null);

  // Trang này dùng chung `index.html` với trang đặt hàng (một bundle, chọn theo tên miền),
  // nên tiêu đề tab phải sửa ở đây — nếu không khách lưu trang lại thấy chữ "Đặt hàng".
  useEffect(() => {
    const previous = document.title;
    document.title = 'Menu — Quán Bà Lùn';
    return () => {
      document.title = previous;
    };
  }, []);

  // ── Đo vùng trang để biết lưới mấy cột mấy dòng ────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<BookGrid>(() => computeGrid(360, 420));
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const next = computeGrid(rect.width, rect.height);
      // So từng trường thay vì thay object mù quáng: `ResizeObserver` bắn cả khi kích
      // thước lệch một phần pixel (thanh địa chỉ Safari trượt lên xuống lúc cuộn), và mỗi
      // lần đổi state ở đây là một lần chia lại toàn bộ ~600 món.
      setGrid((cur) =>
        cur.cols === next.cols && cur.rows === next.rows && cur.gap === next.gap ? cur : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Dựng danh sách trang ───────────────────────────────────────────────────────────
  const results = useMemo(() => searchItems(groups, query), [groups, query]);
  const isSearching = query.trim().length > 0;

  const pages = useMemo(() => {
    if (isSearching) {
      if (results.length === 0) return [];
      return paginateGroups(
        [
          {
            id: 'search-results',
            code: '__search',
            name: `Kết quả cho "${query.trim()}"`,
            icon: '🔍',
            items: results,
          },
        ],
        grid.perPage,
      );
    }
    return paginateGroups(groups, grid.perPage);
  }, [groups, results, isSearching, query, grid.perPage]);

  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  indexRef.current = index;

  /**
   * Khi số món mỗi trang đổi (xoay máy, bật bàn phím ảo, đổi cỡ cửa sổ) thì toàn bộ ranh
   * giới trang đổi theo. Giữ khách ở nguyên chỗ cũ bằng cách bám theo món đầu trang họ
   * đang xem, thay vì để họ văng sang một nhóm khác.
   *
   * Phải là `useLayoutEffect`: chạy sau khi vẽ thì khách kịp thấy một frame ở sai trang.
   */
  const prevPagesRef = useRef(pages);
  useLayoutEffect(() => {
    if (prevPagesRef.current === pages) return;
    const anchor = prevPagesRef.current[indexRef.current]?.items[0]?.id ?? null;
    prevPagesRef.current = pages;
    const at = findPageOfItem(pages, anchor);
    setIndex(Math.min(at, Math.max(0, pages.length - 1)));
  }, [pages]);

  // Gõ từ khoá mới luôn bắt đầu từ kết quả đầu tiên. Không có dòng này thì món khách đang
  // xem dở lại tình cờ nằm trong kết quả và trang nhảy vào giữa danh sách, trông như lỗi.
  useEffect(() => {
    setIndex(0);
  }, [query]);

  const page = pages[index];
  const total = pages.length;

  // ── Lật trang ──────────────────────────────────────────────────────────────────────
  /** −1 = đang chạy về trang trước, 1 = trang sau, 0 = đứng yên. */
  const [shift, setShift] = useState(0);
  const [dragPx, setDragPx] = useState(0);
  /** Một frame duy nhất TẮT hiệu ứng, để dải trang nhảy về giữa mà mắt không thấy. */
  const [snapping, setSnapping] = useState(false);
  const dragRef = useRef<{ x: number; y: number; id: number; captured: boolean } | null>(null);
  /** Ngón tay vừa ĐI một quãng thật (không phải chạm gọn) — dùng để nuốt cú `click` sinh ra
   *  sau đó. Thiếu nó thì vuốt lật trang mà điểm chạm rơi trúng một card sẽ vừa lật trang
   *  vừa bung ảnh lớn của món đó. */
  const draggedRef = useRef(false);

  const canGo = useCallback(
    (dir: number) => (dir < 0 ? index > 0 : index < total - 1),
    [index, total],
  );

  const go = useCallback(
    (dir: -1 | 1) => {
      if (shift !== 0 || !canGo(dir)) return;
      setDragPx(0);
      setShift(dir);
    },
    [shift, canGo],
  );

  /** Nhảy thẳng tới một trang bất kỳ (bấm chip nhóm) — không trượt, vì trượt qua 30 trang
   *  chỉ là một vệt nhoè vô nghĩa. Món hiện ra so le đã đủ báo "trang đã đổi". */
  const jumpTo = useCallback(
    (target: number) => {
      if (target === index) return;
      setShift(0);
      setDragPx(0);
      setSnapping(true);
      setIndex(Math.min(Math.max(0, target), Math.max(0, total - 1)));
    },
    [index, total],
  );

  const onTrackTransitionEnd = (e: ReactTransitionEvent<HTMLDivElement>) => {
    // `transitionend` NỔI BỌT: card món bên trong cũng có transition (viền, nhấc lên khi rê
    // chuột), và sự kiện của chúng cũng chạy tới đây. Không lọc thì rê chuột qua một card
    // đúng lúc trang đang trượt sẽ kết thúc cú lật sớm và nhảy sai trang.
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return;
    if (shift === 0) return;
    setSnapping(true);
    setIndex((i) => Math.min(Math.max(0, i + shift), Math.max(0, total - 1)));
    setShift(0);
  };

  // Bật lại hiệu ứng ngay frame kế tiếp. Nếu bật lại trong cùng frame với lúc dời dải
  // trang về giữa, trình duyệt sẽ animate luôn cú dời đó và khách thấy trang trượt ngược.
  useEffect(() => {
    if (!snapping) return;
    const raf = requestAnimationFrame(() => setSnapping(false));
    return () => cancelAnimationFrame(raf);
  }, [snapping]);

  // Phím ← → cho máy tính. Tắt khi đang mở ảnh lớn (lúc đó Esc mới là phím có nghĩa) và
  // khi con trỏ đang ở trong ô tìm món (mũi tên ở đó để di con trỏ trong chữ).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (preview) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, preview]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (shift !== 0 || preview) return;
    dragRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, captured: false };
    draggedRef.current = false;
    // CỐ Ý KHÔNG `setPointerCapture` ở đây. Bắt con trỏ ngay từ lúc chạm thì trình duyệt
    // dồn luôn cả `click` về đúng phần tử đang bắt — tức là chạm vào một món chỉ báo về
    // dải trang, còn `onClick` của card KHÔNG BAO GIỜ chạy và ảnh lớn không bao giờ mở.
    // Chỉ bắt khi ngón tay đã đi đủ xa để chắc chắn đây là cử chỉ vuốt (xem `onPointerMove`).
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    // 6px: dưới ngưỡng này là ngón tay rung lúc chạm, không phải cử chỉ vuốt — coi đó là
    // kéo thì mọi cú chạm vào card đều bị nuốt mất và không mở được ảnh nào.
    if (Math.abs(dx) > 6 && !d.captured) {
      draggedRef.current = true;
      d.captured = true;
      // Từ đây mới bắt con trỏ: ngón tay trượt ra ngoài mép màn giữa chừng thì `pointerup`
      // vẫn về đúng chỗ này, không để dải trang kẹt lại giữa hai trang.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // Ở mép quyển menu thì kéo nặng tay hẳn (chỉ đi 28% quãng ngón tay) rồi bật lại —
    // đó là cách nói "hết trang rồi" mà không cần chữ nào, và không khoá cứng cử chỉ
    // khiến khách tưởng máy treo.
    const resisted = canGo(dx > 0 ? -1 : 1) ? dx : dx * 0.28;
    setDragPx(resisted);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.captured && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const width = viewportRef.current?.clientWidth ?? 320;
    const threshold = Math.min(SWIPE_COMMIT_PX, width * 0.18);
    const dx = dragPx;
    setDragPx(0);
    if (Math.abs(dx) < threshold) return;
    const dir = dx < 0 ? 1 : -1;
    if (canGo(dir)) go(dir);
  };

  /**
   * Ảnh của hai trang bên cạnh chỉ tải khi máy rảnh — và chỉ sau khi khách đã đứng yên ở
   * một trang một nhịp. Ép tải ngay là ba trang ảnh cùng chen nhau trên đường truyền 3G,
   * trang khách đang nhìn về đích sau cùng.
   *
   * `requestIdleCallback` không có trên Safari iOS nên có nhánh `setTimeout` — cùng cách
   * `main.tsx` nạp trước đường đi mua hàng.
   */
  const [neighboursReady, setNeighboursReady] = useState(false);
  useEffect(() => {
    setNeighboursReady(false);
    let idle: number | undefined;
    let timer: number | undefined;
    const arm = () => setNeighboursReady(true);
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(arm, { timeout: 1200 });
    } else {
      timer = window.setTimeout(arm, 600);
    }
    return () => {
      if (idle !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idle);
      }
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [index]);

  // ── Vẽ ─────────────────────────────────────────────────────────────────────────────
  const activeGroupCode = page?.group.code ?? null;
  // Dải trang luôn có 3 ô (trước / đang xem / kế) nên trang đang xem đứng ở mốc −100%.
  // Lật = dời thêm một ô nữa; kéo tay = cộng thêm quãng ngón tay đã đi.
  const trackStyle: CSSProperties = {
    ...track,
    transform: `translate3d(calc(${-100 - shift * 100}% + ${dragPx}px), 0, 0)`,
    transition:
      snapping || dragRef.current !== null ? 'none' : 'transform var(--dur-slow) var(--ease-out)',
  };

  return (
    <div style={shell}>
      <style>{BOOK_CARD_CSS}</style>
      <style>{BOOK_PREVIEW_CSS}</style>
      <style>{BOOK_PAGE_CSS}</style>

      <header style={header}>
        <Wordmark variant="bare" size="var(--fs-md)" />
        <div style={headerRight}>
          {searchOpen ? (
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => {
                if (!query) setSearchOpen(false);
              }}
              placeholder="Tìm món…"
              aria-label="Tìm món trong menu"
              style={searchInput}
            />
          ) : null}
          <button
            type="button"
            style={iconBtn}
            aria-label={searchOpen ? 'Đóng tìm món' : 'Tìm món'}
            onClick={() => {
              if (searchOpen) {
                setQuery('');
                setSearchOpen(false);
              } else {
                setSearchOpen(true);
              }
            }}
          >
            {searchOpen ? <CloseGlyph /> : <SearchGlyph />}
          </button>
        </div>
      </header>

      {/* Dải nhóm: với ~600 món thì đây mới là đường đi chính, không phải vuốt 50 lần. */}
      {!isSearching && groups.length > 1 && (
        <nav style={rail} aria-label="Nhảy tới nhóm món">
          <div style={railInner} className="book-rail">
            {groups.map((g) => {
              const active = g.code === activeGroupCode;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => jumpTo(findFirstPageOfGroup(pages, g.code))}
                  aria-current={active ? 'true' : undefined}
                  style={active ? { ...chip, ...chipActive } : chip}
                >
                  {g.icon ? `${g.icon} ` : ''}
                  {g.name}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {page && (
        <p style={pageHeading}>
          <span style={pageHeadingName}>
            {page.group.icon ? `${page.group.icon} ` : ''}
            {page.group.name}
          </span>
          {page.pagesInGroup > 1 && (
            <span style={pageHeadingCount}>
              {page.pageInGroup}/{page.pagesInGroup}
            </span>
          )}
        </p>
      )}

      <div
        ref={viewportRef}
        style={viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Pha CAPTURE, tức là chặn trước khi `click` kịp xuống tới card.
        onClickCapture={(e) => {
          if (!draggedRef.current) return;
          draggedRef.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {menu.loading && <p style={notice}>Đang mở menu…</p>}

        {menu.error && (
          <div style={noticeBox}>
            <p style={notice}>{menu.error.message}</p>
            <button type="button" style={retryBtn} onClick={menu.reload}>
              Thử lại
            </button>
          </div>
        )}

        {!menu.loading && !menu.error && total === 0 && (
          <p style={notice}>
            {isSearching
              ? `Không có món nào khớp "${query.trim()}".`
              : 'Menu đang được cập nhật, mời bạn quay lại sau.'}
          </p>
        )}

        {total > 0 && (
          <div style={trackStyle} onTransitionEnd={onTrackTransitionEnd}>
            {[index - 1, index, index + 1].map((slot, position) => {
              const p = pages[slot];
              const current = position === 1;
              return (
                <div
                  key={`${slot}-${p?.group.code ?? 'empty'}`}
                  style={slotStyle}
                  data-page-slot={current ? 'current' : 'side'}
                  // Hai trang bên cạnh nằm ngoài màn nhưng VẪN trong DOM. Không có `inert`
                  // thì trình đọc màn hình đọc luôn món của chúng như thể đang ở trên
                  // trang, và người dùng bàn phím bấm Tab là rơi vào một card không nhìn
                  // thấy — trình duyệt cuộn ngang theo và dải trang lệch hẳn khỏi mốc.
                  // `inert` gỡ cả nhánh khỏi tab order lẫn cây trợ năng, đúng một thuộc tính.
                  inert={!current}
                >
                  {p && (
                    <div
                      // `key` theo chỉ số trang: đổi trang là React dựng lại các ô, nhờ
                      // vậy hiệu ứng "món hiện ra so le" chạy lại từ đầu mỗi lần lật.
                      key={slot}
                      style={{
                        ...gridStyle,
                        gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
                        gridAutoRows: 'min-content',
                        gap: grid.gap,
                      }}
                    >
                      {p.items.map((item, i) => (
                        <BookCard
                          key={item.id}
                          item={item}
                          wide={grid.cols > 2}
                          eager={position === 1 || neighboursReady}
                          index={position === 1 ? i : 0}
                          onOpen={(it, from) => setPreview({ item: it, from })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {total > 0 && (
        <footer style={footer}>
          <button
            type="button"
            style={navBtn}
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Trang trước"
          >
            <ArrowGlyph dir="left" />
          </button>

          <div style={progressWrap} aria-hidden="true">
            <div
              style={{
                ...progressFill,
                // Thanh tiến độ thay vì một hàng chấm: 50 trang thì hàng chấm dài hơn cả
                // màn hình và không đọc được gì. Chỉ animate transform (rule layout-transition).
                transform: `scaleX(${total <= 1 ? 1 : (index + 1) / total})`,
              }}
            />
          </div>

          <span style={counter} aria-live="polite">
            {index + 1}/{total}
          </span>

          <button
            type="button"
            style={navBtn}
            onClick={() => go(1)}
            disabled={index >= total - 1}
            aria-label="Trang sau"
          >
            <ArrowGlyph dir="right" />
          </button>
        </footer>
      )}

      {preview && (
        <BookDishPreview
          item={preview.item}
          from={preview.from}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function SearchGlyph(): JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx={11} cy={11} r={7} stroke="currentColor" strokeWidth={2} />
      <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function CloseGlyph(): JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function ArrowGlyph({ dir }: { dir: 'left' | 'right' }): JSX.Element {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Dải chip nhóm cuộn ngang nhưng KHÔNG hiện thanh cuộn — thanh cuộn ngang trên nền kem
 *  trông như lỗi vẽ. Vuốt vẫn cuộn bình thường. */
const BOOK_PAGE_CSS = `
.book-rail { scrollbar-width: none; }
.book-rail::-webkit-scrollbar { display: none; }
`;

const shell: CSSProperties = {
  // `100dvh` chứ không `100vh`: trên Safari iOS, `100vh` tính theo màn hình lúc thanh địa
  // chỉ đã thu lại, nên chân trang (nút lật) bị đẩy khuất dưới mép máy đúng lúc mới mở.
  height: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-page)',
  color: 'var(--text-body)',
  fontFamily: 'var(--font-body)',
  overflow: 'hidden',
  paddingTop: 'var(--safe-top)',
  paddingBottom: 'var(--safe-bottom)',
};

const header: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-2) var(--gutter)',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
};

const headerRight: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  minWidth: 0,
};

const searchInput: CSSProperties = {
  width: 'min(200px, 42vw)',
  // 16px bắt buộc — dưới mức đó Safari iOS tự phóng to trang khi khách bấm vào ô.
  fontSize: 'var(--fs-base)',
  fontFamily: 'var(--font-body)',
  padding: '6px var(--sp-3)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-input)',
  background: 'var(--bg-sunken)',
  color: 'var(--text-strong)',
};

const iconBtn: CSSProperties = {
  flex: 'none',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  display: 'grid',
  placeItems: 'center',
  border: 'none',
  background: 'transparent',
  color: 'var(--wood-700)',
  cursor: 'pointer',
};

const rail: CSSProperties = {
  flex: 'none',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--wood-100)',
};

const railInner: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
  overflowX: 'auto',
  padding: 'var(--sp-2) var(--gutter)',
  WebkitOverflowScrolling: 'touch',
};

const chip: CSSProperties = {
  flex: 'none',
  padding: '6px var(--sp-3)',
  borderRadius: 'var(--r-badge)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-body)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-medium)',
  fontFamily: 'var(--font-body)',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const chipActive: CSSProperties = {
  background: 'var(--brand-600)',
  borderColor: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 'var(--fw-semibold)',
};

const pageHeading: CSSProperties = {
  flex: 'none',
  margin: 0,
  padding: 'var(--sp-3) var(--gutter) var(--sp-2)',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'var(--sp-2)',
};

const pageHeadingName: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)',
  color: 'var(--text-strong)',
  letterSpacing: 'var(--ls-tight)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const pageHeadingCount: CSSProperties = {
  flex: 'none',
  fontSize: 'var(--fs-caption)',
  color: 'var(--text-muted)',
};

const viewport: CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: 'relative',
  // `overflow: hidden` cắt ở MÉP NGOÀI của phần đệm, không phải mép nội dung. Nên nếu khung
  // này có `padding` ngang thì dải đệm bên phải trở thành một khe hở để lộ trang kế đang
  // nằm chờ — trên máy thật là một cột món lạ dính ở rìa màn. Đệm phải nằm ở TỪNG TRANG
  // (`slotStyle`), không nằm ở khung cắt.
  overflow: 'hidden',
  // Trang không cuộn theo chiều nào, và trình duyệt phải nhường hẳn cử chỉ vuốt cho
  // phần lật trang bên dưới — thiếu dòng này thì Chrome Android nuốt mất `pointermove`
  // để chạy kéo-để-tải-lại.
  touchAction: 'none',
};

const track: CSSProperties = {
  display: 'flex',
  height: '100%',
  width: '100%',
  willChange: 'transform',
};

const slotStyle: CSSProperties = {
  flex: '0 0 100%',
  width: '100%',
  height: '100%',
  minWidth: 0,
  // Đệm nằm ở đây chứ không ở khung cắt — xem ghi chú trong `viewport`.
  padding: '0 var(--gutter)',
  boxSizing: 'border-box',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  height: '100%',
  // Trên màn rộng, để lưới giãn hết 1440px thì mỗi ô dài ngoẵng với một khoảng trắng mênh
  // mông bên phải chữ. Chặn ở `--content-max` (1200px) và căn giữa — cùng con số mà trang
  // đặt hàng đang dùng, nên hai trang không lệch nhịp khi xem cạnh nhau trên máy tính.
  maxWidth: 'var(--content-max)',
  margin: '0 auto',
  width: '100%',
};

const footer: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-2) var(--gutter)',
  borderTop: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
};

const navBtn: CSSProperties = {
  flex: 'none',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 'var(--r-button)',
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--wood-700)',
  cursor: 'pointer',
};

const progressWrap: CSSProperties = {
  flex: 1,
  height: 4,
  borderRadius: 'var(--r-badge)',
  background: 'var(--border-subtle)',
  overflow: 'hidden',
};

const progressFill: CSSProperties = {
  height: '100%',
  width: '100%',
  transformOrigin: 'left center',
  background: 'var(--brand-500)',
  transition: 'transform var(--dur-base) var(--ease-out)',
};

const counter: CSSProperties = {
  flex: 'none',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--text-muted)',
  fontVariantNumeric: 'tabular-nums',
};

const notice: CSSProperties = {
  margin: 'var(--sp-8) auto',
  maxWidth: 'var(--measure)',
  textAlign: 'center',
  color: 'var(--text-muted)',
  fontSize: 'var(--fs-base)',
};

const noticeBox: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-3)',
};

const retryBtn: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-5)',
  borderRadius: 'var(--r-button)',
  border: 'none',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontSize: 'var(--fs-base)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'var(--font-body)',
  cursor: 'pointer',
};

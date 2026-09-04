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
  findCoverOfGroup,
  findFirstPageOfGroup,
  findPageOfItem,
  groupAccents,
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
 * 1. Chỉ dựng 3 tờ giấy (trước / đang đọc / kế) chứ không dựng cả 64 trang. Quán ~600 món;
 *    dựng hết là ~600 nút và ~600 thẻ ảnh nằm trong DOM, điện thoại tầm trung đứng hình
 *    ngay lúc mở trang.
 * 2. Cả cú lật là MỘT phép `rotateY` trên một lớp đã composite — không đổi `left`, không
 *    đổi `width`, không frame nào phải tính lại layout. Chi tiết mô hình 3 tờ giấy: xem
 *    khối "Lật trang như lật một tờ giấy" bên dưới.
 * 3. Ảnh của trang bên cạnh chỉ bắt đầu tải khi máy rảnh (xem `neighboursReady`). Tải
 *    ngay cùng lúc với trang đang xem là 3 trang ảnh giành nhau băng thông 3G, và trang
 *    khách ĐANG NHÌN là trang xong sau cùng.
 */

const MenuBookResponse = z.object({ groups: PublicMenuGroup.array() });
type MenuBookResponse = z.infer<typeof MenuBookResponse>;

/**
 * Buông tay khi tờ giấy đã đi được ngần này quãng đường (28%) thì nó lật nốt; chưa tới thì
 * bật về chỗ cũ. Thấp hơn nữa là chạm khẽ cũng lật mất trang; cao hơn nữa là phải vuốt gần
 * hết màn hình mới sang được trang, mỏi tay khi menu có tới 64 trang.
 */
const TURN_COMMIT_RATIO = 0.28;

/**
 * Tờ giấy đang xoay. `dir` 1 = lật tới (tờ đang đọc xoay đi), −1 = lật lùi (tờ trước đó
 * xoay về). `angle` ∈ [−180, 0] độ. `settling` = đang tự chạy nốt bằng CSS transition;
 * false nghĩa là đang bám theo ngón tay, lúc đó KHÔNG được bật transition kẻo tờ giấy đi
 * trễ hơn ngón tay một nhịp.
 */
type Turn = { dir: 1 | -1; angle: number; settling: boolean } | null;

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

  /**
   * Màu chủ đạo của từng nhóm. Tính một lần cho cả bảng chứ không tính lẻ từng chỗ dùng —
   * màu phải GIỐNG NHAU ở dải chip, ở nền trang và ở bìa, nếu không khách không nối được
   * "chip màu vàng nghệ" với "trang màu vàng nghệ".
   */
  const accents = useMemo(() => groupAccents(groups), [groups]);
  /** Nền trang. Kết quả tìm kiếm không thuộc nhóm nào nên về nền kem trung tính. */
  const accentOf = (code: string) => accents.get(code) ?? 'var(--bg-page)';

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
    const was = prevPagesRef.current[indexRef.current];
    prevPagesRef.current = pages;
    // Trang bìa không có món nào để bám — bám theo mã nhóm, nếu không khách đang ngắm bìa
    // mà xoay máy là bị ném thẳng về đầu quyển.
    const at =
      was?.kind === 'cover'
        ? findCoverOfGroup(pages, was.group.code)
        : findPageOfItem(pages, was?.items[0]?.id ?? null);
    setIndex(Math.min(at, Math.max(0, pages.length - 1)));
  }, [pages]);

  // Gõ từ khoá mới luôn bắt đầu từ kết quả đầu tiên. Không có dòng này thì món khách đang
  // xem dở lại tình cờ nằm trong kết quả và trang nhảy vào giữa danh sách, trông như lỗi.
  useEffect(() => {
    setIndex(0);
  }, [query]);

  const page = pages[index];
  const total = pages.length;

  // ── Lật trang như lật một tờ giấy ──────────────────────────────────────────────────
  /**
   * MÔ HÌNH: quyển menu là một chồng tờ giấy, gáy nằm ở MÉP TRÁI màn hình. Đúng ba lớp
   * chồng lên nhau, dưới lên trên:
   *
   *   1. `pages[index + 1]` — tờ nằm sẵn bên dưới, sẽ lộ ra khi lật tới. Luôn có mặt trong
   *      DOM nên ảnh của nó kịp tải trước lúc khách nhìn thấy.
   *   2. `pages[index]`     — tờ đang đọc. Xoay đi khi lật TỚI.
   *   3. `pages[index - 1]` — tờ vừa lật qua, đậu sẵn ở 180°. Xoay về khi lật LÙI.
   *
   * `angle` của một tờ luôn nằm trong [0°, 180°]: 0° là nằm phẳng đang đọc, 180° là đã lật
   * hẳn sang trái. `backface-visibility: hidden` làm tờ giấy BIẾN MẤT đúng lúc quay quá
   * 90° — nghĩa là nửa sau của cú lật để lộ tờ bên dưới, đúng ngữ pháp thị giác của việc
   * lật trang. Không cần vẽ mặt sau tờ giấy, cũng không cần lớp thứ tư.
   *
   * DẤU CỦA GÓC LÀ DƯƠNG, KHÔNG PHẢI ÂM — và đây là chỗ dễ làm hỏng nhất. Góc âm cho mép
   * giấy ngả RA SAU màn hình; khung ngoài có `perspective` nên trình duyệt xếp các lớp
   * theo độ sâu 3D thật, và tờ giấy đang lật bị chính tờ nằm dưới che khuất — nhìn ra chỉ
   * thấy trang mới hiện ra đột ngột, không thấy tờ giấy nào cả (đã dính đúng lỗi này). Góc
   * dương cho mép giấy nhấc về PHÍA NGƯỜI XEM rồi mới gạt sang trái: vừa nổi lên trên, vừa
   * đúng động tác tay khi lật một quyển sách thật.
   *
   * VÌ SAO CHỈ `rotateY`: cả cú lật là MỘT phép biến hình 3D trên một lớp đã composite —
   * không frame nào phải tính lại layout. Xoay `perspective` đặt ở khung ngoài chứ không
   * ở tờ giấy, để mọi tờ cùng nhìn từ một điểm nhìn (đặt trên từng tờ thì mỗi tờ có phối
   * cảnh riêng và cú lật trông như gãy khúc).
   */
  const [turn, setTurn] = useState<Turn>(null);
  const dragRef = useRef<{ x: number; id: number; dir: 1 | -1 | 0; captured: boolean } | null>(
    null,
  );
  /** Ngón tay vừa ĐI một quãng thật (không phải chạm gọn) — dùng để nuốt cú `click` sinh ra
   *  sau đó. Thiếu nó thì vuốt lật trang mà điểm chạm rơi trúng một card sẽ vừa lật trang
   *  vừa bung ảnh lớn của món đó. */
  const draggedRef = useRef(false);
  /**
   * Trang mới hiện ra có chạy hiệu ứng "món hiện ra so le" không.
   *
   * TẮT sau mỗi cú lật: lúc đó tờ giấy đã quay xong và trang mới ĐANG NẰM SẴN trước mắt
   * khách rồi — cho các ô mờ đi rồi hiện lại lần nữa là một cú nháy vô nghĩa. Chỉ BẬT khi
   * trang xuất hiện mà không qua cú lật nào: lần tải đầu, bấm chip nhóm, đổi từ khoá tìm.
   */
  const [animateCards, setAnimateCards] = useState(true);

  const canGo = useCallback(
    (dir: number) => (dir < 0 ? index > 0 : index < total - 1),
    [index, total],
  );

  /** Góc xuất phát của tờ đang lật: lật tới thì tờ hiện tại đi từ 0°, lật lùi thì tờ trước
   *  đó đi từ 180° (đang đậu úp mặt, `backface-visibility` giấu đi). */
  const startAngle = (dir: 1 | -1) => (dir === 1 ? 0 : 180);
  const endAngle = (dir: 1 | -1) => (dir === 1 ? 180 : 0);

  const go = useCallback(
    (dir: -1 | 1) => {
      if (turn || !canGo(dir)) return;
      setTurn({ dir, angle: endAngle(dir), settling: true });
    },
    [turn, canGo],
  );

  /** Nhảy thẳng tới một trang bất kỳ (bấm chip nhóm). KHÔNG lật: lật qua 30 tờ giấy chỉ là
   *  một vệt nhoè dài hai giây. Món hiện ra so le đã đủ báo "trang đã đổi". */
  const jumpTo = useCallback(
    (target: number) => {
      if (target === index) return;
      setTurn(null);
      setAnimateCards(true);
      setIndex(Math.min(Math.max(0, target), Math.max(0, total - 1)));
    },
    [index, total],
  );

  const onLeafTransitionEnd = (e: ReactTransitionEvent<HTMLDivElement>) => {
    // `transitionend` NỔI BỌT: card món bên trong cũng có transition (viền, nhấc lên khi rê
    // chuột), và sự kiện của chúng cũng chạy tới đây. Không lọc thì rê chuột qua một card
    // đúng lúc trang đang lật sẽ kết thúc cú lật sớm và nhảy sai trang.
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return;
    if (!turn) return;
    // Tờ giấy đi hết đường thì trang mới thành trang đang đọc; buông giữa chừng (tờ bật về
    // chỗ cũ) thì chỉ việc bỏ trạng thái lật đi.
    if (turn.angle === endAngle(turn.dir)) {
      setAnimateCards(false);
      setIndex((i) => Math.min(Math.max(0, i + turn.dir), Math.max(0, total - 1)));
    }
    setTurn(null);
  };

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
    if (turn || preview) return;
    dragRef.current = { x: e.clientX, id: e.pointerId, dir: 0, captured: false };
    draggedRef.current = false;
    // CỐ Ý KHÔNG `setPointerCapture` ở đây. Bắt con trỏ ngay từ lúc chạm thì trình duyệt
    // dồn luôn cả `click` về đúng phần tử đang bắt — tức là chạm vào một món chỉ báo về
    // khung trang, còn `onClick` của card KHÔNG BAO GIỜ chạy và ảnh lớn không bao giờ mở.
    // Chỉ bắt khi ngón tay đã đi đủ xa để chắc chắn đây là cử chỉ vuốt.
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    // 6px: dưới ngưỡng này là ngón tay rung lúc chạm, không phải cử chỉ vuốt — coi đó là
    // kéo thì mọi cú chạm vào card đều bị nuốt mất và không mở được ảnh nào.
    if (!d.captured) {
      if (Math.abs(dx) <= 6) return;
      draggedRef.current = true;
      d.captured = true;
      // CHỐT hướng ngay tại đây và không đổi nữa. Cho phép đổi hướng giữa chừng thì tờ giấy
      // phải nhảy giữa hai tờ khác nhau trong lúc ngón tay vẫn đang chạm — vừa giật vừa vô lý
      // với một quyển sách thật.
      d.dir = dx < 0 ? 1 : -1;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dir = d.dir as 1 | -1;
    const width = viewportRef.current?.clientWidth || 1;
    // Ở mép quyển menu thì tờ giấy chỉ nhấc lên được một góc nhỏ rồi thôi — đó là cách nói
    // "hết trang rồi" mà không cần chữ nào, và không khoá cứng cử chỉ khiến khách tưởng treo.
    const raw = Math.min(1, Math.abs(dx) / width);
    const progress = canGo(dir) ? raw : raw * 0.12;
    setTurn({ dir, angle: startAngle(dir) + (endAngle(dir) - startAngle(dir)) * progress, settling: false });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.captured && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!d.captured || d.dir === 0) return;
    const dir = d.dir as 1 | -1;
    setTurn((cur) => {
      if (!cur) return null;
      const travelled = Math.abs(cur.angle - startAngle(dir)) / 180;
      const target =
        travelled >= TURN_COMMIT_RATIO && canGo(dir) ? endAngle(dir) : startAngle(dir);
      // Tờ giấy đang đứng đúng chỗ cần tới thì sẽ KHÔNG có `transitionend` nào bắn ra, và
      // trạng thái lật kẹt lại mãi mãi (không lật được nữa). Kết sổ ngay tại đây.
      if (cur.angle === target) {
        if (target === endAngle(dir)) {
          setAnimateCards(false);
          setIndex((i) => Math.min(Math.max(0, i + dir), Math.max(0, total - 1)));
        }
        return null;
      }
      return { dir, angle: target, settling: true };
    });
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
  /** Góc hiện tại của một tờ: chỉ tờ đang được lật mới rời khỏi chỗ đậu của nó. */
  const angleOf = (which: 'current' | 'prev'): number => {
    if (turn?.dir === 1 && which === 'current') return turn.angle;
    if (turn?.dir === -1 && which === 'prev') return turn.angle;
    return which === 'current' ? 0 : 180;
  };

  /** Dựng một tờ giấy. `layer` quyết định nó đậu ở đâu và có bấm được không. */
  const renderLeaf = (layer: 'under' | 'current' | 'prev') => {
    const at = layer === 'under' ? index + 1 : layer === 'current' ? index : index - 1;
    const p = pages[at];
    if (!p) return null;
    const angle = layer === 'under' ? 0 : angleOf(layer);
    // Chỉ tờ đang nằm phẳng trước mặt khách mới nhận thao tác. Tờ bên dưới và tờ đã lật qua
    // phải `inert`: không có nó thì Tab nhảy vào những ô không nhìn thấy và trình đọc màn
    // hình đọc luôn món của trang khác như thể đang ở trên trang này.
    const live = layer === 'current' && turn === null;
    // Bóng đổ trên tờ giấy đậm dần theo góc quay — đó là thứ làm cú lật ra chất giấy thay
    // vì một tấm ảnh phẳng xoay quanh trục.
    const shade = Math.min(1, Math.abs(angle) / 90) * 0.42;
    return (
      <div
        style={{
          ...pageLeaf,
          // Nền tờ giấy mang màu của nhóm — đây là tín hiệu chính của "mỗi nhóm một màu".
          // Đặt ở TỜ GIẤY chứ không ở khung ngoài: lúc đang lật, hai tờ hai màu khác nhau
          // trượt qua nhau, và chính khoảnh khắc đó nói cho khách biết họ vừa sang nhóm mới.
          background: accentOf(p.group.code),
          transform: `rotateY(${angle}deg)`,
          transition: turn?.settling ? 'transform var(--dur-page-turn) var(--ease-in-out)' : 'none',
          // Tờ bên dưới không bao giờ xoay nên đừng bắt trình duyệt giữ layer GPU cho nó.
          willChange: layer === 'under' ? undefined : 'transform',
          pointerEvents: live ? undefined : 'none',
        }}
        data-page-slot={layer === 'current' ? 'current' : layer}
        inert={!live}
        onTransitionEnd={layer === 'under' ? undefined : onLeafTransitionEnd}
      >
        {p.kind === 'cover' ? (
          /* Trang bìa "sang chương": đúng một tấm ảnh tràn viền + tên nhóm, không có món
             nào bấm được. Đây là nhịp nghỉ giữa hai nhóm — thứ làm quyển menu điện tử đọc
             ra như menu in chứ không như một danh sách dài vô tận. */
          <div key={at} style={coverFrame}>
            <img
              src={p.coverImage ?? ''}
              alt=""
              aria-hidden="true"
              loading={layer === 'current' || neighboursReady ? 'eager' : 'lazy'}
              decoding="async"
              style={coverImg}
            />
            {/* Nền tối chuyển dần ở chân ảnh: ảnh món có chỗ sáng chỗ tối tuỳ tấm, chữ
                trắng đặt thẳng lên là chỗ đọc được chỗ không. Lớp này bảo đảm tương phản
                bất kể ảnh nào rơi vào đây. */}
            <div aria-hidden="true" style={coverScrim} />
            <div style={coverText}>
              <p style={coverName}>
                {p.group.icon ? `${p.group.icon} ` : ''}
                {p.group.name}
              </p>
              <p style={coverCount}>{p.group.items.length} món</p>
            </div>
          </div>
        ) : (
          <div
            // `key` theo chỉ số trang: đổi trang là React dựng lại các ô, nhờ vậy hiệu ứng
            // "món hiện ra so le" chạy lại từ đầu — nhưng chỉ khi `animateCards` cho phép.
            key={at}
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
                eager={layer === 'current' || neighboursReady}
                index={i}
                animate={layer === 'current' && animateCards}
                onOpen={(it, from) => setPreview({ item: it, from })}
              />
            ))}
          </div>
        )}
        {shade > 0 && <div aria-hidden="true" style={{ ...leafShade, opacity: shade }} />}
      </div>
    );
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
                  // Chip nghỉ mang đúng màu nhóm nên cả dải thành một mục lục có màu; chip
                  // ĐANG XEM vẫn là đỏ thương hiệu. Giữ đỏ ở đây là có chủ ý: nếu chip active
                  // cũng chỉ là một pastel nữa thì giữa 32 chip pastel không còn gì nói được
                  // "bạn đang ở đây" — vị trí hiện tại phải khác LOẠI màu, không chỉ khác sắc.
                  style={
                    active
                      ? { ...chip, ...chipActive }
                      : { ...chip, background: accentOf(g.code), borderColor: 'transparent' }
                  }
                >
                  {g.icon ? `${g.icon} ` : ''}
                  {g.name}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Trang bìa đã in tên nhóm cỡ lớn ngay trên ảnh — lặp lại ở thanh nhỏ này là thừa,
          và làm tấm ảnh bị đẩy tụt xuống một dòng. */}
      {page && page.kind === 'items' && (
        // Thanh tiêu đề đứng NGOÀI tờ giấy (nó không được lật đi cùng), nên phải tự nhuộm
        // màu nhóm. Để nguyên nền kem thì giữa dải chip và trang màu hở ra một vệt kem lạc
        // lõng, nhìn như trang chưa vẽ xong.
        <p style={{ ...pageHeading, background: accentOf(page.group.code) }}>
          <span style={pageHeadingName}>
            {/* Vạch màu nhắc lại màu của nhóm ngay cạnh tên — nền trang là màu rất nhạt,
                một vạch đặc cho mắt cái mốc chắc chắn để đối chiếu với chip trên dải. */}
            <span aria-hidden="true" style={{ ...headingBar, background: accentOf(page.group.code) }} />
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

        {/* Chồng tờ giấy. Thứ tự trong DOM CHÍNH LÀ thứ tự chồng lên nhau: tờ sẽ lộ ra nằm
            dưới cùng, tờ đang đọc ở giữa, tờ vừa lật qua nằm trên (đậu ở 180° nên mặt sau
            quay ra và `backface-visibility` giấu nó đi cho tới khi khách lật lùi). */}
        {total > 0 && (
          <>
            {renderLeaf('under')}
            {renderLeaf('current')}
            {renderLeaf('prev')}
          </>
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

const headingBar: CSSProperties = {
  display: 'inline-block',
  width: 4,
  height: '0.95em',
  marginRight: 'var(--sp-2)',
  borderRadius: 2,
  verticalAlign: '-0.08em',
  // Viền mảnh để vạch không biến mất khi màu nhóm gần trùng nền trang (vd kem tre).
  boxShadow: 'inset 0 0 0 1px rgb(42 29 20 / 12%)',
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
  // này có `padding` ngang thì dải đệm hai bên trở thành khe hở để lộ tờ giấy bên dưới. Đệm
  // phải nằm ở TỪNG TỜ (`pageLeaf`), không nằm ở khung cắt.
  overflow: 'hidden',
  /**
   * Điểm nhìn 3D cho cả chồng giấy, đặt Ở ĐÂY chứ không đặt trên từng tờ: chung một điểm
   * nhìn thì các tờ mới thuộc cùng một không gian và cú lật liền mạch. Đặt trên từng tờ là
   * mỗi tờ có phối cảnh riêng, tờ nào cũng quay quanh "camera" của chính nó, trông gãy khúc.
   *
   * 1600px là khoảng cách mắt–trang: nhỏ hơn thì méo như ống kính mắt cá, lớn hơn thì gần
   * như phẳng và mất luôn cảm giác tờ giấy có bề dày không gian.
   *
   * `overflow: hidden` ở đây KHÔNG làm hỏng 3D: nó chỉ cắt phần thò ra ngoài khung. Thứ làm
   * bẹp không gian 3D là `transform-style: preserve-3d` đi kèm overflow — mà các tờ giấy ở
   * đây đều là mặt phẳng đơn nên không cần preserve-3d.
   */
  perspective: '1600px',
  // Trang không cuộn theo chiều nào, và trình duyệt phải nhường hẳn cử chỉ vuốt cho
  // phần lật trang bên dưới — thiếu dòng này thì Chrome Android nuốt mất `pointermove`
  // để chạy kéo-để-tải-lại.
  touchAction: 'none',
};

/**
 * Một tờ giấy trong quyển menu. Ba tờ nằm CHỒNG khít lên nhau (`position: absolute`), thứ
 * tự trong DOM quyết định tờ nào nằm trên.
 *
 * `background` PHẢI đục: tờ giấy trong suốt thì nhìn xuyên thấy luôn trang bên dưới và cú
 * lật thành hai lớp chữ chồng nhau.
 *
 * `transformOrigin: left center` = gáy sách nằm ở mép trái màn hình, đúng chiều lật của một
 * quyển sách tiếng Việt.
 *
 * `backfaceVisibility: hidden` là mấu chốt: quay quá 90° thì tờ giấy tự biến mất, để lộ tờ
 * bên dưới. Nhờ vậy không phải vẽ mặt sau tờ giấy và không cần thêm lớp nào nữa.
 */
const pageLeaf: CSSProperties = {
  position: 'absolute',
  inset: 0,
  padding: '0 var(--gutter)',
  boxSizing: 'border-box',
  background: 'var(--bg-page)',
  transformOrigin: 'left center',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

/**
 * Bóng đổ trên tờ giấy đang xoay: đậm dần về phía mép ngoài, và đậm dần theo góc quay.
 *
 * Đây là chi tiết biến "một hình chữ nhật xoay quanh trục" thành "một tờ giấy đang được lật"
 * — mắt đọc ra chiều sâu từ bóng, không phải từ phép biến hình. Là một lớp phủ riêng chứ
 * không phải `filter: brightness()`: filter buộc trình duyệt vẽ lại cả tờ mỗi frame, còn
 * lớp phủ này chỉ đổi `opacity`, chạy thẳng trên compositor.
 */
const leafShade: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background: 'linear-gradient(90deg, rgb(42 29 20 / 0%) 0%, rgb(42 29 20 / 55%) 100%)',
};

/* ── Trang bìa nhóm ──────────────────────────────────────────────────────────────────
 * Ảnh chiếm trọn tờ giấy, bo góc như một tấm ảnh dán vào trang menu. Đệm dọc để tấm ảnh
 * không dính sát mép trên/dưới của khung — có khoảng thở thì mới ra "ảnh in trên trang",
 * dán sát mép thì ra "ảnh nền của app".
 */
const coverFrame: CSSProperties = {
  position: 'relative',
  height: '100%',
  margin: 'var(--sp-1) 0 var(--sp-3)',
  borderRadius: 'var(--r-category)',
  overflow: 'hidden',
  background: 'var(--wood-100)',
};

const coverImg: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const coverScrim: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgb(0 0 0 / 0%) 45%, rgb(0 0 0 / 72%) 100%)',
};

const coverText: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: 'var(--sp-5)',
};

const coverName: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-2xl)',
  fontWeight: 'var(--fw-heavy)',
  lineHeight: 'var(--lh-tight)',
  letterSpacing: 'var(--ls-tight)',
  color: '#ffffff',
  // Ảnh món có chỗ sáng gắt (đèn, mâm trắng); riêng lớp nền tối chưa chắc đủ ở mọi tấm.
  textShadow: '0 2px 12px rgb(0 0 0 / 55%)',
};

const coverCount: CSSProperties = {
  margin: 'var(--sp-1) 0 0',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-medium)',
  color: 'rgb(255 255 255 / 82%)',
  textShadow: '0 1px 8px rgb(0 0 0 / 55%)',
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

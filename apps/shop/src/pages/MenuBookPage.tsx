import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react';
import { z } from 'zod';
import { PublicMenuGroup, type PublicMenuItem } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import {
  computeGrid,
  findFirstPageOfGroup,
  findPageOfItem,
  formatVnd,
  paginateGroups,
  type BookGrid,
  type BookPage,
} from '../lib/menu-book.ts';
import { BookCard, BOOK_CARD_CSS } from '../components/BookCard.tsx';
import { BookDishPreview, BOOK_PREVIEW_CSS } from '../components/BookDishPreview.tsx';
import { DineInCartSheet, DineInCodeSheet } from '../components/DineInOrderSheets.tsx';
import { readAcceptedCode, readRememberedCode, useDineInCart } from '../lib/dine-in-cart-store.ts';

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
const TURN_COMMIT_RATIO = 0.22;

/**
 * Tờ giấy đang xoay. `dir` 1 = lật tới (tờ đang đọc xoay đi), −1 = lật lùi (tờ trước đó
 * xoay về). `angle` ∈ [−180, 0] độ — âm, xem ghi chú dấu góc ở dưới. `settling` = đang tự chạy nốt bằng CSS transition;
 * false nghĩa là đang bám theo ngón tay, lúc đó KHÔNG được bật transition kẻo tờ giấy đi
 * trễ hơn ngón tay một nhịp.
 */

export function MenuBookPage(): JSX.Element {
  const menu = useApi('/api/public/menu-book', MenuBookResponse);
  const groups = useMemo(() => menu.data?.groups ?? [], [menu.data]);

  const [preview, setPreview] = useState<{ item: PublicMenuItem; from: DOMRect } | null>(null);

  /**
   * GỌI MÓN TẠI BÀN (M4, 2026-09-11) — mã QR dán trong quán trỏ THẲNG vào trang này.
   *
   * Chủ quán chốt: khách quét QR là ra ngay quyển menu và cộng món được tại chỗ, không qua
   * màn trung gian nào. Nên trang "chỉ để xem" nay có thêm giỏ + hai lớp phủ (giỏ và mã).
   *
   * Giỏ là store RIÊNG (`dine-in-cart-store.ts`), KHÔNG dùng chung giỏ của web đặt ship:
   * khách đang có đơn ship dở dang mà quét QR ngồi bàn thì hai giỏ đè lên nhau, và món tại
   * bàn trộn vào đơn ship.
   *
   * Giỏ + mã là LỚP PHỦ chứ không phải route — trang này còn được phục vụ ở toàn bộ
   * `menu.<domain>`, nơi `main.tsx` cố ý KHÔNG dựng `BrowserRouter`. Là route thì luồng chỉ
   * chạy được một nửa số địa chỉ mà QR có thể trỏ tới.
   */
  const cart = useDineInCart();
  const [sheet, setSheet] = useState<'none' | 'cart' | 'code'>('none');
  /** `accepted` = mã này nhân viên đã nhận rồi; lớp phủ mở ra là DANH SÁCH MÓN CỦA BÀN, không
   * phải 5 chữ số để đọc. */
  const [activeCode, setActiveCode] = useState<
    { code: string; expires_at: number; accepted: boolean } | null
  >(null);

  // Đọc trong effect chứ không trong initializer: hai hàm này chạm localStorage, và StrictMode
  // dev gọi initializer hai lần.
  //
  // THỨ TỰ CÓ Ý: mã còn hiệu lực thắng mã đã nhận. Khách vừa sinh mã mới cho lượt gọi thứ hai
  // thì thứ họ cần trên màn là 5 số để đọc cho nhân viên, không phải danh sách món lượt trước.
  useEffect(() => {
    const remembered = readRememberedCode();
    if (remembered) {
      setActiveCode({ ...remembered, accepted: false });
      return;
    }
    const accepted = readAcceptedCode();
    // `expires_at: 0` — mã đã nhận thì hạn 15 phút không còn nghĩa gì. Lớp phủ mở thẳng ở
    // trạng thái `USED` nên không có nhánh nào đọc con số này để mà hiểu nhầm là "hết hạn".
    if (accepted) setActiveCode({ code: accepted.code, expires_at: 0, accepted: true });
  }, []);

  // Đồng bộ giỏ với menu mới ĐÚNG MỘT LẦN mỗi lần dữ liệu menu đổi (không phải mỗi render):
  // giá đổi thì cập nhật, món hết/bị xoá thì đánh dấu chứ không im lặng bỏ khỏi giỏ.
  const syncedRef = useRef<PublicMenuGroup[] | null>(null);
  useEffect(() => {
    if (!menu.data) return;
    if (syncedRef.current === menu.data.groups) return;
    syncedRef.current = menu.data.groups;
    cart.applyMenuSync(menu.data.groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.data]);

  const qtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart.lines) {
      if (!line.unavailable) map.set(line.menu_item_id, line.qty);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines]);

  // Trang này dùng chung `index.html` với trang đặt hàng (một bundle, chọn theo tên miền),
  // nên tiêu đề tab phải sửa ở đây — nếu không khách lưu trang lại thấy chữ "Đặt hàng".
  useEffect(() => {
    const previous = document.title;
    document.title = 'Menu — Quán Bà Lùn';
    return () => {
      document.title = previous;
    };
  }, []);

  /**
   * Nhuộm tối nền của CẢ TÀI LIỆU, không chỉ khung trang.
   *
   * `body` mang nền kem `--bg-page` dùng chung cho toàn app. Khung menu cao `100dvh` nhưng
   * quanh nó vẫn hở ra vài pixel kem (thanh cuộn, vùng nảy khi cuộn quá đà trên iOS, mép
   * làm tròn của cửa sổ) — đúng cái "viền trắng xung quanh" chủ quán thấy. Đặt bằng JS chứ
   * không bằng CSS `body:has(...)`: cách này chắc chắn trả lại nguyên trạng khi rời trang,
   * và không phụ thuộc `:has` của trình duyệt cũ.
   */
  useEffect(() => {
    const { body, documentElement: html } = document;
    const prev = { body: body.style.background, html: html.style.background };
    body.style.background = 'var(--menu-chrome)';
    html.style.background = 'var(--menu-chrome)';
    return () => {
      body.style.background = prev.body;
      html.style.background = prev.html;
    };
  }, []);

  // ── Đo vùng trang để biết lưới mấy cột mấy dòng ────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState<BookGrid>(() => computeGrid(360));
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const next = computeGrid(rect.width);
      // So từng trường thay vì thay object mù quáng: `ResizeObserver` bắn cả khi kích thước
      // lệch một phần pixel (thanh địa chỉ Safari trượt lên xuống lúc cuộn), mà mỗi lần đổi
      // state ở đây là một lần vẽ lại toàn bộ trang.
      setGrid((cur) => (cur.spread === next.spread && cur.roomy === next.roomy ? cur : next));
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
  /**
   * NỀN TRANG MENU — kem sáng (bảng màu hướng A, chủ quán chốt 2026-09-16).
   *
   * Bản trước là một tấm ĐÁ PHIẾN ĐEN dựng rất công: ảnh `/menu-bg.jpg` (nếu chủ quán đặt
   * file vào) chồng lớp phủ tối, thớ đá chạy ngang, lá húng quế / cà chua bi / vụn muối vẽ
   * bằng SVG có bóng đổ. Tất cả đã bỏ cùng lúc đổi sang nền sáng: mọi lớp trong đó đều
   * được cân đo để chữ TRẮNG đọc được trên nền TỐI, đặt nguyên lên nền kem thì vừa sai
   * hướng sáng vừa dìm luôn ảnh món.
   * ⚠ Nếu chủ quán muốn nền ảnh thật trở lại thì phải dựng lại cho nền sáng, KHÔNG phải
   *   lấy lại khối cũ trong git — nó giả định nền tối ở từng con số alpha.
   *
   * Vẫn giữ một chút chiều sâu chứ không phẳng lì, vì lời chê cũ của chủ quán
   * ("background chỉ 1 màn, không có tương phản", 2026-09-04) vẫn đúng với nền phẳng:
   *   1. vệt sáng rất nhạt lệch trên-trái → nguồn sáng, cho mặt kem có hướng;
   *   2. ấm dần xuống đáy                 → trang có bề dày, chân trang lún xuống.
   * Màu nhóm KHÔNG còn nhuộm cả trang: trên nền sáng thì nhuộm nền là bạc màu cả màn, nên
   * nhận diện nhóm giờ dồn hết vào chip trên dải nhóm.
   */
  const pageBgOf = (_code: string) =>
    [
      'radial-gradient(78% 44% at 30% 4%, rgb(255 255 255 / 70%), transparent 70%)',
      'linear-gradient(rgb(255 255 255 / 0%), rgb(42 29 20 / 3%) 72%, rgb(42 29 20 / 6%))',
      'var(--menu-chrome)',
    ].join(', ');

  // ── Dựng danh sách trang ───────────────────────────────────────────────────────────
  // Quyển menu KHÔNG có tìm kiếm (chủ quán, 2026-09-04): dải nhóm là đường đi duy nhất.
  // Một ô gõ chữ trên trang này là một dải nữa chiếm chỗ của món.
  const pages = useMemo(() => paginateGroups(groups), [groups]);

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
    const at = findPageOfItem(pages, was?.items[0]?.id ?? null);
    const aligned = grid.spread ? at - (at % 2) : at;
    setIndex(Math.min(aligned, Math.max(0, pages.length - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  const page = pages[index];
  const total = pages.length;

  /**
   * Trang mới hiện ra có chạy hiệu ứng "món hiện ra so le" không.
   *
   * TẮT sau mỗi cú lật: lúc đó tờ giấy đã quay xong và trang mới ĐANG NẰM SẴN trước mắt
   * khách rồi — cho các ô mờ đi rồi hiện lại lần nữa là một cú nháy vô nghĩa. Chỉ BẬT khi
   * trang xuất hiện mà không qua cú lật nào: lần tải đầu, bấm chip nhóm, đổi từ khoá tìm.
   */
  const [animateCards, setAnimateCards] = useState(true);

  /**
   * Nhóm khách vừa bấm trên dải chip — chỉ để biết chip nào sáng, không ảnh hưởng trang nào
   * đang mở. Xoá ngay khi khách LẬT (lật là họ tự đi tiếp, lúc đó nhóm của trang trái mới
   * là câu trả lời đúng) hoặc khi nhóm đó không còn nằm trong hai trang đang mở.
   */
  const [focusGroup, setFocusGroup] = useState<string | null>(null);

  /**
   * Bảng "tất cả nhóm". Quán có 32 nhóm — đo được dải chip dài 4088px trên màn 359px, tức
   * dài GẤP 11 LẦN màn hình. Vuốt ngang 11 màn để tìm một nhóm là không dùng được, và
   * thanh cuộn lại bị ẩn nên phần lớn khách còn không biết là vuốt được.
   */
  const [allGroups, setAllGroups] = useState(false);

  /**
   * Bấm chip nhóm → đổi nhóm đang xem. Sau khi bỏ cơ chế lật (2026-09-16) thì đây là cách
   * DUY NHẤT đi giữa các nhóm, nên nó cũng là thứ giữ cho DOM chỉ có một nhóm mỗi lúc.
   *
   * Phần canh-về-trang-chẵn của chế độ mở sách hai trang đã bỏ cùng cơ chế lật: giờ một
   * nhóm là một màn cuộn, không còn "tờ giấy gồm trang chẵn + trang lẻ" nào để canh.
   */
  const jumpTo = useCallback(
    (target: number) => {
      setFocusGroup(pages[target]?.group.code ?? null);
      if (target === index) return;
      setAnimateCards(true);
      setIndex(Math.min(Math.max(0, target), Math.max(0, total - 1)));
      // Nhóm mới bắt đầu từ đầu danh sách, không giữ chỗ cuộn của nhóm trước.
      viewportRef.current?.scrollTo({ top: 0 });
    },
    [index, total, pages],
  );


  /**
   * Chip nào đang sáng.
   *
   * Một trang là một nhóm, nên mở sách là ĐANG XEM HAI NHÓM cùng lúc — câu hỏi "đang ở nhóm
   * nào" có hai câu trả lời đúng. Luật: nếu khách vừa bấm một chip và nhóm đó đang hiện ở
   * một trong hai trang thì sáng chip đó (họ vừa nói họ muốn tới đâu); còn lại thì lấy nhóm
   * của trang TRÁI, vì mắt đọc từ trái sang.
   */
  const visibleCodes = [page?.group.code, grid.spread ? pages[index + 1]?.group.code : undefined];
  const activeGroupCode =
    focusGroup !== null && visibleCodes.includes(focusGroup)
      ? focusGroup
      : (page?.group.code ?? null);

  /**
   * Dải chip nhóm phải TỰ CUỘN theo nhóm đang xem. Quán có nhiều nhóm hơn bề ngang màn
   * hình, nên lật vài trang là chip của nhóm đang xem trôi ra ngoài khung: khách thấy một
   * dải chip không chip nào đỏ và mất luôn mốc "mình đang ở đâu".
   *
   * Tính tay `scrollLeft` chứ không gọi `scrollIntoView`: hàm đó cuộn cả những khung cha,
   * tức là kéo lệch cả trang trên iOS. Đây chỉ động vào đúng một trục cuộn của dải chip.
   */
  const railRef = useRef<HTMLDivElement>(null);
  const railSyncedRef = useRef(false);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || activeGroupCode === null) return;
    // Quét con thay vì `querySelector`: mã nhóm do chủ quán tự đặt, ký tự lạ trong đó là
    // một selector sai chứ không phải một lỗi thấy được.
    const chipEl = Array.from(rail.children).find(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && el.dataset.groupChip === activeGroupCode,
    );
    if (!chipEl) return;
    const target = chipEl.offsetLeft - (rail.clientWidth - chipEl.offsetWidth) / 2;
    const left = Math.max(0, Math.min(target, rail.scrollWidth - rail.clientWidth));
    if (Math.abs(left - rail.scrollLeft) < 1) return;
    // Lần đầu mở trang thì đặt thẳng — không ai cần xem một cú cuộn lúc trang vừa hiện.
    rail.scrollTo({ left, behavior: railSyncedRef.current ? 'smooth' : 'auto' });
    railSyncedRef.current = true;
  }, [activeGroupCode]);

  /**
   * Lật trang xong thì ĐƯA MÀN HÌNH VỀ ĐẦU. Bản thân quyển menu cao đúng `100dvh` và
   * không cuộn, nhưng trên Safari/Chrome mobile cả trang vẫn bị đẩy lệch khỏi mốc 0 sau
   * khi thanh địa chỉ co lại, hoặc sau khi bàn phím của ô tìm món đóng vào — khi đó dải
   * chip nhóm nằm khuất trên mép máy và trang trông như bị cắt đầu.
   */
  useEffect(() => {
    if (typeof window !== 'undefined' && window.scrollY !== 0) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    // Thứ CUỘN THẬT là từng tờ giấy (`overflowY: auto`), không phải cửa sổ. Tờ không bị
    // React dựng lại khi đổi trang nên nó GIỮ NGUYÊN chỗ cuộn cũ: đang đọc giữa nhóm Ốc
    // mà lật sang nhóm Bia là rơi thẳng vào giữa nhóm Bia, tưởng nhóm đó chỉ có mấy món
    // cuối. Đưa cả chồng tờ về đầu — kể cả tờ đang chờ lộ ra ở lượt sau.
    const leaves = viewportRef.current?.querySelectorAll<HTMLElement>('[data-page-slot]');
    leaves?.forEach((leaf) => {
      if (leaf.scrollTop !== 0) leaf.scrollTop = 0;
    });
  }, [index]);



  /** Dựng một tờ giấy. `layer` quyết định nó đậu ở đâu và có bấm được không. */
  /**
   * Nội dung MỘT trang — bìa ảnh lớn hoặc lưới món. Tách riêng vì cùng một trang có thể
   * xuất hiện ở ba chỗ khác nhau: tờ giấy đơn (điện thoại), một nửa của trang đôi, hoặc
   * một MẶT của tờ giấy đôi mặt (máy tính). Ba chỗ khác nhau về khung, giống hệt nhau về
   * ruột — nhân bản ra ba bản là ba chỗ để quên sửa.
   */
  const renderPageBody = (p: BookPage, at: number, eager: boolean, animate: boolean) => (
    <div key={at} style={pageList}>
      {p.items.map((item, i) => (
        <BookCard
          key={item.id}
          item={item}
          roomy={grid.roomy}
          index={i}
          eager={eager}
          animate={animate}
          onOpen={(it, from) => setPreview({ item: it, from })}
          qtyInCart={qtyById.get(item.id) ?? 0}
          onAdd={(it) =>
            cart.add(
              {
                menu_item_id: it.id,
                code: it.code,
                name: it.name,
                unit_price: it.price,
                note: null,
                image: it.images[0] ?? null,
              },
              1,
            )
          }
          onSetQty={(it, qty) => cart.setQty(it.id, qty)}
        />
      ))}
    </div>
  );
  return (
    <div style={shell} className="book-shell">
      <style>{BOOK_CARD_CSS}</style>
      <style>{BOOK_PREVIEW_CSS}</style>
      <style>{BOOK_PAGE_CSS}</style>

      {/* Thanh trên NỔI trên quyển sách chứ không đứng thành một dải riêng: trang cuộn
          xuyên qua nó, ảnh món đi ngang phía sau. Cùng lẽ với chân trang — cả dải KHÔNG có
          nền, chỉ từng chip tự mang màu nhóm của nó, nên nhìn xuyên qua thấy trọn món. */}
      <div style={topBar}>
        {/* Dải nhóm: với ~600 món thì đây mới là đường đi chính, không phải vuốt 50 lần. */}
        {groups.length > 1 && (
          <nav style={rail} aria-label="Nhảy tới nhóm món">
            {/* Nút "⋯" nằm NGOÀI dải cuộn, không nổi đè lên nó.
                Đặt absolute lên trên dải là chip cuộn tới sẽ chạy xuống dưới nút và bị che
                mất chữ (đã thấy trên máy thật) — `padding-right` chỉ chừa chỗ ở CUỐI danh
                sách chứ không chừa ở mép đang nhìn. */}
            <div style={railWrap}>
              <div ref={railRef} style={railInner} className="book-rail">
              {groups.map((g) => {
                const active = g.code === activeGroupCode;
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-group-chip={g.code}
                    onClick={() => jumpTo(findFirstPageOfGroup(pages, g.code))}
                    aria-current={active ? 'true' : undefined}
                    // Chip nghỉ TRONG SUỐT: màu nhóm chuyển từ NỀN sang VIỀN + CHỮ, nên ảnh
                    // món phía sau vẫn thấy trọn mà mắt vẫn nối được "chip vàng nghệ" với
                    // "trang vàng nghệ". Chip ĐANG XEM vẫn là khối đỏ đặc — giữa 32 chip rỗng
                    // thì một khối đặc mới nói được "bạn đang ở đây", viền đậm hơn không đủ.
                    /**
                     * Chip nghỉ dùng ĐÚNG màu trong `chip`, không nhuộm theo nhóm nữa.
                     *
                     * Trước đây mỗi chip mang màu pastel riêng của nhóm để mắt nối được
                     * "chip vàng nghệ" với "trang vàng nghệ". Từ 2026-09-16 nền trang
                     * không còn nhuộm theo nhóm (nền kem chung), nên sợi dây đó đứt — mà
                     * bộ pastel ấy vốn vẽ cho nền gỗ TỐI, đặt lên nền kem thì chữ gần như
                     * tàng hình (đã thấy trên máy thật).
                     */
                    style={active ? { ...chip, ...chipActive } : chip}
                    className={active ? undefined : 'book-glass-chip'}
                  >
                    {g.icon ? `${g.icon} ` : ''}
                    {g.name}
                  </button>
                );
              })}
              </div>

                {/* Bóng mờ mép phải: dấu hiệu duy nhất cho biết dải chip còn cuộn tiếp.
                    Thiếu nó thì chip cuối bị cắt gọn ở mép, trông như đã hết nhóm. */}
                <div aria-hidden="true" style={railFade} />
              </div>

              <button
                type="button"
                onClick={() => setAllGroups(true)}
                style={allBtn}
                aria-label={`Xem tất cả ${groups.length} nhóm món`}
              >
                ⋯
              </button>
          </nav>
        )}
      </div>

      {/* Vùng đọc: CUỘN DỌC trong MỘT nhóm.
          Trước 2026-09-16 đây là quyển sách lật trang (3 tờ giấy chồng nhau, `rotateY`,
          vuốt để lật). Chủ quán bỏ cơ chế lật. Nhưng LÝ DO của nó thì vẫn còn nguyên —
          quán 552 món / 27 nhóm, dựng hết vào DOM là điện thoại tầm trung đứng hình — nên
          cái được giữ lại là: MỖI LẦN CHỈ DỰNG MỘT NHÓM. Chip trên dải nhóm đổi nhóm,
          trong nhóm thì cuộn dọc. Nhóm to nhất là 51 món, thừa sức.
          ⚠ Đừng đổi thành cuộn liền mạch cả 27 nhóm — đó đúng là thứ đã phải né. */}
      <div ref={viewportRef} style={viewport} className="book-view">
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
          <p style={notice}>Menu đang được cập nhật, mời bạn quay lại sau.</p>
        )}

        {page && renderPageBody(page, index, true, animateCards)}
      </div>

      {/* Chân trang đã bỏ hẳn (2026-09-16): hai nút lật trang đi cùng cơ chế lật, rồi chủ
          quán bỏ luôn cả logo quán ở giữa. Trạng thái "đang ở nhóm nào" cho trình đọc màn
          hình dời lên chính dải chip, nơi chip đang xem đã mang `aria-current`. */}

      {preview && (
        <BookDishPreview
          item={preview.item}
          from={preview.from}
          onClose={() => setPreview(null)}
        />
      )}

      {/* Thanh gọi món dính đáy — CHỈ hiện khi giỏ có món hoặc đang có mã còn hiệu lực.
          Hiện sẵn một thanh rỗng là chiếm mất một dải đáy màn hình của quyển menu, đúng chỗ
          ngón tay đặt để vuốt lật trang. */}
      {sheet === 'none' && total > 0 && (
        <div style={orderBar}>
          {activeCode !== null && (
            <button
              type="button"
              style={activeCode.accepted ? tableChip : codeChip}
              onClick={() => setSheet('code')}
            >
              {activeCode.accepted ? 'Món bàn đã gọi' : `Mã ${activeCode.code}`}
            </button>
          )}
          {cart.count > 0 ? (
            <button type="button" style={cartCta} onClick={() => setSheet('cart')}>
              <span>Xem {cart.count} món</span>
              <span>{formatVnd(cart.subtotal)}</span>
            </button>
          ) : (
            activeCode === null && (
              /**
               * CÂU HƯỚNG DẪN — thiếu nó thì không có gì nói với khách rằng trang này gọi
               * được món.
               *
               * Chủ quán mở trang, thấy quyển menu đẹp, và hỏi "menu để khách gọi đồ đâu"
               * (2026-09-11) — dù 77 nút cộng đang hiện ngay trên màn. Một nút tròn không
               * tự giải thích được chức năng; phải có một câu.
               *
               * Nằm ĐÚNG chỗ của thanh giỏ và biến mất ngay khi khách cộng món đầu tiên:
               * hướng dẫn chỉ cần thiết trước lần bấm đầu, sau đó nó là tiếng ồn. Nhờ dùng
               * chung một chỗ mà bố cục không đổi khi thanh giỏ thay thế nó.
               */
              <p style={orderHint}>Bấm ＋ để gọi món — nhân viên sẽ tới xác nhận</p>
            )
          )}
        </div>
      )}

      {allGroups && (
        <div
          style={groupsOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Tất cả nhóm món"
          onClick={() => setAllGroups(false)}
        >
          <div style={groupsSheet} onClick={(e) => e.stopPropagation()}>
            <div style={groupsHead}>
              <p style={groupsTitle}>Tất cả nhóm món</p>
              <button
                type="button"
                onClick={() => setAllGroups(false)}
                aria-label="Đóng"
                style={groupsClose}
              >
                ✕
              </button>
            </div>
            {/* Lưới 2 cột: 32 nhóm xếp một cột là một dải dài phải cuộn tiếp, xếp hai cột
                thì gần như lọt hết trong một màn. */}
            <div style={groupsGrid}>
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    jumpTo(findFirstPageOfGroup(pages, g.code));
                    setAllGroups(false);
                  }}
                  aria-current={g.code === activeGroupCode ? 'true' : undefined}
                  style={
                    g.code === activeGroupCode
                      ? { ...groupsItem, ...groupsItemActive }
                      : groupsItem
                  }
                >
                  {g.icon ? `${g.icon} ` : ''}
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {sheet === 'cart' && (
        <DineInCartSheet
          lines={cart.lines}
          subtotal={cart.subtotal}
          count={cart.count}
          onSetQty={cart.setQty}
          onSetNote={cart.setNote}
          onClose={() => setSheet('none')}
          onCodeCreated={(code, expires_at) => {
            setActiveCode({ code, expires_at, accepted: false });
            setSheet('code');
          }}
        />
      )}

      {sheet === 'code' && activeCode !== null && (
        <DineInCodeSheet
          code={activeCode.code}
          expiresAt={activeCode.expires_at}
          initialState={activeCode.accepted ? 'USED' : 'ACTIVE'}
          onAccepted={() => setActiveCode((c) => (c === null ? c : { ...c, accepted: true }))}
          onClose={() => setSheet('none')}
          onEdit={() => {
            // Mã đã bị huỷ ở BE — bỏ khỏi màn rồi mở lại giỏ để khách sửa.
            setActiveCode(null);
            setSheet('cart');
          }}
        />
      )}
    </div>
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

/*
 * ── NỀN SÁNG (hướng A, chủ quán chốt 2026-09-16) ────────────────────────────────────
 * Bản trước là một bố cục TỐI rất dày: vignette đen 52%, vầng đèn hổ phách, ánh lạnh góc
 * phải, vệt đỏ góc dưới, cộng hai lớp vân ở ::before/::after — tất cả cân đo để chữ TRẮNG
 * đọc được. Nền giờ là kem, chữ là than, nên mọi con số alpha đó đều sai dấu: cứ giữ lại
 * là ra một màn kem bị bôi xám.
 *
 * Bản sáng giữ đúng hai việc còn ý nghĩa: một nguồn sáng lệch trên-trái cho mặt kem có
 * hướng, và ấm dần xuống đáy để màn có bề dày. Không vân, không vignette.
 */
.book-shell {
  isolation: isolate;
  background:
    radial-gradient(96% 60% at 28% -8%, rgb(255 255 255 / 85%), transparent 66%),
    radial-gradient(80% 50% at 108% 104%, rgb(240 168 30 / 12%), transparent 62%),
    linear-gradient(rgb(255 255 255 / 0%), rgb(42 29 20 / 4%) 78%, rgb(42 29 20 / 8%)),
    var(--menu-chrome);
}

/*
 * Hai thanh nổi (dải chip trên, chân trang dưới). Nền TRẮNG mờ + làm mờ thứ đằng sau, để
 * ảnh món trôi qua bên dưới vẫn thấy mà chữ than vẫn đọc được. Bản tối cũ dùng
 * rgb(22 18 15 / 34%) — trên nền kem thì đó là một dải xám bẩn vắt ngang màn.
 *
 * '-webkit-backdrop-filter' phải viết kèm — Safari (kể cả bản mới) vẫn cần tiền tố. Máy
 * không hỗ trợ thì rơi về khối @supports: đục hơn để chữ không bao giờ nằm trên ảnh trần.
 */
.book-glass {
  background: rgb(251 242 226 / 62%);
  -webkit-backdrop-filter: blur(18px) saturate(1.1);
  backdrop-filter: blur(18px) saturate(1.1);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .book-glass {
    background: rgb(251 242 226 / 92%);
  }
}

/* Chip nhóm lúc nghỉ đã có nền trắng đặc (xem style \`chip\`), nên lớp kính dưới chân chỉ
   còn để làm mềm mép khi chip trôi ngang qua một tấm ảnh sáng. */
.book-glass-chip {
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

/* Thanh cuộn của vùng đọc: mảnh và ẤM. Mặc định của macOS/Windows là một vệt tối nằm đúng
   mép phải — trên nền kem nó đọc ra như một viền bẩn, không như thanh cuộn. */
.book-view {
  scrollbar-width: thin;
  scrollbar-color: rgb(42 29 20 / 20%) transparent;
}
.book-view::-webkit-scrollbar { width: 8px; }
.book-view::-webkit-scrollbar-track { background: transparent; }
.book-view::-webkit-scrollbar-thumb {
  background: rgb(42 29 20 / 18%);
  border-radius: 999px;
}
`;

const shell: CSSProperties = {
  // `100dvh` chứ không `100vh`: trên Safari iOS, `100vh` tính theo màn hình lúc thanh địa
  // chỉ đã thu lại, nên chân trang (nút lật) bị đẩy khuất dưới mép máy đúng lúc mới mở.
  height: '100dvh',
  // Mốc định vị của hai thanh kính (`topBar`, `footer`) — chúng nằm ngoài luồng layout.
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  // Nền do '.book-shell' trong CSS lo (nhiều lớp gradient + vân) — để ở đây thì style
  // inline đè mất lớp CSS.
  color: 'var(--text-body)',
  fontFamily: 'var(--font-body)',
  overflow: 'hidden',
  paddingTop: 'var(--safe-top)',
  paddingBottom: 'var(--safe-bottom)',
};

/**
 * Thanh kính phía trên: logo + ô tìm món + dải nhóm. `position: absolute` nên nó KHÔNG
 * chiếm chiều cao của quyển sách — trang cao hết màn hình và chạy ngay dưới lớp kính.
 */
const topBar: CSSProperties = {
  position: 'absolute',
  top: 'var(--safe-top)',
  left: 0,
  right: 0,
  zIndex: 4,
};

const rail: CSSProperties = {
  flex: 'none',
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  paddingRight: 'var(--gutter)',
};

const railInner: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-3)',
  overflowX: 'auto',
  padding: 'var(--sp-2) var(--sp-3) var(--sp-2) var(--gutter)',
  WebkitOverflowScrolling: 'touch',
};

/**
 * Bóng mờ mép phải dải chip. `pointerEvents: none` để nó không ăn mất cú vuốt.
 *
 * Phải chuyển từ TRONG SUỐT sang đúng màu nền màn (`--menu-chrome`), không phải sang trắng:
 * nền quyển menu là kem, chuyển sang trắng thì ra một vệt sáng rõ mồn một ở mép.
 */
/** Khung bọc dải chip: mốc định vị cho bóng mờ, và là phần co giãn của hàng. */
const railWrap: CSSProperties = {
  position: 'relative',
  flex: '1 1 auto',
  minWidth: 0,
};

const railFade: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 72,
  pointerEvents: 'none',
  zIndex: 1,
  background: 'linear-gradient(90deg, transparent, var(--menu-chrome) 62%)',
};

/** Nút mở bảng tất cả nhóm — đậu trên bóng mờ, sát mép phải dải chip. */
const allBtn: CSSProperties = {
  flex: 'none',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  borderRadius: '50%',
  border: 'none',
  background: 'var(--menu-surface)',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-lg)',
  lineHeight: 1,
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
  boxShadow: '0 2px 8px rgb(42 29 20 / 10%)',
};

const groupsOverlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 30,
  background: 'rgba(42,29,20,0.45)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: 'var(--sp-3)',
};

const groupsSheet: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: 520,
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--menu-chrome)',
  borderRadius: 'var(--r-card)',
  border: '1px solid var(--menu-line)',
  boxShadow: '0 -8px 40px rgb(42 29 20 / 22%)',
};

const groupsHead: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--sp-3) var(--sp-4)',
  borderBottom: '1px solid var(--menu-line)',
};

const groupsTitle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--menu-text)',
};

const groupsClose: CSSProperties = {
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  border: 'none',
  background: 'transparent',
  color: 'var(--menu-text-muted)',
  fontSize: 'var(--fs-md)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  padding: 0,
};

const groupsGrid: CSSProperties = {
  overflowY: 'auto',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-3) var(--sp-4) var(--sp-4)',
};

const groupsItem: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-3)',
  display: 'flex',
  alignItems: 'center',
  textAlign: 'left',
  borderRadius: 'var(--r-badge)',
  border: 'none',
  background: 'rgb(42 29 20 / 5%)',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const groupsItemActive: CSSProperties = {
  background: 'var(--menu-accent)',
  color: 'var(--menu-accent-ink)',
  fontWeight: 'var(--fw-semibold)',
};

const chip: CSSProperties = {
  flex: 'none',
  // To hơn bản đầu (6px/--fs-sm): đây là đường đi CHÍNH của cả quyển menu, ngón tay phải
  // bấm trúng ngay lần đầu trên xe bus, không phải nhắm.
  // 44px cao, chữ nhỏ hơn một nấc — theo bản duyệt. Bản trước cao 40 nhưng chữ `--fs-base`
  // đậm, nên dải chip đọc ra nặng hơn cả tên món.
  padding: '0 var(--sp-4)',
  minHeight: 'var(--tap-min)',
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 'var(--r-badge)',
  /**
   * Chip NGHỈ: nền TRONG SUỐT, viền than pha loãng — đúng bản duyệt.
   *
   * Tôi từng để nền trắng đặc vì sợ viền kem trên nền kem mất hình. Sai ở chỗ chọn màu
   * viền chứ không ở chỗ nền: viền `--menu-line` (#e8dcc4) đúng là chìm, nhưng than pha
   * loãng 12% thì nổi rõ mà vẫn nhẹ. Nền trắng đặc biến dải nhóm thành một hàng khối trắng
   * nặng, giành mắt với thẻ món phía dưới.
   */
  /**
   * KHÔNG VIỀN (chủ quán chốt 2026-09-16 — "bỏ cái border viền đen đó đi").
   *
   * Bỏ viền mà để nền trong suốt thì chip mất hẳn hình dáng, còn lại mấy chữ rời trôi trên
   * nền kem. Nên hình dáng chuyển sang một mảng nền đậm hơn nền màn đúng một nấc: vẫn đọc
   * ra là "cái bấm được", mà không có đường kẻ nào.
   */
  border: 'none',
  background: 'rgb(42 29 20 / 5%)',
  color: 'var(--menu-text-muted)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'var(--font-body)',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const chipActive: CSSProperties = {
  // `--menu-accent` (#ce3b23, đỏ lửa của quyển menu) chứ KHÔNG phải `--brand-600` (#b82a1e,
  // đỏ thương hiệu của web đặt hàng). Hai đỏ này lệch nhau đủ để đặt cạnh giá tiền là thấy
  // gợn; bảng màu quyển menu có đỏ riêng của nó.
  background: 'var(--menu-accent)',
  borderColor: 'var(--menu-accent)',
  color: 'var(--menu-accent-ink)',
  fontWeight: 'var(--fw-semibold)',
};

const viewport: CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: 'relative',
  /**
   * CUỘN DỌC. Trước 2026-09-16 đây là khung cắt của chồng tờ giấy 3D: `overflow: hidden`
   * cộng `perspective` cộng `transform-style: preserve-3d`. Bỏ cơ chế lật thì cả ba thứ đó
   * đi theo — giữ `perspective` lại sẽ làm mọi `transform` bên trong (ảnh nhấc lên khi rê
   * chuột) bị chiếu phối cảnh một cách vô cớ.
   */
  overflowY: 'auto',
  overflowX: 'hidden',
  WebkitOverflowScrolling: 'touch',
  // Đệm trên chừa chỗ cho dải chip nhóm (nổi, `position: absolute`), đệm dưới chừa chỗ cho
  // thanh giỏ + chân trang; thiếu là món cuối bị hai thanh đó che.
  padding: 'calc(var(--safe-top) + 64px) var(--gutter) calc(var(--safe-bottom) + 132px)',
};



/* ── Chế độ hai trang ──────────────────────────────────────────────────────────────── */

/** Một nửa tĩnh của trang đôi (trang sẽ lộ ra khi nhấc tờ giấy lên). */
const spreadHalf: CSSProperties = {
  position: 'absolute',
  top: 0,
  width: '50%',
  height: '100%',
  padding: '0 var(--gutter)',
  boxSizing: 'border-box',
  overflow: 'hidden',
};

/**
 * Tờ giấy đôi mặt. Chiếm NỬA PHẢI và xoay quanh mép trái của chính nó — mép đó nằm đúng
 * giữa màn, tức là gáy sách. Quay 180° là nó úp gọn sang nửa trái, không lệch một pixel.
 *
 * `transformStyle: preserve-3d` là bắt buộc: thiếu nó, hai mặt bị bẹp về cùng một mặt
 * phẳng và mặt sau hiện đè lên mặt trước ngay từ 0°.
 */

/** Một mặt của tờ giấy đôi mặt. Mặt sau được lật sẵn 180° nên khi cả tờ quay 180° thì nó
 *  về đúng chiều đọc (180 + 180 = 360). */

/** Gáy sách — vệt tối hẹp ở chính giữa, đậm nhất tại đường gấp. */
const spine: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 'calc(50% - 22px)',
  width: 44,
  pointerEvents: 'none',
  background:
    'linear-gradient(90deg, rgb(0 0 0 / 0%) 0%, rgb(0 0 0 / 26%) 46%, rgb(0 0 0 / 42%) 50%, rgb(0 0 0 / 26%) 54%, rgb(0 0 0 / 0%) 100%)',
};

/**
 * Bóng đổ trên tờ giấy đang xoay: đậm dần về phía mép ngoài, và đậm dần theo góc quay.
 *
 * Đây là chi tiết biến "một hình chữ nhật xoay quanh trục" thành "một tờ giấy đang được lật"
 * — mắt đọc ra chiều sâu từ bóng, không phải từ phép biến hình. Là một lớp phủ riêng chứ
 * không phải `filter: brightness()`: filter buộc trình duyệt vẽ lại cả tờ mỗi frame, còn
 * lớp phủ này chỉ đổi `opacity`, chạy thẳng trên compositor.
 */

/**
 * Danh sách món của một trang. MỘT CỘT, không phải lưới: bố cục so le chỉ đọc ra được khi
 * mỗi món chiếm trọn bề ngang và ảnh đổi bên qua từng dòng. Xếp 2 cột là hai cái zigzag
 * chạy song song, mắt không bám được cái nào.
 *
 * `maxWidth` chặn dòng món dài ngoẵng trên màn rộng: một dòng chữ quá dài thì mắt trượt
 * mất hàng (rule line-length trong tokens.css). Trang đôi mỗi nửa đã hẹp sẵn nên chặn này
 * chỉ có tác dụng ở chế độ một trang trên máy tính.
 */
const pageList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  maxWidth: 720,
  margin: '0 auto',
  /**
   * KHÔNG có đệm ở đây. Trước 2026-09-16 mỗi tờ giấy là một khung cuộn riêng nên danh sách
   * phải tự chừa chỗ cho dải chip trên và hai nút lật dưới. Giờ chỉ còn MỘT khung cuộn
   * (`viewport`) và chỗ chừa đã nằm ở đó — để cả hai nơi cùng chừa là hở một dải trống gần
   * 150px ngay đầu màn.
   */
};


/**
 * Thanh gọi món, nổi NGAY TRÊN chân trang chứ không thay chỗ nó.
 *
 * Chân trang mang hai mũi tên lật trang + logo. Đè lên đó là lấy mất cách lật trang trên
 * máy tính (nơi không vuốt được), nên thanh này đẩy lên trên một khoảng bằng chiều cao chân
 * trang. `pointerEvents: 'none'` ở vỏ + `'auto'` ở nút: khoảng trống hai bên thanh vẫn vuốt
 * lật trang được, chỉ đúng cái nút là bấm.
 */
/**
 * Chip "Món bàn đã gọi" — ĐỎ ĐẶC, khác hẳn `codeChip` kem ở ngay trên.
 *
 * Hai chip này không cùng việc nên không được cùng màu:
 *
 *  - `codeChip` (kem, viền mảnh) là thứ ĐANG CHỜ — 5 chữ số để khách đọc cho nhân viên. Nó
 *    đứng cạnh thanh giỏ vàng, và cái vàng đó mới là hành động chính lúc ấy, nên chip phải
 *    lùi về sau.
 *  - Chip này là thứ ĐÃ XONG, và sau khi nhân viên nhận thì giỏ đã được dọn — nó thường là
 *    thứ DUY NHẤT còn lại trên thanh. Một viên kem trên nền kem thì không ai nhận ra đó là
 *    nút bấm được (chủ quán 2026-09-16).
 *
 * Dùng `--menu-accent` chứ không phải `--menu-price`: đây là NỀN, mà cặp `--menu-accent` +
 * `--menu-accent-ink` là cặp duy nhất trong bảng màu đã đo cho chữ trắng trên nền đỏ
 * (4.91:1 ✓AA). `--menu-price` sinh ra để làm MÀU CHỮ trên nền kem — mượn nó làm nền là đi ra
 * ngoài con số đã đo. Cùng đỏ với nút "Sinh mã cho nhân viên", nên khách đọc ra ngay là cùng
 * một mạch việc.
 *
 * Bóng đổ cùng công thức thanh giỏ, đổi sang sắc đỏ: nó là thứ nhấc chip khỏi nền gỗ khi thanh
 * chỉ còn một mình nó.
 */
const tableChip: CSSProperties = {
  pointerEvents: 'auto',
  minHeight: 48,
  padding: '0 var(--sp-4)',
  borderRadius: 999,
  border: 'none',
  background: 'var(--menu-accent)',
  color: 'var(--menu-accent-ink)',
  boxShadow: '0 4px 16px rgb(206 59 35 / 34%)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const orderBar: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 'calc(var(--safe-bottom) + 56px)',
  zIndex: 5,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--sp-2)',
  padding: '0 var(--gutter)',
  pointerEvents: 'none',
};

const cartCta: CSSProperties = {
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  minHeight: 48,
  maxWidth: 420,
  flex: 1,
  padding: '0 var(--sp-4)',
  borderRadius: 999,
  border: 'none',
  background: 'var(--menu-cta)',
  // Nền vàng bia → chữ THAN. Chữ trắng trên nền này chỉ được 2.03:1, gần như không đọc được.
  color: 'var(--menu-cta-ink)',
  boxShadow: '0 4px 16px rgb(240 168 30 / 38%)',
  fontSize: 'var(--fs-md)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

/** Câu hướng dẫn trước lần cộng món đầu tiên. Có `background` riêng vì nền trang là ảnh gỗ
 *  tối nhiều chi tiết — chữ đặt thẳng lên đó thì chỗ đọc được chỗ không. */
const orderHint: CSSProperties = {
  pointerEvents: 'none',
  margin: 0,
  padding: 'var(--sp-2) var(--sp-3)',
  borderRadius: 999,
  background: 'var(--menu-surface)',
  border: '1px solid var(--menu-line)',
  boxShadow: '0 2px 10px rgb(42 29 20 / 10%)',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  textAlign: 'center',
};

/** Lối quay lại xem mã đã sinh — khách hay đóng lớp phủ rồi lật menu tiếp trong lúc chờ
 *  nhân viên tới, và phải tìm lại được mã mà không phải sinh mã mới. */
const codeChip: CSSProperties = {
  pointerEvents: 'auto',
  minHeight: 48,
  padding: '0 var(--sp-3)',
  borderRadius: 999,
  border: '1px solid var(--menu-line)',
  background: 'var(--menu-chrome)',
  color: 'var(--menu-text)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)',
  fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const footer: CSSProperties = {
  // Nổi trên trang, không chiếm một dải chiều cao riêng — cùng lẽ với `topBar`.
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 'var(--safe-bottom)',
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  // Logo về GIỮA: hai mũi tên lật trang đã bỏ nên `space-between` chỉ còn đẩy logo dạt
  // sang mép trái, chỗ nó đè lên dòng món cuối.
  justifyContent: 'center',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-2) var(--gutter)',
  // KHÔNG có nền: cả dải ngang này trong suốt hoàn toàn, chữ và ảnh món phía sau đọc được
  // trọn vẹn. Chỉ ba vật thật sự bấm/đọc được (2 mũi tên + logo) mới tự mang một miếng
  // kính nhỏ dưới chân mình — đủ để chúng không tan vào ảnh.
  background: 'transparent',
  pointerEvents: 'none',
};

const navBtn: CSSProperties = {
  flex: 'none',
  // Chân trang tắt `pointerEvents` để trang phía sau bấm được xuyên qua; bật lại ở đúng
  // hai nút này.
  pointerEvents: 'auto',
  width: 'var(--tap-min)',
  height: 'var(--tap-min)',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 'var(--r-button)',
  border: '1px solid rgb(255 255 255 / 16%)',
  color: 'var(--menu-text)',
  cursor: 'pointer',
};



const notice: CSSProperties = {
  margin: 'var(--sp-8) auto',
  maxWidth: 'var(--measure)',
  textAlign: 'center',
  color: 'var(--menu-text-muted)',
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



import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { z } from 'zod';
import { PublicMenuGroup, type PublicMenuItem } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { MENU_BOOK_TITLE } from '../lib/page-title.ts';
import {
  DINEIN_CSS,
  TableCartSheet,
  TableConfirmSheet,
  TableEntrySheet,
  TableStateSheet,
} from '../components/DineInSheets.tsx';
import { MenuMascot } from '../components/MenuMascot.tsx';
import { useBodyScrollLock } from '../lib/body-scroll-lock.ts';
import {
  TABLE_CART_MAX_QTY,
  addTableLine,
  readTableCart,
  readTableSession,
  setTableQty,
  subscribeTableCart,
  tableCartCount,
  writeTableSession,
  type TableCartLine,
  type TableSession,
} from '../lib/table-cart-store.ts';

/**
 * M7 — THỰC ĐƠN cho khách ngồi trong quán (thay quyển menu lật trang 3D ở `/thuc-don`).
 *
 * ── Vì sao bỏ kiểu lật trang ──
 * Chủ quán xem bản dựng và chốt 2026-10-01: *"giao diện quá chật, rất khó để xem nhiều món"*.
 * Đo trên ảnh chụp bản cũ: màn 844px mà khung chiếm hơn 330px (header 2 dòng + ô tìm + dải
 * nhóm + tiêu đề nhóm + dải "Bàn N" + nút giỏ), chỉ còn chỗ cho 1,5 món. Và cử chỉ vuốt-lật
 * xung đột trực tiếp với nút thêm món: ngón tay hay bắt đầu vuốt từ đúng chỗ có nút, vuốt hụt
 * là THÊM NHẦM MÓN VÀO BILL.
 *
 * Khung mới gộp hết vào header, còn ~172px:
 *   [header 1 hàng: logo · ô tìm · chip bàn]  56px, dính
 *   [dải nhóm món lướt ngang]                 48px, dính
 *   [danh sách món — cuộn dọc]                hết chỗ còn lại
 *   [nút giỏ nổi]                             64px
 *
 * ── Màu và chữ lấy từ token THẬT của dự án ──
 * `apps/shop/src/styles/tokens.css` là nguồn sự thật duy nhất (màu rút từ 4 ảnh món thật của
 * quán, mọi tỉ lệ tương phản đã đo bằng công thức WCAG). Trang này chạy cả ở `menu.<domain>`
 * nơi KHÔNG có AppShell nạp stylesheet chung, nên các token dùng tới được khai lại ngay trong
 * `MENU_ORDER_CSS` — đổi token thì phải đổi cả hai chỗ.
 *
 * ⚠ KHÔNG `useNavigate`, KHÔNG `<Link>`, KHÔNG route mới: `main.tsx` cố ý không dựng
 *   BrowserRouter cho nhánh `menu.<domain>`. Mọi màn phụ là lớp phủ.
 */

const MenuOrderResponse = z.object({ groups: z.array(PublicMenuGroup) });

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

/** Bỏ dấu để tìm "pho" ra "Phở" — khách gõ vội không bỏ dấu. */
const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export function MenuOrderPage(): JSX.Element {
  const menu = useApi('/api/public/menu-book', MenuOrderResponse);
  const groups = menu.data?.groups ?? [];

  const [q, setQ] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [sheetItem, setSheetItem] = useState<PublicMenuItem | null>(null);

  /* ── M7 — phiên bàn + giỏ ─────────────────────────────────────────────────────────── */
  const [session, setSession] = useState<TableSession | null>(() => readTableSession());
  const [pendingSession, setPendingSession] = useState<TableSession | null>(null);
  // Chủ quán chốt 2026-10-01: vào thực đơn là PHẢI khai bàn trước, chưa khai thì không thao
  // tác tiếp được. Nên trạng thái ban đầu là 'entry' khi chưa có phiên — không phải 'none'.
  const [sheet, setSheet] = useState<'none' | 'entry' | 'cart' | 'state'>(() =>
    readTableSession() ? 'none' : 'entry',
  );
  /* Giữ CẢ GIỎ chứ không chỉ con số tổng.
   *
   * Trước đây state ở đây là `cartCount` (một số), nên card món không có cách nào biết CHÍNH
   * NÓ đang có mấy phần trong giỏ: bấm `+` xong màn hình không đổi gì, khách phải mở tấm giỏ
   * mới biết đã chọn những món nào. Trang đặt ship đã vấp đúng lỗi này và sửa từ 2026-08-05
   * (`CardItem.tsx`: "mọi phản hồi khi thêm món đều là loại hiện-rồi-tắt… `qtyInCart` là
   * trạng thái BỀN duy nhất trên chính món đó"). Màn tại bàn lặp lại y hệt — nay dùng chung
   * cách giải: số lượng nằm NGAY TRÊN CARD và ở lại đó. */
  const [cart, setCart] = useState<TableCartLine[]>(() => readTableCart());
  useEffect(() => subscribeTableCart(() => setCart(readTableCart())), []);
  const cartCount = tableCartCount(cart);
  /** Tăng mỗi lần gửi món thành công — để bé hamster ở góc phản ứng. */
  const [sentKey, setSentKey] = useState(0);
  const qtyById = useMemo(() => new Map(cart.map((l) => [l.menu_item_id, l.qty])), [cart]);

  useEffect(() => {
    document.title = MENU_BOOK_TITLE;
  }, []);

  /* Có BẤT KỲ lớp phủ nào mở thì khoá cuộn trang nền. Gom về MỘT chỗ ở đây thay vì để từng
   * tấm tự khoá: hai tấm chồng nhau (xác nhận bàn mở đè lên tấm nhập số bàn) sẽ thành hai lần
   * khoá rồi hai lần mở, mà lần mở thứ nhất đã trả vị trí cuộn trong khi tấm thứ hai còn đang
   * mở — trang nền nhảy ngay dưới lớp phủ. Một cờ gộp thì không có ca đó. */
  useBodyScrollLock(sheet !== 'none' || pendingSession !== null || sheetItem !== null);

  const applyTableName = useCallback((tableName: string) => {
    setSession((cur) => {
      if (!cur || cur.table_name === tableName) return cur;
      const next = { ...cur, table_name: tableName };
      writeTableSession(next);
      return next;
    });
  }, []);

  /* Đồng bộ MỘT LẦN lúc mở trang, không phải vòng lặp.
   *
   * Tên bàn trong máy khách có thể đã cũ từ trước khi trang được mở: nhân viên dời bàn hoặc
   * thu tiền xong trong lúc khách tắt máy. Không hỏi lại thì chip ở đầu trang in tên bàn cũ
   * suốt buổi, và khách chỉ phát hiện khi mở màn "Món của bàn" — mà phần lớn thì không mở.
   *
   * MỘT request chứ không poll: cả quán đi chung một IP (M7.R6), thêm một nhịp lặp nữa cho
   * mọi máy khách là đổi một lỗi hiển thị lấy một rủi ro 429 cho nút "Báo bếp" của nhân viên. */
  useEffect(() => {
    const token = session?.guest_token;
    if (!token) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/public/table/state', { headers: { 'X-Guest-Token': token } });
        const json = (await res.json()) as {
          data?: { table_name: string };
          error?: { code: string };
        };
        if (!alive) return;
        if (json.error?.code === 'SESSION_ENDED') {
          // Bàn đã thanh toán / bị niêm. Giữ phiên chết lại là chip khoe một bàn không còn
          // của khách nữa, và mọi thao tác sau đó đều hỏng.
          writeTableSession(null);
          setSession(null);
          setSheet('entry');
          return;
        }
        if (json.data?.table_name) applyTableName(json.data.table_name);
      } catch {
        /* mất mạng lúc mở trang — tên cũ vẫn dùng được, nhịp sau người dùng tự mở lại */
      }
    })();
    return () => {
      alive = false;
    };
    // Chỉ chạy lại khi ĐỔI phiên, không chạy lại khi tên bàn được cập nhật — nếu không nó tự
    // gọi lại chính mình.
  }, [session?.guest_token, applyTableName]);

  const sectionRefs = useRef(new Map<string, HTMLElement>());

  /* Chiều cao THẬT của khối dính (header + dải nhóm), đo chứ không khai cứng.
   *
   * Bản trước khai tay 56px cho header và 104px cho mép dưới dải nhóm. Không khớp thực tế:
   * header cao 60px (chip bàn min-height 44 + padding 8+8) và dải nhóm cao 52px (chip 36 +
   * padding 8+8), tức mép dưới ở 112px. Lệch 4px ở mỗi tầng, và vì tầng dưới có z-index nhỏ
   * hơn nên lúc cuộn nó chui dần xuống dưới tầng trên rồi bật lại — đúng cảm giác GIẬT GIẬT.
   *
   * Đo bằng ResizeObserver thì cỡ chữ hệ thống, bàn phím, hay sau này thêm một nút vào header
   * đều tự đúng. 112 chỉ là giá trị tạm cho khung hình đầu tiên. */
  const stickRef = useRef<HTMLDivElement>(null);
  const [stickH, setStickH] = useState(112);
  useEffect(() => {
    const el = stickRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStickH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    setStickH(Math.round(el.getBoundingClientRect().height));
    return () => ro.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const needle = fold(q.trim());
    if (!needle) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => fold(i.name).includes(needle)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, q]);

  // Chip nhóm sáng theo nhóm đang xem. IntersectionObserver thay vì nghe scroll: nghe scroll
  // trên danh sách 600 món là tính toán mỗi khung hình, máy Android đời thấp giật thấy rõ.
  useEffect(() => {
    const els = [...sectionRefs.current.values()];
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveGroup(top.target.getAttribute('data-group-id'));
      },
      // Chỉ tính vùng ngay dưới khối dính — nhóm "đang xem" là nhóm chạm mép trên của vùng
      // món, không phải nhóm chiếm nhiều diện tích nhất.
      { rootMargin: `-${stickH}px 0px -70% 0px`, threshold: 0 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [filtered, stickH]);

  const jumpTo = useCallback((groupId: string) => {
    const el = sectionRefs.current.get(groupId);
    if (!el) return;
    const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - stickH);
    /* Nhảy TỨC THÌ, không dùng `behavior: 'smooth'`.
     *
     * Người test báo 2026-10-02: bấm chip nhóm món thì `scrollY` vẫn bằng 0, trang không nhúc
     * nhích. Dựng lại bằng chính CSS của trang và đo: `window.scrollTo(0, y)` chạy đúng (lên
     * 3440), còn cùng con số đó với `behavior:'smooth'` thì không đi đâu cả. Cuộn mượt là một
     * HOẠT ẢNH, và hoạt ảnh thì có nhiều thứ làm nó không chạy — trình duyệt cũ, chế độ giảm
     * chuyển động, hay một lần vẽ lại chen vào giữa. Một cú nhảy thì không có gì để hỏng.
     *
     * Mất gì: không còn hiệu ứng trượt. Với màn thực đơn của người lớn tuổi thì nhảy thẳng
     * tới nhóm còn đỡ chóng mặt hơn là nhìn 600 món chạy vụt qua. */
    window.scrollTo(0, y);
  }, [stickH]);

  const openCart = useCallback(() => setSheet(session ? 'cart' : 'entry'), [session]);

  return (
    <div className="mo-root">
      <style>{MENU_ORDER_CSS}</style>
      <style>{DINEIN_CSS}</style>

      {/* MỘT khối dính duy nhất cho header + dải nhóm.
          Trước đây hai thứ này dính RIÊNG, mỗi thứ một mốc top khai tay — mốc sai là chúng
          trượt lên nhau khi cuộn. Gộp lại thì không còn phép tính nào để sai: chúng dính
          cùng nhau như một mảng, và phần còn lại của trang chỉ cần biết ĐÚNG MỘT con số
          (chiều cao của khối này, đã đo ở trên). */}
      <div className="mo-stick" ref={stickRef}>
      {/* ── Header: MỘT hàng. Logo thay chữ "Quán Bà Lũn", ô tìm và chip bàn gộp vào đây ── */}
      <header className="mo-head">
        {/* Logo THẬT của quán — cùng file `/logo.jpg` mà web đặt hàng đang dùng
            (`Wordmark.tsx`, chủ quán xác nhận 2026-07-30). Bỏ chữ "Quán Bà Lũn" theo yêu cầu:
            một hàng header chỉ còn logo + ô tìm + chip bàn. */}
        <img className="mo-logo" src="/logo.jpg" alt="Quán Bà Lùn" width={36} height={36} />

        <label className="mo-search">
          <span aria-hidden>🔍</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm món…"
            aria-label="Tìm món"
          />
        </label>

        {/* Chip bàn — hai trạng thái. Khi đã gọi món thì nó THAY luôn dải "Bàn N · đã gọi…" vốn
            nằm ở đáy màn, lấy lại khoảng 48px cho danh sách món. */}
        <button
          type="button"
          className="mo-chip"
          onClick={() => setSheet(session ? 'state' : 'entry')}
        >
          {session ? (
            <>
              <b>{session.table_name}</b>
              <i>Xem món đã gọi</i>
            </>
          ) : (
            <>
              <span>BÀN CỦA BẠN</span>
              <b>Chưa chọn</b>
            </>
          )}
        </button>
      </header>

      {/* ── Dải nhóm món: MỘT hàng, lướt trái/phải ─────────────────────────────────────── */}
      <nav className="mo-rail" aria-label="Nhóm món">
        {filtered.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`mo-rail-chip${activeGroup === g.id ? ' is-on' : ''}`}
            onClick={() => jumpTo(g.id)}
          >
            {g.name}
          </button>
        ))}
      </nav>
      </div>

      <main className="mo-list">
        {menu.error ? <p className="mo-empty">Không tải được thực đơn. Bạn kéo xuống để thử lại nhé.</p> : null}
        {!menu.error && filtered.length === 0 ? (
          <p className="mo-empty">{q ? `Không thấy món nào khớp "${q}".` : 'Đang tải thực đơn…'}</p>
        ) : null}

        {filtered.map((g) => (
          <section
            key={g.id}
            data-group-id={g.id}
            ref={(el) => {
              if (el) sectionRefs.current.set(g.id, el);
              else sectionRefs.current.delete(g.id);
            }}
          >
            {/* Nhãn nhóm thu nhỏ còn ~28px — bản cũ là tiêu đề lớn kèm đường kẻ trang trí,
                tốn chỗ mà không giúp tìm món nhanh hơn. */}
            <h2 className="mo-group">{g.name}</h2>

            {g.items.map((it) => (
              <article
                key={it.id}
                className={`mo-card${it.is_out_of_stock ? ' is-out' : ''}${
                  (qtyById.get(it.id) ?? 0) > 0 ? ' is-picked' : ''
                }`}
                onClick={() => !it.is_out_of_stock && setSheetItem(it)}
              >
                <div className="mo-thumb">
                  {it.images[0] ? <img src={it.images[0]} alt="" loading="lazy" /> : <span aria-hidden>🍜</span>}
                </div>
                <div className="mo-mid">
                  {/* Tên món ĐÚNG MỘT DÒNG, cắt bằng dấu ba chấm. Bản cũ để xuống 2 dòng nên
                      chiều cao card nhảy lung tung và lọt được ít món hơn hẳn. */}
                  <h3 className="mo-name">{it.name}</h3>
                  <p className="mo-unit">{it.unit}</p>
                  <p className="mo-price">{vnd(it.price)}</p>
                </div>
                {it.is_out_of_stock ? (
                  // M7.D-07 — vẫn THẤY, bôi mờ, không gọi được. Ẩn hẳn thì khách tưởng quán
                  // không bán và vẫn đi hỏi nhân viên, đúng việc M7 muốn giảm.
                  <span className="mo-out">Hôm nay<br />tạm hết</span>
                ) : (qtyById.get(it.id) ?? 0) > 0 ? (
                  // Món ĐÃ trong giỏ: nút `+` biến thành `− N +` ngay tại chỗ. Đây là dấu
                  // hiệu BỀN — cuộn qua chục món rồi quay lại vẫn thấy mình đã gọi mấy phần,
                  // không phải mở tấm giỏ ra mới biết.
                  <div
                    className="mo-step"
                    role="group"
                    aria-label={`Số lượng ${it.name}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      aria-label={
                        (qtyById.get(it.id) ?? 0) === 1 ? `Bỏ ${it.name}` : `Bớt ${it.name}`
                      }
                      onClick={() => setTableQty(it.id, (qtyById.get(it.id) ?? 0) - 1)}
                    >
                      −
                    </button>
                    <b>{qtyById.get(it.id)}</b>
                    <button
                      type="button"
                      aria-label={`Thêm ${it.name}`}
                      disabled={(qtyById.get(it.id) ?? 0) >= TABLE_CART_MAX_QTY}
                      onClick={() => setTableQty(it.id, (qtyById.get(it.id) ?? 0) + 1)}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mo-add"
                    aria-label={`Thêm ${it.name}`}
                    onClick={(e) => {
                      // Chặn nổi bọt để bấm nút không mở luôn hộp chi tiết.
                      e.stopPropagation();
                      addTableLine({
                        menu_item_id: it.id,
                        name: it.name,
                        unit_price: it.price,
                        note: '',
                      });
                    }}
                  >
                    +
                  </button>
                )}
              </article>
            ))}
          </section>
        ))}
      </main>

      {/* ── Hộp chi tiết món: ảnh to, số lượng, ghi chú ────────────────────────────────── */}
      {sheetItem ? (
        <ItemSheet item={sheetItem} onClose={() => setSheetItem(null)} />
      ) : null}

      {/* ── Nút giỏ nổi. Bỏ chữ "Xem giỏ" theo yêu cầu chủ quán; số tiền là phần tử riêng
             `white-space: nowrap` + `tabular-nums` để tổng 7 chữ số không làm vỡ nút. ──── */}
      {cartCount > 0 ? (
        <div className="mo-fab">
          <button type="button" className="mo-fab-btn" onClick={openCart}>
            <span className="mo-fab-icon" aria-hidden>🛒</span>
            <span className="mo-fab-text">
              <b>{cartCount} món đã chọn</b>
              <i>Chạm để gửi cho quán</i>
            </span>
          </button>
        </div>
      ) : null}

      {/* Bé hamster góc dưới phải. Chỉ dựng sau khi thực đơn về: hai tấm sprite (~110KB) không
          được giành băng thông 3G với dữ liệu món lúc mở trang. */}
      {menu.data ? <MenuMascot cartCount={cartCount} sentKey={sentKey} raised={cartCount > 0} /> : null}

      {sheet === 'entry' && (
        <TableEntrySheet
          onClose={() => setSheet('none')}
          onDone={(s) => setPendingSession(s)}
          // Chưa có phiên = CỔNG BẮT BUỘC, không đóng được. Đã có phiên mà tự mở lại (đổi bàn)
          // thì vẫn đóng được như bình thường.
          dismissible={session !== null}
        />
      )}
      {pendingSession && (
        <TableConfirmSheet
          tableName={pendingSession.table_name}
          onNo={() => {
            setPendingSession(null);
            setSheet('entry');
          }}
          onYes={() => {
            // Đây mới là lúc phiên được ghi xuống máy: khách đã nhìn tên bàn cỡ lớn và gật.
            writeTableSession(pendingSession);
            setSession(pendingSession);
            setPendingSession(null);
            // Vào THẲNG thực đơn. Mở tấm giỏ ngay là hiện một hộp rỗng "Chưa chọn món nào" —
            // khách vừa khai bàn xong thì việc kế tiếp là CHỌN MÓN, không phải xem giỏ.
            setSheet('none');
          }}
        />
      )}
      {sheet === 'cart' && session && (
        <TableCartSheet session={session} onClose={() => setSheet('none')} onSent={() => {
          setSentKey((k) => k + 1);
          setSheet('state');
        }} />
      )}
      {sheet === 'state' && session && (
        <TableStateSheet
          session={session}
          onClose={() => setSheet('none')}
          /* Đổi bàn: chỉ gỡ phiên của MÁY NÀY rồi hỏi lại số bàn. Giữ nguyên giỏ đang chọn —
             khách khai nhầm bàn thì món họ vừa chọn vẫn là món họ muốn, bắt chọn lại từ đầu
             là phạt nhầm người. */
          onSwitchTable={() => {
            writeTableSession(null);
            setSession(null);
            setSheet('entry');
          }}
          onTableRenamed={applyTableName}
          onEnded={() => {
            setSession(null);
            // Bàn đã kết thúc → về lại CỔNG, không thả khách ra thực đơn ở trạng thái lửng lơ.
            setSheet('entry');
          }}
        />
      )}
    </div>
  );
}

/** Hộp chi tiết một món — chỗ DUY NHẤT tên món được xuống dòng đầy đủ. */
function ItemSheet({ item, onClose }: { item: PublicMenuItem; onClose: () => void }) {
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  return (
    <div className="dinein-scrim" onClick={onClose}>
      <div className="dinein-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="dinein-head">
          <b>Thêm món</b>
          <button type="button" onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="dinein-body dinein-scroll">
          {item.images[0] ? <img className="mo-sheet-img" src={item.images[0]} alt="" /> : null}
          <h3 className="mo-sheet-name">{item.name}</h3>
          <p className="mo-sheet-price">{vnd(item.price)} / {item.unit}</p>
          <div className="dinein-line-ctl">
            <button type="button" onClick={() => setQty((n) => Math.max(1, n - 1))}>−</button>
            <b>{qty}</b>
            <button type="button" onClick={() => setQty((n) => Math.min(20, n + 1))}>+</button>
            <input
              placeholder="Ghi chú (ít cay…)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="dinein-foot">
          <button
            type="button"
            className="dinein-primary"
            onClick={() => {
              addTableLine(
                { menu_item_id: item.id, name: item.name, unit_price: item.price, note },
                qty,
              );
              onClose();
            }}
          >
            Thêm {qty} phần · {vnd(item.price * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}

const MENU_ORDER_CSS = `
/* Trang này KHÔNG đi qua AppShell khi phục vụ ở menu.<domain>, nên không có reset nào chạy
   trước. Chặn tràn ngang ngay ở gốc: dải nhóm món rộng hơn màn hình và nó tự cuộn trong lòng
   nó, không được phép đội bề rộng cả trang (đo ở 390px: card bị cắt mép phải, nút + biến mất).

   ⚠ clip chứ KHÔNG PHẢI hidden. Theo chuẩn CSS, một trục để hidden thì trục còn lại
   dù khai visible cũng bị tính thành auto — tức phần tử THÀNH MỘT KHUNG CUỘN. Mà
   position: sticky thì dính vào khung cuộn gần nhất, nên header và dải nhóm món dính vào
   một khung không bao giờ cuộn → cuộn trang là chúng trôi mất tiêu. clip cắt y hệt nhưng
   KHÔNG tạo khung cuộn, nên sticky lại dính vào khung nhìn như mong đợi. */
html,body{ margin:0; max-width:100%; overflow-x:clip; }
*,*::before,*::after{ box-sizing:border-box; }
:root{
  --brand-500:#cf3323; --brand-600:#b82a1e; --brand-050:#fef6f3;
  --wood-400:#e8a33d; --wood-700:#8c5610; --wood-100:#f6ecd9;
  --bg-page:#fdf7ee; --bg-surface:#fffdfa; --bg-sunken:#f7efe2; --bg-wood:#6b4423;
  --text-strong:#2a1d14; --text-body:#3a2b1f; --text-muted:#6e5c4c;
  --border-subtle:#efe6d8; --border-default:#ddd0bd;
}
.mo-root{
  min-height:100dvh; background:var(--bg-page); color:var(--text-body);
  font-family:'Be Vietnam Pro','Segoe UI',sans-serif;
  /* Chừa chỗ cho nút giỏ nổi (84px) + phần đầu bé hamster chìa lên khỏi nút (~56px): món cuối
     danh sách phải cuộn lên được khỏi cả hai, nút + của nó mới bấm được. */
  padding-bottom:calc(132px + env(safe-area-inset-bottom,0px));
  /* Dải nhóm món rộng hơn màn hình (4 nhóm đã quá 390px) và nó tự cuộn trong lòng nó. Không
     chặn ở đây thì bề rộng đó đội cả TRANG ra, card bị cắt mép phải và nút + biến mất — đúng
     triệu chứng đo được ở 390px trước khi sửa.
     clip chứ không hidden — cùng lý do ở khối html,body trên kia: hidden biến CHÍNH
     phần tử này thành khung cuộn, và mọi thứ sticky bên trong nó (header, dải nhóm, nhãn
     nhóm) dính vào đó thay vì dính vào màn hình, nên cuộn một cái là trôi hết. */
  width:100%; max-width:100vw; overflow-x:clip;
}
.mo-root h2,.mo-root h3,.mo-price{ font-family:'Baloo 2','Be Vietnam Pro',sans-serif; }

/* Header MỘT hàng — nền SÁNG theo Header.tsx của web đặt hàng đang chạy, không phải nền gỗ. */
/* Khối dính: header + dải nhóm đi cùng nhau. Chỉ MỘT phần tử sticky ở đây, nên không còn
   mốc top nào để khai lệch. Nền phải đặc, nếu không món cuộn qua sẽ lộ sau nó. */
.mo-stick{
  position:sticky; top:0; z-index:100;
  background:var(--bg-surface);
  /* Nhắc trình duyệt tách lớp này ra để cuộn không phải vẽ lại nó mỗi khung hình — máy
     Android đời thấp thấy rõ nhất. */
  will-change:transform;
}
.mo-head{
  display:flex; align-items:center; gap:10px;
  padding:8px 12px; padding-top:calc(8px + env(safe-area-inset-top,0px));
  background:var(--bg-surface); border-bottom:1px solid var(--border-subtle);
}
.mo-logo{ flex:none; width:36px; height:36px; border-radius:50%; object-fit:cover; }
.mo-search{
  flex:1; min-width:0; display:flex; align-items:center; gap:8px;
  height:40px; padding:0 12px; border-radius:999px;
  background:var(--bg-sunken); border:1px solid var(--border-subtle);
}
.mo-search input{
  flex:1; min-width:0; border:none; background:transparent; outline:none;
  font-size:16px; color:var(--text-strong); /* 16px: dưới mức này iOS tự phóng to trang */
}
.mo-chip{
  flex:none; max-width:42vw; display:flex; flex-direction:column; align-items:flex-end;
  gap:1px; padding:4px 10px; min-height:44px; cursor:pointer;
  border:1px solid var(--brand-500); border-radius:10px; background:var(--brand-050);
  overflow:hidden;
}
.mo-chip span{ font-size:10px; letter-spacing:.06em; color:var(--wood-700); }
.mo-chip b{ font-size:15px; color:var(--brand-600); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
.mo-chip i{ font-size:11px; font-style:normal; color:var(--text-muted); white-space:nowrap; }

/* Dải nhóm — MỘT hàng, lướt trái/phải. Chip cuối cắt hụt ở mép phải để lộ còn nhóm phía sau. */
.mo-rail{
  display:flex; gap:8px; overflow-x:auto; scrollbar-width:none;
  padding:8px 12px; background:var(--bg-page); border-bottom:1px solid var(--border-subtle);
  max-width:100%; -webkit-overflow-scrolling:touch;
}
.mo-rail::-webkit-scrollbar{ display:none; }
.mo-rail-chip{
  flex:none; min-height:36px; padding:0 14px; border-radius:999px; cursor:pointer;
  border:1px solid var(--border-subtle); background:var(--bg-surface);
  color:var(--text-body); font-size:15px; white-space:nowrap;
}
.mo-rail-chip.is-on{ background:var(--brand-500); border-color:var(--brand-500); color:#fff; font-weight:700; }

/* Nhãn nhóm KHÔNG dính nữa (2026-10-01). Ba tầng dính chồng nhau là ba lần trình duyệt
   phải tính lại vị trí mỗi khung hình, và tầng này z-index thấp nhất nên nó chui xuống dưới
   hai tầng kia rồi bật ra — nhìn ra đúng là giật. Bỏ đi không mất thông tin: chip nhóm đang
   sáng trên dải ngay trên kia đã nói nhóm đang xem là nhóm nào. */
.mo-group{
  margin:0; padding:6px 16px; background:var(--bg-page);
  font-size:14px; font-weight:700; color:var(--text-muted);
}
.mo-list{ padding-bottom:8px; }
.mo-empty{ padding:40px 16px; text-align:center; color:var(--text-muted); }

/* Card CỐ ĐỊNH 96px — mọi card bằng nhau tuyệt đối, nên 844px lọt được >4 món.
   Chiều cao KHÔNG đổi khi món vào giỏ: stepper cao 44px nằm gọn trong 96px, nên danh sách
   không nhảy chỗ dưới ngón tay đang bấm. */
.mo-card{
  display:flex; align-items:center; gap:12px;
  height:96px; margin:0 12px 8px; padding:10px;
  background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px;
  cursor:pointer;
}
.mo-card.is-out{ opacity:.55; cursor:default; }
.mo-thumb{
  flex:none; width:72px; height:72px; border-radius:10px; overflow:hidden;
  background:var(--wood-100); display:flex; align-items:center; justify-content:center; font-size:28px;
}
.mo-thumb img{ width:100%; height:100%; object-fit:cover; }
.mo-mid{ flex:1; min-width:0; }
.mo-name{
  margin:0; font-size:17px; font-weight:700; color:var(--text-strong);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.mo-unit{ margin:2px 0 0; font-size:13px; color:var(--text-muted);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mo-price{ margin:4px 0 0; font-size:17px; font-weight:800; color:var(--brand-500); }
.mo-add{
  flex:none; width:44px; height:44px; border-radius:10px; border:none; cursor:pointer;
  background:var(--brand-600); color:#fff; font-size:26px; line-height:1;
}
.mo-out{ flex:none; width:64px; text-align:center; font-size:12px; color:var(--brand-700,#8f1d14); }

/* Món đã chọn: viền + nền nhạt màu thương hiệu. Liếc cả màn là biết ngay đã gọi những gì,
   không phải đọc từng con số. */
.mo-card.is-picked{ border-color:var(--brand-500); background:var(--brand-050); }
/* Stepper − N + . Mỗi nút 40px (≥ ngưỡng chạm), cả cụm vừa đúng chỗ nút + cũ nên bề ngang
   card không đổi khi món vào giỏ. */
.mo-step{
  flex:none; display:flex; align-items:center; gap:2px;
  border:1px solid var(--brand-500); border-radius:10px; background:var(--bg-surface);
}
.mo-step button{
  width:40px; height:40px; border:none; background:transparent; cursor:pointer;
  color:var(--brand-600); font-size:22px; line-height:1;
}
.mo-step button:disabled{ opacity:.4; cursor:default; }
.mo-step b{
  min-width:26px; text-align:center; font-size:18px; font-weight:800; color:var(--brand-600);
  font-variant-numeric:tabular-nums;
}

.mo-sheet-img{ width:100%; border-radius:12px; margin-bottom:12px; }
.mo-sheet-name{ margin:0; font-size:22px; color:var(--text-strong); }
.mo-sheet-price{ margin:4px 0 14px; font-size:18px; font-weight:700; color:var(--brand-500); }

.mo-fab{
  position:fixed; left:0; right:0; bottom:0; z-index:200;
  padding:12px; padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));
  pointer-events:none;
}
.mo-fab-btn{
  pointer-events:auto; width:100%; min-height:60px;
  display:flex; align-items:center; gap:12px; justify-content:space-between;
  padding:0 18px; border:none; border-radius:14px; cursor:pointer;
  background:var(--brand-600); color:#fff;
  box-shadow:0 10px 24px rgb(42 29 20 / 18%);
}
.mo-fab-icon{ flex:none; font-size:22px; }
/* min-width:0 + nowrap: thiếu nó thì tổng tiền 7 chữ số đội nút ra ngoài — đúng lỗi "giỏ bị
   vỡ" ở bản dựng trước. */
.mo-fab-text{ flex:1; min-width:0; display:flex; flex-direction:column; align-items:flex-start; }
.mo-fab-text b{ font-size:17px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.mo-fab-text i{ font-size:12px; font-style:normal; opacity:.85; }
`;

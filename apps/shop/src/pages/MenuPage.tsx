import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import {
  PublicMenuGroup,
  PublicStoreStatus,
  PublicTopDishes,
  type PublicMenuItem,
} from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { consumeCartExpired, useCart } from '../lib/cart-store.ts';
import { nextOpeningText } from '../lib/open-hours.ts';
import { CardItem, CARD_ITEM_CSS } from '../components/CardItem.tsx';
import { CategoryRail } from '../components/CategoryRail.tsx';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { CartToast } from '../components/CartToast.tsx';

/**
 * REQ-I — trang menu công khai hoàn chỉnh.
 *
 * Khách xem được TOÀN BỘ menu không cần đăng nhập, và trước khi bị hỏi bất kỳ
 * thông tin cá nhân nào (M2.D-08) — trang này không có form, popup thu thập,
 * hay checkbox nào. Đây là ràng buộc có chủ đích, không phải phần chưa làm.
 *
 * Tải dữ liệu bằng 2 lệnh gọi độc lập tới BE (trạng thái quán + toàn bộ menu,
 * D-03): menu tải đúng 1 lần toàn bộ, đổi tab nhóm hàng và gõ tìm kiếm đều lọc
 * trên mảng đã có sẵn trong bộ nhớ — phản hồi ngay lập tức, không gọi lại BE.
 */

const MenuResponse = z.object({ groups: PublicMenuGroup.array() });
type MenuResponse = z.infer<typeof MenuResponse>;

/** Bỏ dấu tiếng Việt + hạ chữ thường, để "bun bo" khớp được "Bún bò". */
function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function MenuPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [priceChangedBanner, setPriceChangedBanner] = useState(false);
  /** Giỏ tối qua vừa bị dọn vì quá 24h (D-06) — nói một câu thay vì để giỏ trống im lặng.
   *  Đọc trong effect (không phải initializer của useState) để StrictMode dev không "tiêu thụ"
   *  mất cờ ở lần render nháp đầu tiên. */
  const [cartExpired, setCartExpired] = useState(false);
  useEffect(() => {
    if (consumeCartExpired()) setCartExpired(true);
  }, []);
  // `nonce` tăng mỗi lần thêm món — bấm `+` liên tiếp thì toast hẹn giờ lại từ
  // đầu và chạy lại hiệu ứng, thay vì đứng im như đã hết tác dụng.
  const [toast, setToast] = useState<{ message: string; nonce: number } | null>(null);

  const store = useApi('/api/public/store', PublicStoreStatus);
  const menu = useApi('/api/public/menu', MenuResponse);
  const cart = useCart();

  const groups = menu.data?.groups ?? [];

  // D-07: đồng bộ giỏ với menu mới đúng một lần cho mỗi lần dữ liệu menu đổi
  // (không phải mỗi lần render) — theo dõi tham chiếu mảng đã đồng bộ gần nhất.
  const syncedGroupsRef = useRef<PublicMenuGroup[] | null>(null);
  useEffect(() => {
    if (!menu.data) return;
    if (syncedGroupsRef.current === menu.data.groups) return;
    syncedGroupsRef.current = menu.data.groups;
    const result = cart.applyMenuSync(menu.data.groups);
    if (result.priceChanged) setPriceChangedBanner(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.data]);

  const normalizedQuery = normalizeForSearch(q);
  const isSearching = normalizedQuery.length > 0;

  /**
   * Kết quả tìm kiếm: khớp TÊN MÓN, MÃ MÓN, hoặc TÊN NHÓM (2026-08-06 thêm nhóm).
   *
   * Khách gõ theo cách họ nghĩ về đồ ăn — "lẩu", "nướng", "đồ uống" — mà mấy chữ đó là tên NHÓM
   * chứ không nằm trong tên món nào ("Lẩu" thì còn may, "Đồ uống" thì không món nào tên vậy). Bản
   * cũ trả về 0 kết quả cho đúng những từ khách hay gõ nhất.
   */
  const filteredItems: PublicMenuItem[] = useMemo(() => {
    if (!normalizedQuery) return [];
    return groups.flatMap((group) => {
      // Cả nhóm khớp → lấy trọn nhóm (khách gõ "lẩu" là muốn xem hết mục Lẩu, không phải lọc tiếp).
      if (normalizeForSearch(group.name).includes(normalizedQuery)) return group.items;
      return group.items.filter(
        (item) =>
          normalizeForSearch(item.name).includes(normalizedQuery) ||
          normalizeForSearch(item.code).includes(normalizedQuery),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, normalizedQuery]);

  /**
   * Gợi ý khi tìm không ra món nào (2026-08-06).
   *
   * "Không tìm thấy món nào" + một link quay lại là một ngõ cụt: khách gõ sai chính tả hoặc tìm
   * món quán không bán, và ta để họ tự nghĩ ra từ khoá khác. Bảng xếp hạng món bán chạy đã có sẵn
   * endpoint riêng — đây là chỗ nó có ích nhất.
   *
   * Chỉ gọi khi THỰC SỰ rơi vào ngõ cụt (`skip` bên dưới): tải sẵn cho mọi lượt xem menu là một
   * request thừa trên 3G cho một nhánh hiếm.
   */
  const noResults = isSearching && filteredItems.length === 0 && menu.data !== null;
  const topDishes = useApi('/api/public/top-dishes', PublicTopDishes, { skip: !noResults });

  /** Món gợi ý = món bán chạy TRA NGƯỢC về menu đang có trong bộ nhớ — nhờ vậy card gợi ý là
   *  `CardItem` thật (thêm giỏ được ngay), không phải một danh sách chữ chỉ để đọc. */
  const suggestedItems: PublicMenuItem[] = useMemo(() => {
    if (!topDishes.data?.enabled) return [];
    const byId = new Map(groups.flatMap((g) => g.items).map((item) => [item.id, item]));
    return topDishes.data.items
      .map((dish) => byId.get(dish.id))
      .filter((item): item is PublicMenuItem => item !== undefined && !item.is_out_of_stock)
      .slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topDishes.data, groups]);

  const clearSearch = (): void => {
    const next = new URLSearchParams(params);
    next.delete('q');
    setParams(next, { replace: true });
  };

  const handleAdd = (item: PublicMenuItem): void => {
    // Món hết hàng đã bị CardItem tự khoá nút — không cần lọc lại ở đây.
    cart.add(
      {
        menu_item_id: item.id,
        code: item.code,
        name: item.name,
        unit_price: item.price,
        note: null,
        image: item.images[0] ?? null,
      },
      1,
    );
    setToast((prev) => ({
      message: `Đã thêm ${item.name} vào giỏ`,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };

  /**
   * Số lượng từng món đang có trong giỏ, để card tự biết hiện nút `+` hay stepper.
   *
   * Bỏ dòng `unavailable` ra ngoài: món hết hàng vẫn còn dòng trong giỏ theo D-07, nhưng
   * trên lưới menu nó phải là nút `+` KHOÁ — hiện stepper thì khách cộng số lượng cho món
   * quán không làm được.
   */
  const qtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart.lines) {
      if (!line.unavailable) map.set(line.menu_item_id, line.qty);
    }
    return map;
    // `cart.lines` là tham chiếu từ store (useSyncExternalStore) nên chỉ đổi khi giỏ đổi
    // thật, không đổi mỗi lần render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines]);

  /**
   * Đổi số lượng món ĐÃ có trong giỏ, ngay trên lưới menu.
   *
   * CỐ Ý không bắn toast ở đây (khác `handleAdd`): con số trên stepper đã đứng ngay dưới
   * ngón tay khách và nó là trạng thái bền, không tự tắt sau 1.8s. Toast thêm vào chỉ là
   * lớp nhiễu che mất nội dung đáy màn hình cho một thông tin đã hiển thị rõ hơn ở chỗ khác.
   */
  const handleSetQty = (item: PublicMenuItem, qty: number): void => {
    cart.setQty(item.id, qty);
  };

  /** Câu "Quán mở lại lúc …" — tính lại mỗi lần dữ liệu quán đổi. Không cần đồng hồ chạy: khách
   *  đọc nó đúng một lần lúc mở trang, và câu này đủ đúng trong cả tiếng đồng hồ sau đó. */
  const reopenText = store.data ? nextOpeningText(store.data.open_hours, Date.now()) : null;

  /**
   * Đổi nhóm món xong thì ĐƯA MÀN HÌNH VỀ ĐẦU DANH SÁCH (2026-08-07).
   *
   * Trên mobile khách cuộn sâu giữa nhóm cũ rồi bấm nhóm khác: dải danh mục dính trên đầu nên
   * vẫn bấm được, nhưng danh sách bên dưới thay nội dung TẠI CHỖ — khách rơi vào lưng chừng
   * nhóm mới (hoặc chạm đáy nếu nhóm mới ít món hơn), tưởng nhóm đó chỉ có mấy món cuối.
   *
   * Mốc cuộn là `railAnchorRef` — một điểm 0px NGAY TRƯỚC dải danh mục, không phải chính dải
   * (dải sticky nên khi đã dính thì `getBoundingClientRect().top` luôn bằng offset, đo ra 0).
   * Trừ đi chiều cao header thật (header sticky `top: 0`) để dải nằm khít dưới header đúng như
   * lúc nó vừa dính, thay vì cuộn thẳng về 0 và bỏ phí một màn hình.
   */
  const railAnchorRef = useRef<HTMLDivElement>(null);
  const handleSelectCategory = (code: string | null): void => {
    setActiveCode(code);
    const anchor = railAnchorRef.current;
    if (!anchor || typeof window === 'undefined') return;
    const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
    const top = Math.max(0, window.scrollY + anchor.getBoundingClientRect().top - headerHeight);
    // Đã ở đúng chỗ rồi thì khỏi gọi cuộn (tránh giật nhẹ khi khách bấm ngay lúc mở trang).
    if (Math.abs(top - window.scrollY) < 2) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const visibleGroups = activeCode ? groups.filter((g) => g.code === activeCode) : groups;
  const loading = (menu.loading || store.loading) && !menu.data;

  return (
    <div style={page}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{SKELETON_CSS}</style>
      {/* CSS hover của card món — nhúng 1 lần ở trang thay vì lặp theo từng card. */}
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{CARD_ITEM_CSS}</style>

      <h1 style={srOnly}>Menu</h1>

      {/* Mốc đo cho `handleSelectCategory` — phải nằm NGOÀI dải sticky mới đo được vị trí thật. */}
      <div ref={railAnchorRef} aria-hidden="true" />

      {groups.length > 0 && (
        <CategoryRail groups={groups} activeCode={activeCode} onSelect={handleSelectCategory} />
      )}

      <div style={bannerStack}>
        {/* Nút + thêm món ở lưới bên dưới VẪN bấm được dù banner này hiện
            (D-20) — chỉ nút ĐẶT HÀNG ở bước checkout mới bị khoá, không phải
            việc của trang này.

            D-11 — MỘT banner duy nhất, dùng nguyên văn `closed_banner_text` chủ quán soạn trong
            Cài đặt (đổi chữ là ăn ngay, `/api/public/store` đã `no-store`). Bản cũ của phase 08
            có ternary OUTSIDE_HOURS vs tắt-thủ-công + chữ cứng ở FE + `off_reason`: phase 9 đã bỏ
            mô hình đó ở CheckoutPage nhưng bỏ sót trang này — với khách, cả hai tình huống đều là
            "quán đang đóng cửa, vẫn đặt được". Không `action` gọi quán: câu chữ do chủ quán tự
            viết, họ tự quyết có mời gọi điện hay không.

            Tone `brand` (nền hồng ấm), KHÔNG phải `info` (xanh dương): theo phân vai trong
            BannerNotice, tin về QUÁN (đang đóng cửa) là brand; info dành riêng cho tin về ĐƠN
            của khách. Nền xanh info cũng lạc hẳn khỏi theme kem ấm + đỏ ớt của trang khách. */}
        {store.data && store.data.ordering_enabled === false && (
          <BannerNotice
            tone="brand"
            // "không nhận đơn online" chứ KHÔNG phải "đóng cửa" (chỉ đạo 2026-08-16): quán có
            // thể vẫn mở bán tại chỗ, chỉ tắt kênh online — nói "đóng cửa" là đuổi nhầm khách.
            title="Quán đang không nhận đơn online"
            body={
              <>
                {store.data.closed_banner_text}
                {/* Dòng "mở lại lúc …" — THÊM VÀO, không thay câu chủ quán soạn (D-14 giữ nguyên
                    văn). Chỉ hiện khi đóng vì NGOÀI GIỜ: quán tắt nhận đơn bằng tay thì mốc mở
                    lại không nằm trong `open_hours`, đoán là hứa hộ họ một giờ họ chưa hứa. */}
                {store.data.blocking_reason === 'OUTSIDE_HOURS' && reopenText !== null && (
                  <span style={reopenLine}>{reopenText}</span>
                )}
              </>
            }
          />
        )}

        {cartExpired && (
          <BannerNotice
            tone="brand"
            title="Giỏ hàng cũ đã được dọn"
            body="Giỏ hàng chỉ giữ trong 24 giờ nên các món bạn chọn hôm trước không còn ở đây. Bạn chọn lại giúp quán nhé — giá hôm nay có thể đã khác."
            action={{ label: 'Đã hiểu', onClick: () => setCartExpired(false) }}
          />
        )}

        {priceChangedBanner && (
          <BannerNotice
            tone="brand"
            title="Giá một vài món đã được cập nhật"
            body="Giỏ hàng của bạn đã được cập nhật theo giá mới nhất."
            action={{ label: 'Đã hiểu', onClick: () => setPriceChangedBanner(false) }}
          />
        )}

        {menu.error && (
          <BannerNotice
            tone="danger"
            title="Không tải được menu"
            body={
              menu.error.kind === 'schema'
                ? 'Dữ liệu trả về không đúng định dạng mong đợi — đây là lỗi kỹ thuật, không phải lỗi của bạn.'
                : menu.error.message
            }
            action={{ label: 'Thử lại', onClick: () => menu.reload() }}
          />
        )}
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : isSearching ? (
        <section>
          <div style={searchMetaRow}>
            <p style={searchMeta}>
              {filteredItems.length} món khớp «{q}»
            </p>
            <button type="button" style={linkButton} onClick={clearSearch}>
              Xoá tìm kiếm
            </button>
          </div>
          {filteredItems.length === 0 ? (
            <>
              <div style={emptyState}>
                <p style={emptyText}>Không tìm thấy món nào khớp «{q}»</p>
                <p style={emptyHint}>
                  Bạn thử từ ngắn hơn (ví dụ «lẩu», «nướng») — tìm được cả theo tên nhóm món.
                </p>
                <button type="button" style={linkButton} onClick={clearSearch}>
                  Xem tất cả món
                </button>
              </div>

              {/* Ngõ cụt biến thành lối ra: mấy món quán bán chạy nhất, thêm giỏ được ngay tại
                  đây. Không có gợi ý nào (quán tắt bảng xếp hạng / chưa đủ dữ liệu bán) thì không
                  vẽ khối rỗng — xem `suggestedItems`. */}
              {suggestedItems.length > 0 && (
                <section style={groupSection}>
                  <h2 style={groupHeading}>Hay được gọi nhất</h2>
                  <div style={grid}>
                    {suggestedItems.map((item, i) => (
                      <CardItem
                        key={item.id}
                        item={item}
                        onAdd={handleAdd}
                        qtyInCart={qtyById.get(item.id) ?? 0}
                        onSetQty={handleSetQty}
                        index={i}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div style={grid} data-testid="menu-grid">
              {filteredItems.map((item, i) => (
                <CardItem
                  key={item.id}
                  item={item}
                  onAdd={handleAdd}
                  qtyInCart={qtyById.get(item.id) ?? 0}
                  onSetQty={handleSetQty}
                  index={i}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        visibleGroups.map((group) => (
          <section key={group.id} style={groupSection}>
            <h2 style={groupHeading}>{group.name}</h2>
            <div style={grid} data-testid="menu-grid">
              {group.items.map((item, i) => (
                <CardItem
                  key={item.id}
                  item={item}
                  onAdd={handleAdd}
                  qtyInCart={qtyById.get(item.id) ?? 0}
                  onSetQty={handleSetQty}
                  index={i}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {!loading && !isSearching && groups.length === 0 && !menu.error && (
        <div style={emptyState}>
          <p style={emptyText}>Quán chưa có món nào trong menu lúc này.</p>
        </div>
      )}

      <CartToast
        message={toast?.message ?? null}
        nonce={toast?.nonce ?? 0}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}

function SkeletonGrid(): JSX.Element {
  return (
    <div style={grid} data-testid="menu-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={skeletonCard}>
          <div className="shop-skeleton-block" style={skeletonImage} />
          <div className="shop-skeleton-block" style={skeletonLine} />
          <div className="shop-skeleton-block" style={skeletonLineShort} />
        </div>
      ))}
    </div>
  );
}

// Pulse chỉ animate opacity (không width/height/padding) — tôn trọng
// "giảm chuyển động" của hệ điều hành.
const SKELETON_CSS = `
@keyframes shop-skeleton-pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
.shop-skeleton-block {
  background: var(--bg-sunken);
  border-radius: var(--r-card);
  animation: shop-skeleton-pulse 1.2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .shop-skeleton-block { animation: none; }
}
`;

const page: CSSProperties = {
  minHeight: '100vh',
  paddingBottom: 'var(--sp-8)',
  background: 'var(--bg-page)',
  color: 'var(--text-strong)',
  fontFamily: 'var(--font-body)',
};

// Ẩn khỏi hiển thị nhưng vẫn đọc được bằng trình đọc màn hình — trang không
// cần tiêu đề lớn hiển thị (dải danh mục đã đóng vai trò điều hướng chính).
const srOnly: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** Dòng "Quán mở lại lúc …" trong banner đóng cửa — xuống dòng riêng và đậm hơn câu chủ quán
 *  soạn, vì đây mới là thứ khách đang muốn biết ("bao giờ thì đặt được?"). */
const reopenLine: CSSProperties = {
  display: 'block',
  marginTop: 'var(--sp-1)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  color: 'var(--text-strong)',
};

const bannerStack: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-4) 0 0',
};

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 'var(--sp-5)',
};

const groupSection: CSSProperties = {
  padding: 'var(--sp-6) 0 0',
};

const groupHeading: CSSProperties = {
  margin: '0 0 var(--sp-4)',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-lg)',
  fontWeight: 'var(--fw-bold)' as unknown as number,
  color: 'var(--text-strong)',
};

const searchMetaRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-4) 0',
};

const searchMeta: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const linkButton: CSSProperties = {
  minHeight: 'var(--tap-min)',
  padding: '0 var(--sp-2)',
  border: 'none',
  background: 'transparent',
  color: 'var(--brand-600)',
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 'var(--fw-semibold)' as unknown as number,
  cursor: 'pointer',
};

const emptyState: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--sp-3)',
  // --sp-4 chứ không --gutter: `<main>` đã lo lề trang, đây chỉ là đệm trong ô rỗng.
  padding: 'var(--sp-12) var(--sp-4)',
  textAlign: 'center',
};

const emptyText: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-base)',
  color: 'var(--text-muted)',
};

/** Câu mách nước dưới "không tìm thấy" — nhỏ hơn, vì nó là hướng dẫn chứ không phải kết quả. */
const emptyHint: CSSProperties = {
  margin: 0,
  maxWidth: '38ch',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-muted)',
};

const skeletonCard: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  padding: 'var(--pad-card)',
};

const skeletonImage: CSSProperties = {
  width: '100%',
  aspectRatio: '4 / 3',
};

const skeletonLine: CSSProperties = {
  height: 'var(--fs-md)',
  width: '70%',
};

const skeletonLineShort: CSSProperties = {
  height: 'var(--fs-xl)',
  width: '40%',
};

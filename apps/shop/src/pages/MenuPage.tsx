import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { PublicMenuGroup, PublicStoreStatus, type PublicMenuItem } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { useCart } from '../lib/cart-store.ts';
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

  const filteredItems: PublicMenuItem[] = useMemo(() => {
    if (!normalizedQuery) return [];
    return groups
      .flatMap((g) => g.items)
      .filter(
        (item) =>
          normalizeForSearch(item.name).includes(normalizedQuery) ||
          normalizeForSearch(item.code).includes(normalizedQuery),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, normalizedQuery]);

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

      {groups.length > 0 && (
        <CategoryRail groups={groups} activeCode={activeCode} onSelect={setActiveCode} />
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
            title="Quán đang đóng cửa"
            body={store.data.closed_banner_text}
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
            <div style={emptyState}>
              <p style={emptyText}>Không tìm thấy món nào</p>
              <button type="button" style={linkButton} onClick={clearSearch}>
                Xem tất cả món
              </button>
            </div>
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

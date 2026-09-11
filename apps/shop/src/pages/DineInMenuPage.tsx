import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { PublicMenuGroup, type PublicMenuItem } from '@order/schemas';
import { useApi } from '../lib/use-api.ts';
import { formatVnd } from '../lib/cart-store.ts';
import { consumeDineInCartExpired, useDineInCart } from '../lib/dine-in-cart-store.ts';
import { CardItem, CARD_ITEM_CSS } from '../components/CardItem.tsx';
import { CategoryRail } from '../components/CategoryRail.tsx';
import { BannerNotice } from '../components/BannerNotice.tsx';
import { CartToast } from '../components/CartToast.tsx';

/**
 * Trang menu cho khách QUÉT QR NGỒI BÀN (M4.D-01/02).
 *
 * ── VÌ SAO KHÔNG DÙNG LẠI `MenuPage` ──
 * `MenuPage` gắn cứng vào ba thứ mà luồng này cần khác hẳn: endpoint
 * `/api/public/menu` (loại món chỉ bán tại chỗ), `useCart()` (giỏ online), và trạng thái công
 * tắc nhận đơn ship. Nhồi cả ba thành nhánh `if` trong một trang 500 dòng đang chạy tốt là
 * cách nhanh nhất làm hỏng web đặt hàng — thứ đang có khách thật.
 *
 * Cái được DÙNG LẠI là chỗ chứa gần hết code hiển thị: `CardItem` (card món, nút +, stepper,
 * xử lý món hết hàng), `CategoryRail` (dải danh mục), `CartToast`, `BannerNotice`. Trang này
 * chỉ còn phần lắp ghép.
 *
 * Endpoint là `/api/public/dine-in-menu` — CÓ món `is_online_hidden` (lẩu, món cồng kềnh
 * không ship được). Xem docblock `PublicMenuController.getDineInMenu`.
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

export function DineInMenuPage(): JSX.Element {
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [priceChanged, setPriceChanged] = useState(false);
  const [expired, setExpired] = useState(false);
  const [toast, setToast] = useState<{ message: string; nonce: number } | null>(null);

  const menu = useApi('/api/public/dine-in-menu', MenuResponse);
  const cart = useDineInCart();
  const groups = menu.data?.groups ?? [];

  useEffect(() => {
    if (consumeDineInCartExpired()) setExpired(true);
  }, []);

  // Đồng bộ giỏ với menu mới ĐÚNG MỘT LẦN cho mỗi lần dữ liệu menu đổi (không phải mỗi lần
  // render) — theo dõi tham chiếu mảng đã đồng bộ gần nhất, cùng cách `MenuPage` làm.
  const syncedRef = useRef<PublicMenuGroup[] | null>(null);
  useEffect(() => {
    if (!menu.data) return;
    if (syncedRef.current === menu.data.groups) return;
    syncedRef.current = menu.data.groups;
    const result = cart.applyMenuSync(menu.data.groups);
    if (result.priceChanged) setPriceChanged(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu.data]);

  const normalized = normalizeForSearch(query);
  const isSearching = normalized.length > 0;

  /** Khớp tên món, mã món, hoặc TÊN NHÓM — khách gõ "lẩu", "nướng" là tên nhóm chứ không nằm
   * trong tên món nào. Cùng luật với `MenuPage` (2026-08-06). */
  const filtered: PublicMenuItem[] = useMemo(() => {
    if (!normalized) return [];
    return groups.flatMap((group) => {
      if (normalizeForSearch(group.name).includes(normalized)) return group.items;
      return group.items.filter(
        (item) =>
          normalizeForSearch(item.name).includes(normalized) ||
          normalizeForSearch(item.code).includes(normalized),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, normalized]);

  const qtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of cart.lines) {
      if (!line.unavailable) map.set(line.menu_item_id, line.qty);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines]);

  const handleAdd = (item: PublicMenuItem): void => {
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
    setToast((prev) => ({ message: `Đã thêm ${item.name}`, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  const visibleGroups = activeCode ? groups.filter((g) => g.code === activeCode) : groups;
  const loading = menu.loading && !menu.data;

  return (
    <div>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <style>{CARD_ITEM_CSS}</style>

      <h1 style={srOnly}>Gọi món tại bàn</h1>

      <div style={searchWrap}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm món…"
          aria-label="Tìm món"
          style={searchInput}
        />
      </div>

      {groups.length > 0 && !isSearching && (
        <CategoryRail groups={groups} activeCode={activeCode} onSelect={setActiveCode} />
      )}

      <div style={bannerStack}>
        {expired && (
          <BannerNotice
            tone="brand"
            title="Giỏ món cũ đã được dọn"
            body="Các món chọn từ lượt trước không còn ở đây nữa. Bạn chọn lại giúp quán nhé."
            action={{ label: 'Đã hiểu', onClick: () => setExpired(false) }}
          />
        )}
        {priceChanged && (
          <BannerNotice
            tone="brand"
            title="Giá một vài món đã được cập nhật"
            body="Giỏ món của bạn đã được cập nhật theo giá mới nhất."
            action={{ label: 'Đã hiểu', onClick: () => setPriceChanged(false) }}
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
        <p style={hint}>Đang tải menu…</p>
      ) : isSearching ? (
        <section style={groupSection}>
          <h2 style={groupHeading}>{filtered.length} món khớp «{query}»</h2>
          {filtered.length === 0 ? (
            <p style={hint}>Không tìm thấy món nào. Bạn thử từ ngắn hơn, ví dụ «lẩu», «nướng».</p>
          ) : (
            <div style={grid}>
              {filtered.map((item, i) => (
                <CardItem
                  key={item.id}
                  item={item}
                  onAdd={handleAdd}
                  qtyInCart={qtyById.get(item.id) ?? 0}
                  onSetQty={(it, qty) => cart.setQty(it.id, qty)}
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
            <div style={grid}>
              {group.items.map((item, i) => (
                <CardItem
                  key={item.id}
                  item={item}
                  onAdd={handleAdd}
                  qtyInCart={qtyById.get(item.id) ?? 0}
                  onSetQty={(it, qty) => cart.setQty(it.id, qty)}
                  index={i}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {!loading && groups.length === 0 && !menu.error && (
        <p style={hint}>Quán chưa có món nào trong menu lúc này.</p>
      )}

      {/* Nút dính đáy chỉ hiện khi giỏ CÓ món — hiện sẵn một nút rỗng chỉ để chiếm chỗ đáy
          màn hình trên điện thoại, đúng chỗ ngón tay hay chạm. */}
      {cart.count > 0 && (
        <div style={stickyBar}>
          <Link to="/tai-ban/gio" style={stickyCta}>
            <span>Xem {cart.count} món</span>
            <span>{formatVnd(cart.subtotal)}</span>
          </Link>
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

const srOnly: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

const searchWrap: CSSProperties = { padding: 'var(--sp-3) var(--sp-4) 0' };

const searchInput: CSSProperties = {
  width: '100%',
  padding: 'var(--sp-3)',
  fontSize: 'var(--fs-md)',
  fontFamily: 'inherit',
  color: 'var(--text-strong)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-card)',
  // 16px trở lên: iOS Safari tự phóng to trang khi focus input nhỏ hơn thế.
  minHeight: 44,
};

const bannerStack: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-2)',
  padding: '0 var(--sp-4)',
};

const groupSection: CSSProperties = { padding: 'var(--sp-4)' };

const groupHeading: CSSProperties = {
  margin: '0 0 var(--sp-3)',
  fontSize: 'var(--fs-lg)',
  fontFamily: 'var(--font-display)',
  color: 'var(--text-strong)',
};

const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  gap: 'var(--sp-3)',
};

const hint: CSSProperties = {
  padding: 'var(--sp-4)',
  color: 'var(--text-muted)',
  fontSize: 'var(--fs-sm)',
};

const stickyBar: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  padding: 'var(--sp-3) var(--sp-4)',
  // `env(safe-area-inset-bottom)`: iPhone có thanh gạt dưới, thiếu dòng này là nút bị nó che.
  paddingBottom: 'calc(var(--sp-3) + env(safe-area-inset-bottom, 0px))',
  background: 'var(--bg-surface)',
  borderTop: '1px solid var(--border-subtle)',
};

const stickyCta: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--sp-3)',
  minHeight: 48,
  padding: '0 var(--sp-4)',
  borderRadius: 'var(--r-card)',
  background: 'var(--brand-600)',
  color: 'var(--text-on-brand)',
  fontWeight: 700,
  fontSize: 'var(--fs-md)',
  textDecoration: 'none',
};

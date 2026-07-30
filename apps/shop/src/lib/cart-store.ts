import { useEffect, useState } from 'react';
import type { PublicMenuGroup } from '@order/schemas';
import type { OnlineOrderItemInput } from '@order/schemas';

/**
 * Giỏ hàng localStorage (D-05..D-08) — không có analog thật trong repo
 * (08-PATTERNS.md), tự thiết kế theo đặc tả trong 08-CONTEXT.md.
 *
 * Tách bạch 2 lớp:
 *   (a) Hàm thuần — export được, KHÔNG đụng localStorage/DOM. Đây là phần
 *       được test ở cart-store.test.ts (D-06/D-07).
 *   (b) Hook useCart() — đọc/ghi localStorage, dùng lại các hàm thuần ở trên.
 *
 * D-08: KHÔNG lắng nghe `storage` event — không sync giữa nhiều tab, tab nào
 * ghi sau thắng. Đây là quyết định, không phải thiếu sót.
 */

export const CART_STORAGE_KEY = 'qbl.cart.v1';

const MS_PER_DAY = 24 * 3600_000;
const MAX_QTY = 99;

export type CartLine = {
  menu_item_id: string;
  code: string;
  name: string;
  unit_price: number;
  qty: number;
  note: string | null;
  image: string | null;
  unavailable?: boolean;
};

export type CartState = {
  lines: CartLine[];
  savedAtMs: number;
};

export type SyncResult = {
  lines: CartLine[];
  subtotal: number;
  priceChanged: boolean;
  blocksCheckout: boolean;
};

/**
 * D-06: giỏ hết hạn sau 24 giờ. Nhận `nowMs` làm tham số, KHÔNG đọc
 * `Date.now()` bên trong — để test được không cần fake timer.
 */
export function isCartExpired(savedAtMs: number, nowMs: number): boolean {
  return nowMs - savedAtMs > MS_PER_DAY;
}

/** Định dạng tiền dùng chung cho mọi nơi hiện giá — chỉ 1 chỗ format trong toàn `apps/shop`. */
export function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
}

function clampQty(qty: number): number {
  return Math.min(qty, MAX_QTY);
}

/**
 * D-07: đồng bộ giỏ với menu mới lúc tải trang.
 *   - Giá đổi → cập nhật giá mới + bật `priceChanged`.
 *   - Món hết hàng HOẶC không còn trong menu → GIỮ dòng, gắn `unavailable: true`,
 *     KHÔNG cộng vào `subtotal`, bật `blocksCheckout`.
 *   - Tuyệt đối KHÔNG im lặng xoá dòng hay im lặng đổi giá.
 *   - Đồng bộ luôn `name`/`image` theo menu mới.
 */
export function syncCartWithMenu(lines: CartLine[], groups: PublicMenuGroup[]): SyncResult {
  const byId = new Map<string, { price: number; name: string; image: string | null; is_out_of_stock: boolean }>();
  for (const group of groups) {
    for (const item of group.items) {
      byId.set(item.id, {
        price: item.price,
        name: item.name,
        image: item.images[0] ?? null,
        is_out_of_stock: item.is_out_of_stock,
      });
    }
  }

  let priceChanged = false;
  let blocksCheckout = false;
  let subtotal = 0;

  const nextLines = lines.map((line) => {
    const menuItem = byId.get(line.menu_item_id);

    if (!menuItem) {
      // Món đã bị xoá khỏi menu — GIỮ dòng, không im lặng xoá (D-07).
      blocksCheckout = true;
      return { ...line, unavailable: true };
    }

    const updated: CartLine = {
      ...line,
      name: menuItem.name,
      image: menuItem.image,
    };

    if (menuItem.price !== line.unit_price) {
      priceChanged = true;
      updated.unit_price = menuItem.price;
    }

    if (menuItem.is_out_of_stock) {
      blocksCheckout = true;
      updated.unavailable = true;
      return updated;
    }

    updated.unavailable = false;
    subtotal += updated.unit_price * updated.qty;
    return updated;
  });

  return { lines: nextLines, subtotal, priceChanged, blocksCheckout };
}

/** `qty <= 0` xoá dòng, `qty > 99` kẹp về 99. */
export function setQty(lines: CartLine[], menu_item_id: string, qty: number): CartLine[] {
  if (qty <= 0) {
    return lines.filter((l) => l.menu_item_id !== menu_item_id);
  }
  const clamped = clampQty(qty);
  return lines.map((l) => (l.menu_item_id === menu_item_id ? { ...l, qty: clamped } : l));
}

/** Món đã có thì cộng dồn qty (kẹp 99), chưa có thì thêm dòng mới. */
export function addLine(
  lines: CartLine[],
  item: Omit<CartLine, 'qty' | 'unavailable'>,
  qty: number,
): CartLine[] {
  const existing = lines.find((l) => l.menu_item_id === item.menu_item_id);
  if (existing) {
    return lines.map((l) =>
      l.menu_item_id === item.menu_item_id ? { ...l, qty: clampQty(l.qty + qty) } : l,
    );
  }
  return [...lines, { ...item, qty: clampQty(qty) }];
}

/**
 * Chỉ gửi `{ menu_item_id, qty, note }` — cố ý loại `unit_price`/`name` vì BE
 * tự lookup giá (chống client đặt giá 0đ, T-08-26), và loại các dòng
 * `unavailable` (khách phải xoá trước khi checkout).
 */
export function toSubmitItems(lines: CartLine[]): OnlineOrderItemInput[] {
  return lines
    .filter((l) => !l.unavailable)
    .map((l) => ({
      menu_item_id: l.menu_item_id,
      qty: l.qty,
      note: l.note ?? undefined,
    }));
}

// ─────────────────────────────────────────────────────────────────────────
// (b) Hook useCart() — đọc/ghi localStorage
// ─────────────────────────────────────────────────────────────────────────

function readCartState(): CartState {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return { lines: [], savedAtMs: Date.now() };
    const parsed = JSON.parse(raw) as Partial<CartState>;
    if (!Array.isArray(parsed.lines) || typeof parsed.savedAtMs !== 'number') {
      return { lines: [], savedAtMs: Date.now() };
    }
    if (isCartExpired(parsed.savedAtMs, Date.now())) {
      // D-06: hết hạn → xoá sạch, khách thấy empty state bình thường.
      return { lines: [], savedAtMs: Date.now() };
    }
    return { lines: parsed.lines as CartLine[], savedAtMs: parsed.savedAtMs };
  } catch {
    // localStorage không đọc được (Safari private mode) — coi như giỏ rỗng.
    return { lines: [], savedAtMs: Date.now() };
  }
}

function writeCartState(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ lines, savedAtMs: Date.now() } satisfies CartState),
    );
  } catch {
    // Ghi thất bại — giỏ vẫn dùng được trong phiên hiện tại, chỉ không bền qua reload.
  }
}

export type UseCartResult = {
  lines: CartLine[];
  subtotal: number;
  count: number;
  add: (item: Omit<CartLine, 'qty' | 'unavailable'>, qty: number) => void;
  setQty: (menu_item_id: string, qty: number) => void;
  clear: () => void;
  applyMenuSync: (groups: PublicMenuGroup[]) => { priceChanged: boolean; blocksCheckout: boolean };
};

/**
 * KHÔNG lắng nghe sự kiện `storage` — D-08 chốt không sync giữa nhiều tab,
 * tab nào ghi sau thắng. Khách mobile gần như không mở 2 tab menu.
 */
export function useCart(): UseCartResult {
  const [lines, setLines] = useState<CartLine[]>(() => readCartState().lines);

  useEffect(() => {
    writeCartState(lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const subtotal = lines
    .filter((l) => !l.unavailable)
    .reduce((sum, l) => sum + l.unit_price * l.qty, 0);
  const count = lines.filter((l) => !l.unavailable).reduce((sum, l) => sum + l.qty, 0);

  return {
    lines,
    subtotal,
    count,
    add: (item, qty) => setLines((prev) => addLine(prev, item, qty)),
    setQty: (menu_item_id, qty) => setLines((prev) => setQty(prev, menu_item_id, qty)),
    clear: () => setLines([]),
    applyMenuSync: (groups) => {
      const result = syncCartWithMenu(lines, groups);
      setLines(result.lines);
      return { priceChanged: result.priceChanged, blocksCheckout: result.blocksCheckout };
    },
  };
}

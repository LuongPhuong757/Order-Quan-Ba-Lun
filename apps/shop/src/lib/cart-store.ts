import { useSyncExternalStore } from 'react';
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
 *       Trạng thái nằm ở CẤP MODULE (không phải useState trong hook): mọi nơi
 *       gọi useCart() đều nhìn cùng một giỏ. Trước đây mỗi lần gọi hook là một
 *       useState riêng, nên MenuPage thêm món xong thì AppShell (header +
 *       thanh giỏ nổi) không hề biết — badge đứng yên cho tới khi tải lại trang.
 *
 * D-08: KHÔNG lắng nghe `storage` event — không sync giữa nhiều tab, tab nào
 * ghi sau thắng. Đây là quyết định, không phải thiếu sót.
 */

export const CART_STORAGE_KEY = 'qbl.cart.v1';
/** Ghi chú đơn hàng bước 1 `/cart` (plan 08-11) — tách khoá riêng khỏi `CART_STORAGE_KEY`
 * để bước 2 `/checkout` (plan 08-12) đọc lại độc lập với danh sách dòng giỏ. */
export const CART_NOTE_KEY = 'qbl.cart_note';

const MS_PER_DAY = 24 * 3600_000;
/** Trần số lượng MỖI món. Export vì stepper trên card menu phải khoá nút `+` đúng ở mốc này
 * — nếu FE để bấm quá, `clampQty` im lặng kẹp lại và khách thấy số đứng yên như app bị treo. */
export const MAX_QTY = 99;
/** Khớp `OnlineOrderItemInput.note` (`z.string().max(255)`) — FE kẹp trước để khách
 * không bị 400 sau khi đã gõ xong cả đơn. Đổi ở đây thì phải đổi cả schema. */
export const MAX_ITEM_NOTE_LEN = 255;

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

/**
 * Ghi chú riêng cho MỘT món ("ít cay", "không hành") — đi thẳng xuống bếp qua
 * `order_items.note` khi quán duyệt đơn, khác `customer_note` (ghi chú cho cả đơn,
 * chỉ quán đọc). Chuỗi rỗng/toàn khoảng trắng lưu thành `null` để không tạo dòng
 * 📝 trống trên màn Bếp.
 */
export function setLineNote(lines: CartLine[], menu_item_id: string, note: string): CartLine[] {
  // CỐ Ý không `trim()` giá trị lưu: hàm này chạy sau MỖI phím gõ, trim ở đây thì khách
  // không gõ nổi dấu cách giữa hai từ (space vừa gõ bị xoá ngay). Chỉ kẹp độ dài; khoảng
  // trắng thừa được cắt lúc gửi đơn (`toSubmitItems`).
  const next = note.slice(0, MAX_ITEM_NOTE_LEN);
  return lines.map((l) =>
    l.menu_item_id === menu_item_id ? { ...l, note: next.trim() === '' ? null : next } : l,
  );
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
      // `|| undefined`: ghi chú toàn khoảng trắng KHÔNG được gửi lên — bếp không cần
      // một dòng 📝 rỗng.
      note: l.note?.trim() || undefined,
    }));
}

/** Đọc ghi chú đơn hàng đã lưu — bọc try/catch (Safari private mode ném lỗi khi đọc). */
export function readCartNote(): string {
  try {
    return window.localStorage.getItem(CART_NOTE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Lưu ghi chú mỗi khi khách gõ, để reload không mất (map vào `customer_note` lúc submit). */
export function saveCartNote(note: string): void {
  try {
    window.localStorage.setItem(CART_NOTE_KEY, note);
  } catch {
    // Ghi thất bại — ghi chú vẫn dùng được trong phiên hiện tại, chỉ không bền qua reload.
  }
}

/**
 * Xoá ghi chú sau khi đặt đơn thành công — ghi chú chỉ thuộc về MỘT đơn,
 * khác với tên/SĐT/địa chỉ (lưu lại để prefill đơn sau).
 */
export function clearCartNote(): void {
  try {
    window.localStorage.removeItem(CART_NOTE_KEY);
  } catch {
    // Xoá thất bại (Safari private mode) — chấp nhận, ghi chú cũ chỉ hiện lại nếu reload.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// (b) Hook useCart() — đọc/ghi localStorage
// ─────────────────────────────────────────────────────────────────────────

/**
 * Giỏ vừa bị dọn vì quá 24h (D-06) — đặt ở lần đọc đầu tiên, đọc bằng `consumeCartExpired()`.
 *
 * Vì sao cần (2026-08-06): trước đó giỏ hết hạn biến mất HOÀN TOÀN im lặng. Khách chọn món tối
 * qua, sáng nay mở lại thấy giỏ trống và không có cách nào biết là do hết hạn hay do app nuốt mất
 * đơn của họ — cùng loại "mất dữ liệu không ai báo" mà D-07 cấm ở nhánh món hết hàng.
 */
let cartExpiredOnLoad = false;

/** Trả `true` ĐÚNG MỘT LẦN sau khi giỏ bị dọn vì hết hạn. Lần gọi sau trả `false`: đây là tin
 *  một-lần, hiện lại ở mỗi lần đổi trang thì nó thành tiếng ồn. */
export function consumeCartExpired(): boolean {
  if (!cartExpiredOnLoad) return false;
  cartExpiredOnLoad = false;
  return true;
}

function readCartState(): CartState {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return { lines: [], savedAtMs: Date.now() };
    const parsed = JSON.parse(raw) as Partial<CartState>;
    if (!Array.isArray(parsed.lines) || typeof parsed.savedAtMs !== 'number') {
      return { lines: [], savedAtMs: Date.now() };
    }
    if (isCartExpired(parsed.savedAtMs, Date.now())) {
      // D-06: hết hạn → xoá sạch. Có cờ để trang nói ra một câu; giỏ vốn RỖNG mới là thứ khách
      // thấy, cờ chỉ giải thích vì sao (xem `cartExpiredOnLoad`).
      cartExpiredOnLoad = parsed.lines.length > 0;
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

// ── Store cấp module ─────────────────────────────────────────────────────
// `null` = chưa nạp từ localStorage. Nạp LƯỜI (lần đọc đầu tiên) thay vì lúc
// import module, để file test chạy ở môi trường không có `window` vẫn import
// được các hàm thuần bên trên mà không chạm localStorage.
let cartLines: CartLine[] | null = null;
const listeners = new Set<() => void>();

function getLines(): CartLine[] {
  if (cartLines === null) cartLines = readCartState().lines;
  return cartLines;
}

/** Đổi giỏ: ghi localStorage + báo cho MỌI component đang dùng useCart(). */
function commitLines(next: CartLine[]): void {
  cartLines = next;
  writeCartState(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type UseCartResult = {
  lines: CartLine[];
  subtotal: number;
  count: number;
  add: (item: Omit<CartLine, 'qty' | 'unavailable'>, qty: number) => void;
  setQty: (menu_item_id: string, qty: number) => void;
  setNote: (menu_item_id: string, note: string) => void;
  clear: () => void;
  /** THAY nguyên giỏ bằng danh sách khác. Chỉ dùng cho chế độ sửa đơn (`order-edit.ts`): nạp món
   * của đơn đang chờ vào giỏ, và trả lại giỏ cũ khi thoát. Không dùng cho luồng đặt hàng thường —
   * ở đó chỉ có `add`/`setQty`, thứ khách hiểu được từ thao tác họ vừa làm. */
  replace: (lines: CartLine[]) => void;
  applyMenuSync: (groups: PublicMenuGroup[]) => { priceChanged: boolean; blocksCheckout: boolean };
};

/**
 * KHÔNG lắng nghe sự kiện `storage` — D-08 chốt không sync giữa nhiều tab,
 * tab nào ghi sau thắng. Khách mobile gần như không mở 2 tab menu.
 */
export function useCart(): UseCartResult {
  const lines = useSyncExternalStore(subscribe, getLines, getLines);

  const subtotal = lines
    .filter((l) => !l.unavailable)
    .reduce((sum, l) => sum + l.unit_price * l.qty, 0);
  const count = lines.filter((l) => !l.unavailable).reduce((sum, l) => sum + l.qty, 0);

  return {
    lines,
    subtotal,
    count,
    add: (item, qty) => commitLines(addLine(getLines(), item, qty)),
    setQty: (menu_item_id, qty) => commitLines(setQty(getLines(), menu_item_id, qty)),
    setNote: (menu_item_id, note) => commitLines(setLineNote(getLines(), menu_item_id, note)),
    clear: () => commitLines([]),
    replace: (next) => commitLines(next),
    applyMenuSync: (groups) => {
      const result = syncCartWithMenu(getLines(), groups);
      commitLines(result.lines);
      return { priceChanged: result.priceChanged, blocksCheckout: result.blocksCheckout };
    },
  };
}

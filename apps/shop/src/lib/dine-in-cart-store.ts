import { useSyncExternalStore } from 'react';
import type { PublicMenuGroup } from '@order/schemas';
import {
  addLine,
  setLineNote,
  setQty as setQtyPure,
  syncCartWithMenu,
  type CartLine,
  type UseCartResult,
} from './cart-store.ts';

/**
 * GIỎ HÀNG CỦA KHÁCH NGỒI BÀN (M4) — store RIÊNG, tách hẳn giỏ đặt online.
 *
 * ── VÌ SAO KHÔNG DÙNG CHUNG `cart-store.ts` ──
 * `cart-store.ts` là một singleton cấp module khoá vào đúng một khoá localStorage
 * (`qbl.cart.v1`). Dùng chung nghĩa là khách đang có giỏ đặt ship dở dang mà quét QR ngồi bàn
 * là hai giỏ đè lên nhau — món của bữa tại bàn trộn vào đơn ship, hoặc ngược lại. Đó không
 * phải lỗi hiển thị mà là món sai vào bill.
 *
 * Cái được DÙNG LẠI là toàn bộ HÀM THUẦN của file đó (`addLine`, `setQty`, `setLineNote`,
 * `syncCartWithMenu`) — chỗ chứa các luật tinh tế: kẹp qty về 99, giữ dòng món hết hàng thay
 * vì xoá im lặng, cập nhật giá mới mà vẫn báo là đã đổi. Copy các luật đó ra là hẹn ngày
 * chúng lệch nhau.
 *
 * ── TTL 4 GIỜ, KHÁC 24 GIỜ CỦA GIỎ ONLINE ──
 * Giỏ online sống 24h vì khách chọn tối nay, đặt sáng mai là chuyện thường. Giỏ tại bàn thì
 * gắn với MỘT lượt ngồi ăn: quá 4 giờ nghĩa là lượt khác, có thể là người khác dùng chung máy.
 * Giỏ hôm qua hiện lại lúc khách vừa ngồi xuống là đường ngắn nhất để món lạ lọt vào bill.
 */
export const DINE_IN_CART_KEY = 'qbl.dinein.cart.v1';

/** Mã 5 số đã sinh gần nhất (M4.D-08) — đóng tab mở lại vẫn đọc được cho nhân viên. */
export const DINE_IN_CODE_KEY = 'qbl.dinein.code.v1';

export const DINE_IN_CART_TTL_MS = 4 * 60 * 60 * 1000;

type StoredCart = { lines: CartLine[]; savedAtMs: number };

let expiredOnLoad = false;

/** Trả `true` ĐÚNG MỘT LẦN sau khi giỏ bị dọn vì hết hạn — cùng lệ với `consumeCartExpired()`
 * của giỏ online: giỏ rỗng là thứ khách thấy, cờ này chỉ để nói ra vì sao. */
export function consumeDineInCartExpired(): boolean {
  if (!expiredOnLoad) return false;
  expiredOnLoad = false;
  return true;
}

function readStored(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(DINE_IN_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredCart>;
    if (!Array.isArray(parsed.lines) || typeof parsed.savedAtMs !== 'number') return [];
    if (Date.now() - parsed.savedAtMs > DINE_IN_CART_TTL_MS) {
      expiredOnLoad = parsed.lines.length > 0;
      return [];
    }
    return parsed.lines as CartLine[];
  } catch {
    // localStorage không đọc được (Safari private mode) — coi như giỏ rỗng. KHÔNG throw:
    // trang của khách không được sập vì một lần đọc storage.
    return [];
  }
}

function writeStored(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(
      DINE_IN_CART_KEY,
      JSON.stringify({ lines, savedAtMs: Date.now() } satisfies StoredCart),
    );
  } catch {
    // Ghi thất bại — giỏ vẫn dùng được trong phiên hiện tại, chỉ không bền qua reload.
  }
}

// Nạp LƯỜI (lần đọc đầu) thay vì lúc import, để test import được hàm thuần mà không chạm
// localStorage — cùng lý do như `cart-store.ts`.
let lines: CartLine[] | null = null;
const listeners = new Set<() => void>();

function getLines(): CartLine[] {
  if (lines === null) lines = readStored();
  return lines;
}

function commit(next: CartLine[]): void {
  lines = next;
  writeStored(next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Cùng hình dạng `useCart()` để dùng lại được `CardItem`/`QtyInput` không cần đổi props. */
export function useDineInCart(): UseCartResult {
  const current = useSyncExternalStore(subscribe, getLines, getLines);

  const subtotal = current
    .filter((l) => !l.unavailable)
    .reduce((sum, l) => sum + l.unit_price * l.qty, 0);
  const count = current.filter((l) => !l.unavailable).reduce((sum, l) => sum + l.qty, 0);

  return {
    lines: current,
    subtotal,
    count,
    add: (item, qty) => commit(addLine(getLines(), item, qty)),
    setQty: (menu_item_id, qty) => commit(setQtyPure(getLines(), menu_item_id, qty)),
    setNote: (menu_item_id, note) => commit(setLineNote(getLines(), menu_item_id, note)),
    clear: () => commit([]),
    replace: (next) => commit(next),
    applyMenuSync: (groups: PublicMenuGroup[]) => {
      const result = syncCartWithMenu(getLines(), groups);
      commit(result.lines);
      return { priceChanged: result.priceChanged, blocksCheckout: result.blocksCheckout };
    },
  };
}

/** Xoá giỏ tại bàn không qua hook — dùng sau khi nhân viên đã nhận món. */
export function clearDineInCart(): void {
  commit([]);
}

// ── Mã đã sinh gần nhất (M4.D-08) ─────────────────────────────────────────────────────────

export type RememberedCode = { code: string; expires_at: number };

/**
 * Nhớ mã để khách đóng tab mở lại vẫn đọc được cho nhân viên.
 *
 * Tự bỏ mã đã quá hạn ngay lúc ĐỌC, không cần ai đi dọn: mã quá hạn hiện lại trên màn hình là
 * tệ hơn không hiện gì — khách đọc số cho nhân viên rồi mới biết nó chết.
 */
export function readRememberedCode(): RememberedCode | null {
  try {
    const raw = window.localStorage.getItem(DINE_IN_CODE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedCode>;
    if (typeof parsed.code !== 'string' || typeof parsed.expires_at !== 'number') return null;
    if (Date.now() >= parsed.expires_at) {
      clearRememberedCode();
      return null;
    }
    return { code: parsed.code, expires_at: parsed.expires_at };
  } catch {
    return null;
  }
}

export function saveRememberedCode(value: RememberedCode): void {
  try {
    window.localStorage.setItem(DINE_IN_CODE_KEY, JSON.stringify(value));
  } catch {
    // Ghi thất bại — mã vẫn hiện trong phiên hiện tại, chỉ không sống qua reload.
  }
}

export function clearRememberedCode(): void {
  try {
    window.localStorage.removeItem(DINE_IN_CODE_KEY);
  } catch {
    // Bỏ qua — xem `saveRememberedCode`.
  }
}

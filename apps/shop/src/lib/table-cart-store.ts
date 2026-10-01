/**
 * M7 — giỏ của khách ĐANG NGỒI TRONG QUÁN, và phiên bàn của thiết bị.
 *
 * ── Vì sao KHÔNG dùng lại `qbl.cart.v1` của luồng đặt ship ──
 * Giỏ đó TTL 24 giờ và thuộc luồng pickup/delivery. Trộn vào thì khách đặt ship hôm qua, hôm
 * nay quét QR ngồi ăn sẽ thấy món cũ nằm sẵn trong giỏ tại bàn — đường ngắn nhất để một món
 * khách không gọi lọt vào bill. Hai luồng, hai khoá, không chia sẻ gì.
 *
 * ⚠ localStorage trên Safari riêng tư NÉM LỖI CẢ KHI ĐỌC. Mọi ngả bọc try/catch; hỏng thì rơi
 * về RAM và trang vẫn dùng được hết bữa (chỉ mất khi tải lại trang).
 */

const CART_KEY = 'qbl.table_cart.v1';
const SESSION_KEY = 'qbl.table_session.v1';

/** Một lượt ngồi ăn. Hết 8 giờ thì chắc chắn là lượt khác. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type TableCartLine = {
  menu_item_id: string;
  name: string;
  unit_price: number;
  qty: number;
  note: string;
};

export type TableSession = {
  guest_token: string;
  table_name: string;
  savedAt: number;
};

let cartMem: TableCartLine[] = [];
let sessionMem: TableSession | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeTableCart(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── Giỏ ──────────────────────────────────────────────────────────────────────────────── */

export function readTableCart(): TableCartLine[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return cartMem;
    const parsed = JSON.parse(raw) as TableCartLine[];
    return Array.isArray(parsed) ? parsed : cartMem;
  } catch {
    return cartMem;
  }
}

function writeTableCart(lines: TableCartLine[]): void {
  cartMem = lines;
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(lines));
  } catch {
    /* RAM đủ cho phiên hiện tại */
  }
  emit();
}

/** Thêm món. Trùng `menu_item_id` thì CỘNG DỒN chứ không tạo dòng thứ hai — bảng chờ duyệt
 *  ép mỗi món một dòng, và "bỏ dòng này" sẽ thành câu không có nghĩa xác định nếu có hai dòng
 *  cùng món. */
export function addTableLine(line: Omit<TableCartLine, 'qty'>, qty = 1): void {
  const cart = readTableCart();
  const i = cart.findIndex((l) => l.menu_item_id === line.menu_item_id);
  if (i >= 0) {
    const next = [...cart];
    next[i] = { ...next[i]!, qty: Math.min(20, next[i]!.qty + qty), note: line.note || next[i]!.note };
    writeTableCart(next);
    return;
  }
  writeTableCart([...cart, { ...line, qty: Math.min(20, qty) }]);
}

export function setTableQty(menuItemId: string, qty: number): void {
  const cart = readTableCart();
  if (qty <= 0) {
    writeTableCart(cart.filter((l) => l.menu_item_id !== menuItemId));
    return;
  }
  writeTableCart(cart.map((l) => (l.menu_item_id === menuItemId ? { ...l, qty: Math.min(20, qty) } : l)));
}

export function setTableNote(menuItemId: string, note: string): void {
  const cart = readTableCart();
  writeTableCart(cart.map((l) => (l.menu_item_id === menuItemId ? { ...l, note: note.slice(0, 255) } : l)));
}

export function clearTableCart(): void {
  writeTableCart([]);
}

export function tableCartCount(lines: readonly TableCartLine[]): number {
  return lines.reduce((t, l) => t + l.qty, 0);
}

export function tableCartTotal(lines: readonly TableCartLine[]): number {
  return lines.reduce((t, l) => t + l.qty * l.unit_price, 0);
}

/* ── Phiên bàn ────────────────────────────────────────────────────────────────────────── */

export function readTableSession(): TableSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return sessionMem;
    const s = JSON.parse(raw) as TableSession;
    if (!s?.guest_token) return null;
    if (Date.now() - (s.savedAt ?? 0) > SESSION_TTL_MS) return null;
    return s;
  } catch {
    return sessionMem;
  }
}

export function writeTableSession(s: TableSession | null): void {
  sessionMem = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* bỏ qua */
  }
  emit();
}

/** M7 §3.4 — mỗi lượt gửi cần một `client_request_id` ỔN ĐỊNH qua các lần retry, nhưng MỚI cho
 *  mỗi lượt. Sinh một lần lúc mở tấm giỏ, dùng lại khi mạng lỗi phải bấm lại. */
export function newClientRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Trình duyệt cũ không có randomUUID — ghép tay cho đúng dạng UUID v4, vì BE validate format.
    const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  }
}

export const TABLE_CART_MAX_QTY = 20;
export const TABLE_CART_MAX_LINES = 20;

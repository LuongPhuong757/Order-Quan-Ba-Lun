/**
 * M7 — dựng dữ liệu cho thẻ "khách gọi" trên màn bếp.
 *
 * Hàm THUẦN, tách khỏi `KitchenPage.tsx` vì file đó đã 2199 dòng (M7.R11) và vì test của
 * apps/web chạy môi trường node, không jsdom — thứ gì cần test phải nằm ở `lib/`.
 *
 * ⚠ TUYỆT ĐỐI KHÔNG ĐƯỢC NÉM. Nó chạy trong vòng poll 2 giây của màn bếp; một payload rác từ
 * endpoint mới mà làm vỡ vòng lặp thì bếp mất luôn danh sách MÓN — hỏng việc đang chạy ổn định
 * chỉ vì một tính năng mới. Mọi nhánh lỗi trả mảng rỗng.
 */

export type PendingItem = {
  menu_item_id: string;
  name: string;
  qty: number;
  note: string | null;
  price_now: number;
  out_of_stock: boolean;
};

export type PendingRequest = {
  id: string;
  order_id: string;
  table_code: string;
  table_name: string;
  created_at: number;
  items: PendingItem[];
  /** Món QUÁN TỰ THÊM khi duyệt lượt này (khăn lạnh, bàn tại chỗ gọi lần đầu). */
  auto_items: Array<{ name: string; qty: number; price_now: number }>;
  total_now: number;
};

export type PendingCall = {
  id: string;
  table_code: string;
  table_name: string;
  kind: 'STAFF' | 'BILL';
  created_at: number;
  /** Lý do khách ghi lúc bấm gọi ("thêm bát đũa"…). NULL = gọi suông.
   *  Có nó thì nhân viên mang luôn thứ khách cần xuống bàn, khỏi xuống hỏi rồi đi lên lấy. */
  note: string | null;
};

export type PendingPayload = { requests: PendingRequest[]; calls: PendingCall[] };

export type GuestCardLine = {
  qty: number;
  name: string;
  note: string | null;
  gone: boolean;
  /** Dòng do QUÁN tự thêm, khách không gọi. Thẻ phải nói rõ, không thì nhân viên tưởng khách
   *  gọi khăn rồi thắc mắc sao tự dưng có. */
  auto?: boolean;
};

export type GuestCard = {
  request_id: string;
  table_name: string;
  ageMs: number;
  blink: boolean;
  lines: GuestCardLine[];
  subtotal: number;
};

/** M7.R7 — nhân viên quên duyệt là rủi ro CAO. Sau 3 phút thẻ nhấp nháy để không trôi mất
 *  giữa đống món. Con số này là hằng số có test, không phải magic number rải trong JSX. */
export const BLINK_AFTER_MS = 180_000;

export function buildGuestCards(payload: PendingPayload | undefined | null, nowMs: number): GuestCard[] {
  try {
    const reqs = payload?.requests;
    if (!Array.isArray(reqs)) return [];
    const out: GuestCard[] = [];
    for (const r of reqs) {
      // Một lượt hỏng không được làm hỏng các lượt còn lại — bếp vẫn phải thấy phần đọc được.
      try {
        if (!r || typeof r.id !== 'string' || !Array.isArray(r.items)) continue;
        const ageMs = Math.max(0, nowMs - Number(r.created_at ?? nowMs));
        out.push({
          request_id: r.id,
          table_name: r.table_name || r.table_code || '',
          ageMs,
          blink: ageMs >= BLINK_AFTER_MS,
          lines: [
            ...r.items.map((i) => ({
              qty: Number(i?.qty ?? 0),
              name: i?.name ?? '',
              note: i?.note ?? null,
              // Hiện gạch ngang + nhãn "hết — sẽ bỏ" TRƯỚC khi bấm, để một cú bấm vẫn là một
              // quyết định có hiểu biết (M7.R5).
              gone: Boolean(i?.out_of_stock),
            })),
            // Khăn lạnh quán tự thêm. Phải hiện TRƯỚC khi bấm: nó vào bill thật, và con số
            // tạm tính dưới chân thẻ đã cộng nó rồi.
            ...(Array.isArray(r.auto_items) ? r.auto_items : []).map((a) => ({
              qty: Number(a?.qty ?? 0),
              name: a?.name ?? '',
              note: null,
              gone: false,
              auto: true,
            })),
          ],
          // Tổng do BE tính theo giá HIỆN TẠI và đã loại dòng hết hàng (M7.D-11).
          subtotal: Number(r.total_now ?? 0),
        });
      } catch {
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** "2 phút trước" — đủ cho một thẻ cần liếc là hiểu, không cần giây. */
export function describeAge(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s} giây trước`;
  return `${Math.floor(s / 60)} phút trước`;
}

/* ── Gộp lời nhắn theo BÀN ──────────────────────────────────────────────────────────────
 *
 * Một bàn bấm gọi 5 lần là 5 chip, và dải chip chỉ rộng bằng thanh trên — bàn ồn ào đẩy hết
 * bàn khác ra khỏi màn, đúng lúc những bàn kia cũng đang chờ. Chủ quán báo 2026-10-02.
 *
 * Gộp theo BÀN chứ không theo (bàn, loại): nhân viên đi tới bàn MỘT lần và giải quyết mọi thứ
 * bàn đó cần, nên một chuyến đi là một chip. Loại nào có thì hiện bằng biểu tượng trong chip.
 */

export type CallGroup = {
  table_code: string;
  table_name: string;
  /** Lời nhắn cũ nhất của bàn — dùng để xếp thứ tự: bàn chờ lâu nhất đứng đầu dải. */
  oldest_at: number;
  has_staff: boolean;
  has_bill: boolean;
  /** Mọi lời nhắn của bàn, cũ trước mới sau. */
  items: PendingCall[];
};

export function groupCallsByTable(calls: PendingCall[] | undefined | null): CallGroup[] {
  if (!Array.isArray(calls)) return [];
  const by = new Map<string, CallGroup>();
  for (const c of calls) {
    if (!c || typeof c.id !== 'string') continue;
    // Khoá theo `table_code` chứ không theo `table_name`: tên bàn đổi được giữa chừng, mã thì
    // là ảnh chụp lúc khách bấm. Gộp theo tên là hai lời nhắn của cùng một bàn tách làm hai.
    const key = c.table_code || c.table_name || c.id;
    const g = by.get(key);
    if (g) {
      g.items.push(c);
      g.oldest_at = Math.min(g.oldest_at, Number(c.created_at ?? g.oldest_at));
      g.has_staff = g.has_staff || c.kind === 'STAFF';
      g.has_bill = g.has_bill || c.kind === 'BILL';
    } else {
      by.set(key, {
        table_code: c.table_code,
        table_name: c.table_name || c.table_code || '',
        oldest_at: Number(c.created_at ?? 0),
        has_staff: c.kind === 'STAFF',
        has_bill: c.kind === 'BILL',
        items: [c],
      });
    }
  }
  const out = [...by.values()];
  for (const g of out) g.items.sort((a, b) => Number(a.created_at) - Number(b.created_at));
  // Bàn chờ lâu nhất đứng trước: dải cuộn ngang, thứ nằm ngoài tầm mắt phải là thứ mới nhất.
  out.sort((a, b) => a.oldest_at - b.oldest_at);
  return out;
}

/** Câu tóm tắt in trên chip. Một lời nhắn thì in thẳng lời đó; nhiều thì đếm. */
export function describeGroup(g: CallGroup): string {
  if (g.items.length > 1) return g.items.length + ' lời nhắn';
  const one = g.items[0]!;
  if (one.note) return '💬 ' + (one.note.length > 22 ? one.note.slice(0, 22) + '…' : one.note);
  return one.kind === 'STAFF' ? 'gọi thêm đồ' : 'thanh toán';
}

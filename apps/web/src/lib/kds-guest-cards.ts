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

export type GuestCardLine = { qty: number; name: string; note: string | null; gone: boolean };

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
          lines: r.items.map((i) => ({
            qty: Number(i?.qty ?? 0),
            name: i?.name ?? '',
            note: i?.note ?? null,
            // Hiện gạch ngang + nhãn "hết — sẽ bỏ" TRƯỚC khi bấm, để một cú bấm vẫn là một
            // quyết định có hiểu biết (M7.R5).
            gone: Boolean(i?.out_of_stock),
          })),
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

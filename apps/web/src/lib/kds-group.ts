// Gộp món cho màn Bếp — dùng cho 2 chế độ xem "Theo món" và "Theo phòng/bàn".
//
// Tách khỏi KitchenPage.tsx vì đây là chỗ dễ sai nhất mà lại KHÔNG thấy bằng mắt:
// khoá gộp sai thì hai món khác nhau dồn vào một khối, tổng số phần sai thì bếp múc
// thiếu bát — cả hai chỉ lộ ra khi khách đã ngồi chờ. Ở đây thì test bắt được.

export type GroupableItem = {
  id: string;
  /** NULL với dòng ghi chú — ghi chú không trỏ tới món nào trong menu. */
  menu_item_id: string | null;
  menu_item_name: string;
  qty: number;
  created_at: number;
  is_priority?: boolean;
  is_note?: boolean;
  table_code: string;
  table_name: string;
};

export type KdsGroup<T extends GroupableItem> = {
  key: string;
  title: string;
  /** Dòng phụ dưới tiêu đề — "Bàn 10 ×2 · Bàn 3 ×3", hoặc "4 dòng · 7 phần". */
  subtitle: string;
  /** Giữ nguyên thứ tự đã sort ở buckets: ⭐ ưu tiên trước, rồi gọi trước nấu trước. */
  items: T[];
  /** Tổng SỐ PHẦN của cả nhóm — KHÔNG phải số dòng. Bếp cần biết múc mấy bát. */
  qty: number;
  /** created_at nhỏ nhất trong nhóm — nhóm nào khách chờ lâu nhất thì lên đầu. */
  oldest: number;
  hasPriority: boolean;
};

/** "Bàn 10 ×2 · Bàn 3 ×3" — cộng số phần theo từng bàn, giữ thứ tự bàn xuất hiện
 *  (tức là bàn gọi trước đứng trước, khớp với thứ tự các dòng bên dưới tiêu đề). */
function tableSummary(items: GroupableItem[]): string {
  const order: string[] = [];
  const byTable = new Map<string, number>();
  for (const it of items) {
    if (!byTable.has(it.table_name)) order.push(it.table_name);
    byTable.set(it.table_name, (byTable.get(it.table_name) ?? 0) + it.qty);
  }
  return order.map((t) => `${t} ×${byTable.get(t)}`).join(' · ');
}

/** Thứ tự các nhóm.
 *  - 'qty'    : nhóm nhiều phần nhất lên trước, bằng nhau thì nhóm chờ lâu nhất trước.
 *               Dùng cho "Theo món": mục đích của chế độ này là nấu một lượt cho xong,
 *               nên khối 7 phần đáng làm trước khối 1 phần dù khối 1 phần gọi sớm hơn.
 *  - 'oldest' : nhóm chờ lâu nhất lên trước. Dùng cho "Theo phòng/bàn": bàn nhiều món
 *               không có nghĩa là bàn gấp hơn, ai ngồi chờ lâu hơn mới là gấp. */
export type GroupOrder = 'qty' | 'oldest';

function build<T extends GroupableItem>(
  items: T[],
  keyOf: (it: T) => string,
  titleOf: (it: T) => string,
  subtitleOf: (items: T[]) => string,
  order: GroupOrder,
): KdsGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }

  const out: KdsGroup<T>[] = [];
  for (const [key, arr] of map) {
    out.push({
      key,
      title: titleOf(arr[0]),
      subtitle: subtitleOf(arr),
      items: arr,
      qty: arr.reduce((s, i) => s + i.qty, 0),
      oldest: arr.reduce((m, i) => Math.min(m, i.created_at), Number.POSITIVE_INFINITY),
      hasPriority: arr.some((i) => !!i.is_priority),
    });
  }

  out.sort((a, b) => {
    // ⭐ ƯU TIÊN vẫn thắng mọi tiêu chí khác: nhân viên bấm nó khi khách SẮP VỀ, để
    // sau thì món ra lúc khách đã đi.
    if (a.hasPriority !== b.hasPriority) return a.hasPriority ? -1 : 1;
    if (order === 'qty' && a.qty !== b.qty) return b.qty - a.qty;
    return a.oldest - b.oldest;
  });
  return out;
}

/** Gộp theo MÓN: mọi bàn gọi cùng một món dồn về 1 khối để bếp nấu 1 lượt.
 *  Thứ tự: ⭐ ưu tiên → nhiều phần nhất → chờ lâu nhất. */
export function groupByItem<T extends GroupableItem>(items: T[]): KdsGroup<T>[] {
  return build(
    items,
    // Ghi chú không có menu_item_id → gộp theo nội dung: hai bàn cùng xin "lấy bát"
    // thì đứng chung, còn yêu cầu khác nội dung thì KHÔNG được dồn vào nhau.
    // Món thiếu menu_item_id (món đã bị xoá khỏi menu) fallback về tên, không thì
    // mọi món đã xoá gộp thành một khối mang tên món đầu tiên.
    (it) => (it.is_note ? `note:${it.menu_item_name}` : it.menu_item_id ?? `name:${it.menu_item_name}`),
    (it) => it.menu_item_name,
    tableSummary,
    'qty',
  );
}

/** Gộp theo PHÒNG/BÀN: thấy hết món của một bàn để ra cùng lúc, khách không ăn lẻ. */
export function groupByTable<T extends GroupableItem>(items: T[]): KdsGroup<T>[] {
  return build(
    items,
    // table_code là mã bàn (duy nhất), table_name là tên hiển thị (có thể trùng nhau
    // giữa 2 bàn khi chủ quán đặt tên theo khách) → gộp bằng code, hiện bằng name.
    (it) => it.table_code,
    (it) => it.table_name,
    (arr) => `${arr.length} dòng · ${arr.reduce((s, i) => s + i.qty, 0)} phần`,
    'oldest',
  );
}

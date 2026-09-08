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

/** Thứ tự các nhóm — bếp tự chọn, MẶC ĐỊNH 'az'.
 *  - 'az'  : theo tên A→Z (so sánh theo tiếng Việt). Đây là thứ tự duy nhất KHÔNG phụ
 *            thuộc dữ liệu đang chạy: bấm xong một dòng thì tên món / tên bàn không
 *            đổi, nên không nhóm nào nhảy chỗ. Bếp nhớ được "món này ở khoảng giữa"
 *            như nhớ vị trí trên một quyển menu giấy.
 *  - 'qty' : nhiều phần nhất lên trước, bằng nhau thì nhóm chờ lâu nhất trước. Dùng
 *            khi muốn nấu gộp cho xong khối lớn. Thứ tự này ĐỔI theo tiến độ nên phải
 *            đi kèm applyStickyOrder, không thì nhóm trượt dưới ngón tay.
 *
 *  Nhóm có món ⭐ ƯU TIÊN luôn đứng đầu ở CẢ HAI thứ tự: nhân viên bấm ⭐ khi khách
 *  sắp về, để nó đúng chỗ theo bảng chữ cái thì trong danh sách 36 nhóm là không ai
 *  thấy. Đây là một lần nhảy do người bấm, không phải nhảy tự động. */
export type GroupOrder = 'az' | 'qty';

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
    if (a.hasPriority !== b.hasPriority) return a.hasPriority ? -1 : 1;
    if (order === 'az') {
      // localeCompare('vi'): 'Ốc' phải đứng sau 'Nộm' chứ không bị đẩy xuống cuối như
      // khi so sánh mã ký tự thô. numeric:true để "Bàn 2" đứng trước "Bàn 10".
      const c = a.title.localeCompare(b.title, 'vi', { numeric: true, sensitivity: 'base' });
      if (c !== 0) return c;
      return a.oldest - b.oldest;
    }
    if (a.qty !== b.qty) return b.qty - a.qty;
    return a.oldest - b.oldest;
  });
  return out;
}

/** Gộp theo MÓN: mọi bàn gọi cùng một món dồn về 1 khối để bếp nấu 1 lượt. */
export function groupByItem<T extends GroupableItem>(
  items: T[],
  order: GroupOrder = 'az',
): KdsGroup<T>[] {
  return build(
    items,
    // Ghi chú không có menu_item_id → gộp theo nội dung: hai bàn cùng xin "lấy bát"
    // thì đứng chung, còn yêu cầu khác nội dung thì KHÔNG được dồn vào nhau.
    // Món thiếu menu_item_id (món đã bị xoá khỏi menu) fallback về tên, không thì
    // mọi món đã xoá gộp thành một khối mang tên món đầu tiên.
    (it) => (it.is_note ? `note:${it.menu_item_name}` : it.menu_item_id ?? `name:${it.menu_item_name}`),
    (it) => it.menu_item_name,
    tableSummary,
    order,
  );
}

/** Gộp theo PHÒNG/BÀN: thấy hết món của một bàn để ra cùng lúc, khách không ăn lẻ. */
export function groupByTable<T extends GroupableItem>(
  items: T[],
  order: GroupOrder = 'az',
): KdsGroup<T>[] {
  return build(
    items,
    // table_code là mã bàn (duy nhất), table_name là tên hiển thị (có thể trùng nhau
    // giữa 2 bàn khi chủ quán đặt tên theo khách) → gộp bằng code, hiện bằng name.
    (it) => it.table_code,
    (it) => it.table_name,
    (arr) => `${arr.length} dòng · ${arr.reduce((s, i) => s + i.qty, 0)} phần`,
    order,
  );
}

/** Áp thứ tự ĐANG HIỆN lên danh sách nhóm vừa tính lại, để nhóm không tự nhảy chỗ.
 *
 *  Vì sao cần: thứ tự nhóm ở "Theo món" phụ thuộc SỐ PHẦN, mà bếp bấm xong một dòng
 *  là số phần của nhóm đó tụt ngay — nhóm rơi xuống dưới, mọi nhóm khác dịch lên, và
 *  poll 2 giây một lần nên chuyện đó xảy ra ngay dưới ngón tay đang bấm. Bếp mất dấu
 *  chỗ mình đang làm và bấm nhầm sang món khác. ("Theo phòng/bàn" cũng vậy khi bàn
 *  hết món.)
 *
 *  Quy tắc:
 *  - Nhóm đã hiện thì GIỮ NGUYÊN vị trí, kể cả khi số phần đã đổi.
 *  - Nhóm biến mất (làm xong hết) thì rụng khỏi danh sách.
 *  - Nhóm MỚI xuất hiện thì xuống CUỐI, theo đúng thứ tự sort — không chen vào giữa
 *    danh sách bếp đang làm.
 *  - Trừ nhóm có món ⭐ ƯU TIÊN: nó luôn nổi lên đầu. Nhân viên bấm ⭐ khi khách sắp
 *    về, để nó nằm cuối là mất luôn ý nghĩa của cái cờ đó.
 *
 *  `prevKeys` rỗng (lần đầu, hoặc vừa bấm "Sắp lại") → dùng nguyên thứ tự sort.
 */
export function applyStickyOrder<T extends GroupableItem>(
  sorted: KdsGroup<T>[],
  prevKeys: readonly string[],
): KdsGroup<T>[] {
  if (prevKeys.length === 0) return sorted;

  const byKey = new Map(sorted.map((g) => [g.key, g]));
  const out: KdsGroup<T>[] = [];
  const taken = new Set<string>();

  for (const g of sorted) {
    if (!g.hasPriority) continue;
    out.push(g);
    taken.add(g.key);
  }
  for (const k of prevKeys) {
    if (taken.has(k)) continue;
    const g = byKey.get(k);
    if (!g) continue; // nhóm đã làm xong hết
    out.push(g);
    taken.add(k);
  }
  for (const g of sorted) {
    if (taken.has(g.key)) continue;
    out.push(g); // nhóm mới → xuống cuối
  }
  return out;
}

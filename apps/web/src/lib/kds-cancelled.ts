// Hàng "món vừa bị huỷ" giữ lại trên MÀN BẾP cho tới khi bếp bấm "Đã biết".
//
// Vì sao cần: món bị huỷ thì rời khỏi state KITCHEN/COOKING/READY nên biến mất khỏi
// danh sách bếp NGAY LẬP TỨC. Nếu bếp đang nấu món đó thì nó chỉ thấy một dòng tự
// dưng mất, không biết vì sao — vẫn nấu tiếp rồi mang ra một món không ai gọi. Bản
// ghi trong chuông 🔔 không giải quyết được: giữa lúc nấu không ai mở chuông ra xem.
//
// Nên món bị huỷ phải NẰM LẠI trên màn, tô đỏ, kèm ai huỷ + lý do, và chỉ mất đi khi
// bếp tự tay xác nhận đã đọc.
//
// Lọc theo `prev_state`: món còn PENDING (chưa báo bếp) mà huỷ thì bếp chưa từng thấy
// nó, hiện ra chỉ gây nhiễu. Chỉ giữ món đã từng ở KITCHEN / COOKING / READY.

/** Các state có nghĩa "món này ĐÃ nằm trên màn bếp". */
const KITCHEN_STATES = new Set(['KITCHEN', 'COOKING', 'READY']);

/** Tự hết hạn sau 1 giờ. Đây là van an toàn, KHÔNG phải cách dọn chính (bếp bấm "Đã
 *  biết" mới là cách chính): quán đóng cửa mà còn 3 thẻ đỏ thì sáng sau mở máy ra
 *  không ai hiểu chúng nói về hôm nào. 1 giờ đủ rộng cho một lúc bếp đông khách. */
export const CANCEL_TTL_MS = 60 * 60 * 1000;

export type CancelledEntry = {
  item_id: string;
  table_name: string;
  menu_item_name: string;
  qty: number;
  /** Ai huỷ. Với đường "bếp báo hết" thì không có người bấm cụ thể → để trống. */
  cancelled_by: string;
  reason: string;
  /** State ngay trước khi huỷ — để hiện "đang nấu thì bị huỷ" cho đúng. */
  prev_state: string;
  /** Mốc nhận được (ms). Dùng cho hết hạn + sắp thứ tự. */
  at: number;
};

export type CancelledInput = Omit<CancelledEntry, 'at'>;

/** Thêm một món huỷ vào hàng. Trả về hàng MỚI (không sửa `list` cũ).
 *
 *  - `prev_state` không thuộc màn bếp → bỏ qua, trả nguyên hàng cũ.
 *  - Cùng `item_id` đã có → bỏ qua, KHÔNG đội lên 2 thẻ. Nhiều trang cùng poll
 *    `/orders` (Bếp + Order) nên một lần huỷ có thể tới đây 2 lần.
 *  - Mới nhất đứng ĐẦU: thẻ đỏ là việc phải xử lý ngay, không phải nhật ký.
 */
export function addCancelled(
  list: readonly CancelledEntry[],
  input: CancelledInput,
  now: number,
): CancelledEntry[] {
  if (!KITCHEN_STATES.has(input.prev_state)) return [...list];
  if (list.some((e) => e.item_id === input.item_id)) return [...list];
  return [{ ...input, at: now }, ...pruneCancelled(list, now)];
}

/** Bỏ các thẻ đã quá TTL. */
export function pruneCancelled(list: readonly CancelledEntry[], now: number): CancelledEntry[] {
  return list.filter((e) => now - e.at < CANCEL_TTL_MS);
}

/** Bếp bấm "Đã biết" trên một thẻ. */
export function dismissCancelled(
  list: readonly CancelledEntry[],
  itemId: string,
): CancelledEntry[] {
  return list.filter((e) => e.item_id !== itemId);
}

/** Câu hiện trên thẻ. Gộp vào đây để test được, và để màn bếp chỉ việc render.
 *
 *  Nói rõ món ĐANG NẤU hay CHỜ NẤU lúc bị huỷ: "đang nấu mà bị huỷ" là ca tốn tiền
 *  nguyên liệu, bếp cần biết để bỏ khỏi chảo ngay chứ không phải chỉ gạch khỏi sổ. */
export function describeCancelled(e: CancelledEntry): string {
  const when = e.prev_state === 'READY' ? 'đã nấu xong' : e.prev_state === 'COOKING' ? 'đang nấu' : 'chờ nấu';
  const who = e.cancelled_by.trim() ? ` · bởi ${e.cancelled_by}` : '';
  const why = e.reason.trim() ? ` · ${e.reason}` : '';
  return `${when}${who}${why}`;
}

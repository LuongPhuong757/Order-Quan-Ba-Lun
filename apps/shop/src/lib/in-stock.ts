/**
 * Món TẠM HẾT phải ẨN HẲN khỏi menu khách, không chỉ làm mờ (chủ quán chốt 2026-10-19).
 *
 * Bản trước hiện món hết kèm nhãn "Hết hàng" / "Tạm hết": khách vẫn lướt qua, vẫn bấm vào xem,
 * rồi thất vọng. Giờ món hết biến khỏi danh sách; nhóm nào hết SẠCH thì biến luôn cả nhóm (khỏi
 * thanh nhóm món) — để khách không bấm vào một nhóm rỗng.
 *
 * ⚠ CHỈ lọc thứ để HIỂN THỊ. Đồng bộ giỏ (`cart.applyMenuSync`) vẫn phải nhận menu ĐẦY ĐỦ từ API:
 * món đã nằm trong giỏ mà vừa báo hết thì giỏ cần thấy cờ `is_out_of_stock` để gắn nhãn
 * "Hết hàng" và chặn đặt (chủ quán chọn giữ hành vi này). Lọc trước khi đưa vào giỏ thì món đó
 * thành "không còn trong menu" — một nhánh khác hẳn.
 */

type StockItem = { is_out_of_stock: boolean };

/** Bỏ món hết khỏi từng nhóm, rồi bỏ nhóm không còn món nào. Không đổi thứ tự. */
export function inStockGroups<G extends { items: readonly StockItem[] }>(groups: readonly G[]): G[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.is_out_of_stock) }))
    .filter((g) => g.items.length > 0);
}

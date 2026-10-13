/** Combo cần ít nhất 2 món: một món thì không có gì để mời kèm. */
export const MIN_COMBO_ITEMS = 2;

/**
 * Làm sạch danh sách id món trước khi lưu: bỏ trùng, bỏ id không tồn tại (món đã xoá, id gõ
 * bừa), giữ thứ tự. Món HẾT HÀNG thì vẫn giữ: hết hàng là chuyện trong ngày, trang khách tự bỏ
 * qua lúc mời; xoá khỏi danh sách là mất cấu hình vĩnh viễn.
 */
export function cleanItemIds(ids: readonly string[], existingIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!existingIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

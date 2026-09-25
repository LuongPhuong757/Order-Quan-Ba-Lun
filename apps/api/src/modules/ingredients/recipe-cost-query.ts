// Giá vốn nguyên liệu chính theo từng món — MỘT chỗ duy nhất (M6.D-16, 2026-09-25).
//
// Dùng ở hai nơi: `RecipesService.costsForItems` (màn Menu hỏi giá vốn của trang đang xem) và
// `MenuController.list` (lọc/sắp xếp theo công thức). Hai nơi mà mỗi nơi tự viết SQL thì sớm
// muộn một bên đổi định nghĩa giá — và hai con số cho cùng một món sẽ lệch nhau mà không ai
// biết bên nào đúng.
//
// Nhận `EntityManager` thay vì repo: gọi được từ bất cứ module nào, kể cả trong transaction, mà
// không phải tiêm repository của module khác vào (chính là thứ đẻ ra phụ thuộc vòng).
import type { EntityManager } from 'typeorm';

export type RecipeCost = {
  /** Tổng tiền nguyên liệu cho MỘT phần, đã làm tròn về đồng. */
  cost: number;
  /** Số nguyên liệu trong công thức chưa có giá (chưa từng nhập). `cost` khi đó thấp hơn thực
   * tế, và màn hình phải nói ra. */
  missing: number;
};

/** Giá vốn của các món trong danh sách. Món không có dòng nào trong `recipe_lines` sẽ KHÔNG có
 * mặt trong Map trả về — "chưa khai công thức" khác với "khai rồi mà tốn 0đ".
 *
 * Giá mỗi nguyên liệu lấy theo lần nhập GẦN NHẤT, bất kể nhà cung cấp nào (M6.D-07) — cùng định
 * nghĩa mà màn Công thức và màn Nguyên liệu dùng.
 */
export async function recipeCostsByItem(
  manager: EntityManager,
  menu_item_ids: string[],
): Promise<Map<string, RecipeCost>> {
  if (menu_item_ids.length === 0) return new Map();
  const rows = await manager.query<{ menu_item_id: string; cost: string | null; missing: string }[]>(
    `SELECT r.menu_item_id,
            SUM(r.qty_per_serving * p.price) AS cost,
            SUM(CASE WHEN p.price IS NULL THEN 1 ELSE 0 END) AS missing
       FROM recipe_lines r
       LEFT JOIN (
            SELECT si.ingredient_id,
                   SUBSTRING_INDEX(
                     GROUP_CONCAT(si.last_unit_price_base ORDER BY si.last_delivery_date DESC), ',', 1
                   ) AS price
              FROM supplier_items si
              JOIN suppliers s ON s.id = si.supplier_id AND s.is_active = 1
             GROUP BY si.ingredient_id
       ) p ON p.ingredient_id = r.ingredient_id
      WHERE r.menu_item_id IN (${menu_item_ids.map(() => '?').join(',')})
      GROUP BY r.menu_item_id`,
    menu_item_ids,
  );
  return new Map(
    rows.map((r) => [
      r.menu_item_id,
      { cost: Math.round(Number(r.cost ?? 0)), missing: Number(r.missing) },
    ]),
  );
}

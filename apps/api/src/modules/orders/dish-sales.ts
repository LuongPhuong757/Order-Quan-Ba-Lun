// Thống kê món đã bán (2026-09-09) — phần logic THUẦN, không đụng DB.
//
// Khác `top_items` trong `OrdersService.stats()` ở ba điểm, và cả ba đều là chủ ý:
//
//  1. KHÔNG cắt top 10. Quán bán vài trăm món và phần đuôi mới là chỗ có tin: món bán đều đều
//     mà biên lãi mỏng, món chỉ bán cho vài bàn quen. `LIMIT 10` cắt sạch phần đó.
//  2. Gộp theo `menu_item_id` chứ không theo TÊN đã snapshot. Món đổi tên giữa kỳ mà gộp theo
//     tên thì ra hai dòng cho một món, và cả hai đều sai. Chỉ những dòng KHÔNG có id (món gõ
//     tay, món đã bị xoá cứng) mới đành gộp theo tên.
//  3. CHỈ món đã bán. Bản đầu (2026-09-09) có ghép thêm món trong menu bán 0 phần để trả lời
//     "món nào nên cắt", nhưng chủ quán bỏ ngay trong ngày: menu có ~600 món và phần lớn là món
//     mùa / món ít khi gọi, nên 480 dòng số 0 nhấn chìm mấy chục dòng đang thật sự ra tiền.

/** Một dòng gộp từ `order_items` — kết quả của truy vấn trong `DishSalesService`. */
export type SoldRow = {
  /** NULL với dòng món gõ tay (không trỏ vào menu nào). */
  menu_item_id: string | null;
  /** Tên đã snapshot trong đơn. Chỉ dùng khi món không còn tra được trong menu. */
  name: string;
  qty: number;
  revenue: number;
  orders: number;
  /** Tiền nguyên liệu ĐÃ TỐN, cộng từ bản chốt tiêu hao với giá đã chốt lúc bếp nấu (M6.D-15).
   * 0 = món chưa khai công thức, hoặc bếp chưa nấu phần nào trong kỳ. */
  cost: number;
  /** Số dòng tiêu hao KHÔNG có giá lúc chốt (nguyên liệu chưa từng nhập). Phải hiện ra — không
   * thì `cost` trông như đã đủ. */
  cost_missing: number;
};

/** Món trong menu hiện tại. */
export type MenuRow = {
  id: string;
  name: string;
  group: string;
  price: number;
  is_active: boolean;
};

/** Nhóm món, để đổi `code` thành tên người đọc được. */
export type GroupRow = { code: string; name: string; icon: string | null };

export type DishSalesRow = {
  /** NULL = món gõ tay, không tra ngược về menu được. */
  menu_item_id: string | null;
  name: string;
  /** NULL khi món không còn trong menu (đã xoá cứng) hoặc là món gõ tay. */
  group_code: string | null;
  group_name: string | null;
  /** Giá đang niêm yết. NULL cùng lệ với `group_code`. Cố ý KHÔNG phải giá đã bán: giá bán nằm
   *  trong `revenue` rồi, cột này để đối chiếu "giá hiện tại có còn hợp lý không". */
  current_price: number | null;
  qty: number;
  revenue: number;
  orders: number;
  /** Tỷ trọng doanh thu trên TOÀN KỲ (không phải trên phần đang lọc ở màn hình). */
  revenue_pct: number;
  /** Còn bán được không — món đã xoá mềm hoặc xoá hẳn thì `false`. Màn hình gắn nhãn "đã bỏ
   *  khỏi menu" cho dòng này: doanh thu của nó có thật nhưng không đặt lại được nữa. */
  in_menu: boolean;
  /** Tiền nguyên liệu đã tốn cho số phần đã nấu trong kỳ (M6.D-17).
   *
   * Dùng giá ĐÃ CHỐT lúc bếp nấu, không phải giá hôm nay: báo cáo tháng 9 phải đứng yên khi giá
   * tôm tháng 10 tăng. Đây cũng là điểm khác với cột "vốn" ở màn Quản lý Menu — bên đó là giá
   * hôm nay ("nấu bây giờ tốn bao nhiêu"). */
  cost: number;
  /** Lãi gộp nguyên liệu = doanh thu − tiền nguyên liệu. Âm được: món bán dưới giá vốn là
   * chuyện có thật và là thứ đáng nhìn thấy nhất ở màn này. */
  gross: number;
  /** % lãi gộp trên doanh thu. NULL khi chưa tính được giá vốn (`cost` = 0 vì chưa khai công
   * thức) — KHÔNG trả 100%, vì "chưa biết" và "không tốn gì" là hai chuyện khác nhau. */
  gross_pct: number | null;
  /** Số dòng tiêu hao thiếu giá. > 0 nghĩa là `cost` thấp hơn thực tế. */
  cost_missing: number;
};

export type DishSalesResult = {
  items: DishSalesRow[];
  total_qty: number;
  total_revenue: number;
  /** Tổng tiền nguyên liệu đã tốn trong kỳ. */
  total_cost: number;
  /** Số món chưa khai công thức nên không góp gì vào `total_cost` — bối cảnh bắt buộc cho con
   * số tổng, nếu không người đọc lấy `total_revenue - total_cost` ra làm lãi. */
  dishes_without_recipe: number;
};

/**
 * Ghép số liệu bán ra với menu hiện tại.
 *
 * `sold` là những gì ĐÃ xảy ra (bất biến), `menu` là hiện trạng. Hai tập lệch nhau là chuyện
 * bình thường: món cũ đã xoá khỏi menu vẫn có doanh thu trong kỳ, và những dòng đó PHẢI giữ —
 * `INNER JOIN` với menu sẽ nuốt mất chúng cùng với tiền của chúng.
 *
 * Chiều ngược lại (món trong menu chưa bán phần nào) thì KHÔNG trả về — xem điểm 3 ở đầu file.
 */
export function buildDishSales(
  sold: SoldRow[],
  menu: MenuRow[],
  groups: GroupRow[],
): DishSalesResult {
  const menuById = new Map(menu.map((m) => [m.id, m]));
  const groupByCode = new Map(groups.map((g) => [g.code, g]));

  const total_revenue = sold.reduce((s, r) => s + r.revenue, 0);
  const total_qty = sold.reduce((s, r) => s + r.qty, 0);
  const pct = (rev: number) => (total_revenue > 0 ? (rev / total_revenue) * 100 : 0);

  const rows: DishSalesRow[] = sold.map((r) => {
    const m = r.menu_item_id ? menuById.get(r.menu_item_id) : undefined;
    const g = m ? groupByCode.get(m.group) : undefined;
    return {
      menu_item_id: r.menu_item_id,
      // Món còn trong menu thì lấy tên HIỆN TẠI: đổi tên món xong mở báo cáo vẫn thấy tên cũ là
      // kiểu sai làm người ta tưởng có hai món.
      name: m?.name ?? r.name,
      group_code: m?.group ?? null,
      group_name: g ? groupName(g) : (m?.group ?? null),
      current_price: m?.price ?? null,
      qty: r.qty,
      revenue: r.revenue,
      orders: r.orders,
      revenue_pct: pct(r.revenue),
      in_menu: !!m && m.is_active,
      cost: r.cost,
      gross: r.revenue - r.cost,
      // `cost` bằng 0 nghĩa là CHƯA BIẾT (món chưa khai công thức), không phải "không tốn gì".
      // Trả 100% ở đây là nói dối một cách rất thuyết phục.
      gross_pct: r.cost > 0 && r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : null,
      cost_missing: r.cost_missing,
    };
  });

  return {
    // Doanh thu giảm dần, đồng hạng thì theo tên.
    items: rows.sort(
      (a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name, 'vi'),
    ),
    total_qty,
    total_revenue,
    total_cost: sold.reduce((s, r) => s + r.cost, 0),
    dishes_without_recipe: sold.filter((r) => r.cost === 0).length,
  };
}

function groupName(g: GroupRow): string {
  return g.icon ? `${g.icon} ${g.name}` : g.name;
}

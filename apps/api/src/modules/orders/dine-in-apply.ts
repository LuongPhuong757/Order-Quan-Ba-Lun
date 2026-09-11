// PREVIEW + KẾ HOẠCH ĐỔ GIỎ QR VÀO ĐƠN (M4.D-17, M4.D-20, M4.D-21).
//
// Module THUẦN: không import gì từ @nestjs/* hay typeorm (cùng lệ với `seated-at.ts`,
// `checkout-total.ts`, `stale-open-order.ts`). Đây là chỗ DUY NHẤT quyết định:
//   - giá nào sẽ vào bill (giá menu HIỆN TẠI, không phải giá lúc khách sinh mã),
//   - dòng nào bị bỏ, và
//   - nhân viên thấy cảnh báo gì.
//
// ── VÌ SAO PREVIEW LÀ BẮT BUỘC, KHÔNG PHẢI TRANG TRÍ ────────────────────────────────────────
// QR là QR CHUNG (M4.D-01): hệ thống không biết giỏ thuộc bàn nào, chỉ nhân viên biết. Số kiểm
// tra Luhn (`public/dine-in-code.ts`) chặn được lỗi gõ sai một chữ số, nhưng KHÔNG chặn được
// nhân viên gõ đúng một mã có thật của bàn khác. Preview — với giờ sinh mã, số món, tổng tiền —
// là chốt chặn cuối cùng giữa "gõ nhầm" và "món ra sai bàn kèm ghi oan giờ vào ăn".

/** Một dòng trong `dine_in_carts.items_snapshot` — cùng shape `OnlineOrderItemSnapshot`. */
export type DineInSnapshotLine = {
  menu_item_id: string;
  code: string;
  name: string;
  unit_price: number;
  qty: number;
  note: string | null;
};

/** Món trong menu tại thời điểm nhân viên xác nhận. `is_online_hidden` CỐ Ý không có mặt:
 * món chỉ bán tại chỗ vẫn bán được tại bàn (xem `public/create-cart.ts`). */
export type DineInMenuNow = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
  is_out_of_stock: boolean;
};

export type DineInPreviewLine = {
  menu_item_id: string;
  code: string;
  name: string;
  qty: number;
  note: string | null;
  unit_price: number;
  snapshot_unit_price: number;
  price_changed: boolean;
  unavailable: boolean;
};

export type DineInPreviewBody = {
  lines: DineInPreviewLine[];
  subtotal: number;
  item_count: number;
  has_price_change: boolean;
  has_unavailable: boolean;
};

/**
 * Đối chiếu snapshot với menu hiện tại.
 *
 * Ba luật, đều đã chốt trong spec:
 *
 * 1. **`unit_price` = giá MENU HIỆN TẠI** (M4.D-20). Giá chốt lúc nhân viên xác nhận, không
 *    phải lúc khách bấm sinh mã — khớp cách POS đang chạy (gọi món luôn lấy giá hiện tại) và
 *    khớp `syncCartWithMenu` của luồng online. `snapshot_unit_price` đi kèm để FE hiện cảnh
 *    báo, còn quyết định vẫn là con số hiện tại.
 * 2. **Dòng `unavailable` KHÔNG bị xoá khỏi `lines`** — nó phải hiện ra để nhân viên thấy và
 *    nói với khách. Xoá im lặng là khách mất món mà không ai biết. Nhưng nó KHÔNG được cộng
 *    vào `subtotal`/`item_count`: hai con số đó phải là thứ sẽ thật sự vào bill.
 * 3. **Tên món lấy theo menu hiện tại** khi món còn tồn tại (chủ quán đổi tên món thì nhân
 *    viên phải thấy tên mới), rơi về tên trong snapshot khi món đã bị xoá khỏi menu — không
 *    thì dòng đó hiện trống và nhân viên không biết khách đã gọi gì.
 */
export function buildDineInPreview(
  snapshot: DineInSnapshotLine[],
  menuNow: DineInMenuNow[],
): DineInPreviewBody {
  const byId = new Map(menuNow.map((m) => [m.id, m]));
  const lines: DineInPreviewLine[] = [];
  let subtotal = 0;
  let itemCount = 0;
  let hasPriceChange = false;
  let hasUnavailable = false;

  for (const line of snapshot) {
    const m = byId.get(line.menu_item_id);
    const unavailable = !m || !m.is_active || m.is_out_of_stock;
    // Món đã bị xoá khỏi menu thì không có giá hiện tại nào để lấy — giữ giá snapshot cho
    // dòng hiển thị. Dòng này `unavailable` nên con số đó không vào bill.
    const unitPrice = m ? m.price : line.unit_price;
    const priceChanged = !unavailable && unitPrice !== line.unit_price;

    if (unavailable) hasUnavailable = true;
    if (priceChanged) hasPriceChange = true;
    if (!unavailable) {
      subtotal += unitPrice * line.qty;
      itemCount += line.qty;
    }

    lines.push({
      menu_item_id: line.menu_item_id,
      code: line.code,
      name: m ? m.name : line.name,
      qty: line.qty,
      note: line.note,
      unit_price: unitPrice,
      snapshot_unit_price: line.unit_price,
      price_changed: priceChanged,
      unavailable,
    });
  }

  return {
    lines,
    subtotal,
    item_count: itemCount,
    has_price_change: hasPriceChange,
    has_unavailable: hasUnavailable,
  };
}

export type DineInApplyPlan = {
  /** Đưa thẳng vào `addItemsBulk` — giá lấy lại từ menu trong cùng transaction ở đó. */
  toAdd: Array<{ menu_item_id: string; qty: number; note: string | null }>;
  skipped_count: number;
  /** Tổng tiền của phần SẼ được thêm, theo giá hiện tại. Dùng cho nhật ký + response. */
  subtotal_added: number;
};

/**
 * Quyết định dòng nào thật sự vào đơn.
 *
 * Hai nguồn "bỏ dòng", và thứ tự ưu tiên có chủ đích:
 *
 * 1. `unavailable` — BE tự bỏ, KHÔNG cần FE xin. Không tin FE về chuyện món còn bán được: FE
 *    có thể đang giữ preview cũ từ 5 phút trước, lúc đó món vẫn còn. Đây là lý do hàm này nhận
 *    `menuNow` chứ không nhận danh sách đã lọc sẵn.
 * 2. `skipMenuItemIds` — nhân viên chủ động bỏ ở preview.
 *
 * Món lặp `menu_item_id` đã bị chặn từ lúc sinh mã (`public/create-cart.ts`), nên "bỏ theo
 * `menu_item_id`" ở đây là câu có nghĩa xác định. Nếu bất biến đó bị phá ở tương lai thì hàm
 * này sẽ bỏ CẢ các dòng cùng món — và đó là lý do bất biến kia phải giữ.
 */
export function planDineInApply(
  snapshot: DineInSnapshotLine[],
  menuNow: DineInMenuNow[],
  skipMenuItemIds: string[] = [],
): DineInApplyPlan {
  const byId = new Map(menuNow.map((m) => [m.id, m]));
  const skip = new Set(skipMenuItemIds);
  const toAdd: DineInApplyPlan['toAdd'] = [];
  let skipped = 0;
  let subtotalAdded = 0;

  for (const line of snapshot) {
    const m = byId.get(line.menu_item_id);
    const unavailable = !m || !m.is_active || m.is_out_of_stock;
    if (unavailable || skip.has(line.menu_item_id)) {
      skipped++;
      continue;
    }
    toAdd.push({ menu_item_id: line.menu_item_id, qty: line.qty, note: line.note });
    subtotalAdded += m!.price * line.qty;
  }

  return { toAdd, skipped_count: skipped, subtotal_added: subtotalAdded };
}

/** Câu nhật ký cho lần đổ giỏ — nói rõ mã nào, mấy dòng vào, mấy dòng bị bỏ. Sáu tháng sau
 * tranh cãi một bill, câu hỏi đầu tiên luôn là "món này ở đâu ra". */
export function dineInApplyMessage(code: string, plan: DineInApplyPlan): string {
  const summary = plan.toAdd.length === 0 ? 'không có dòng nào' : `${plan.toAdd.length} dòng`;
  const skipped = plan.skipped_count > 0 ? `, bỏ ${plan.skipped_count} dòng` : '';
  return `Nhận giỏ QR mã ${code}: ${summary}${skipped}`;
}

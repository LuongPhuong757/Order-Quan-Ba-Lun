/**
 * Tách một lượt gọi của khách thành phần ĐỔ ĐƯỢC và phần PHẢI BỎ, trước khi đưa vào
 * `OrdersService.addItemsBulk`.
 *
 * ── Vì sao bắt buộc chạy TRƯỚC `addItemsBulk`, không phải bắt lỗi của nó ──
 * `addItemsBulk` FAIL-FAST (`orders.service.ts:687-698`): gặp một món bị ẩn là ném NOT_FOUND,
 * gặp một món hết là ném CONFLICT — cho CẢ mảng. Đẩy nguyên lượt của khách vào đó rồi bắt lỗi
 * nghĩa là một món hết làm hỏng cả lượt, trong khi M7.R5 đã chốt: bỏ đúng dòng đó và đổ phần
 * còn lại. Chặn cả lượt là bắt khách gọi lại từ đầu chỉ vì một món.
 *
 * ── Vì sao tên món lấy từ snapshot của lượt gọi ──
 * Món có thể bị XOÁ HẲN khỏi menu giữa lúc chờ duyệt. Khi đó không còn chỗ nào tra ra tên để
 * nói với nhân viên và với khách là đã bỏ món gì. `table_order_request_items.menu_item_name`
 * sinh ra đúng cho ca này — nó là bản chụp lúc khách gọi, không phải khoá ngoại.
 */

export type RequestLineLike = {
  menu_item_id: string;
  /** Tên tại thời điểm khách gọi. Dùng khi món đã biến mất khỏi menu. */
  menu_item_name: string;
  qty: number;
  note: string | null;
};

export type MenuItemLike = {
  name: string;
  is_active: boolean;
  is_out_of_stock: boolean;
};

export type SkippedLine = {
  menu_item_id: string;
  menu_item_name: string;
  reason: 'GONE' | 'OUT_OF_STOCK';
};

export type SplitResult = {
  ok: RequestLineLike[];
  skipped: SkippedLine[];
};

export function splitAvailable(
  lines: readonly RequestLineLike[],
  menuById: ReadonlyMap<string, MenuItemLike>,
): SplitResult {
  const ok: RequestLineLike[] = [];
  const skipped: SkippedLine[] = [];

  for (const line of lines) {
    const item = menuById.get(line.menu_item_id);

    // Không còn trong menu, hoặc đã bị tắt — với khách thì hai thứ này là một: món không gọi
    // được nữa. Tên lấy từ menu nếu còn tra được (chính xác hơn), không thì dùng snapshot.
    if (item === undefined || !item.is_active) {
      skipped.push({
        menu_item_id: line.menu_item_id,
        menu_item_name: item?.name ?? line.menu_item_name,
        reason: 'GONE',
      });
      continue;
    }

    if (item.is_out_of_stock) {
      skipped.push({
        menu_item_id: line.menu_item_id,
        menu_item_name: item.name,
        reason: 'OUT_OF_STOCK',
      });
      continue;
    }

    ok.push(line);
  }

  // `ok` RỖNG là tín hiệu bắt buộc cho caller: lượt này kết thúc ở REJECTED kèm `skipped` đủ
  // 100%, và TUYỆT ĐỐI không gọi `addItemsBulk` — nó ném 'Giỏ hàng trống' với mảng rỗng
  // (`orders.service.ts:657`), biến một ca nghiệp vụ bình thường thành lỗi 500.
  return { ok, skipped };
}

// Trạng thái 2 chặng giao hàng của MỘT đơn đã CONFIRMED, nhìn từ màn quản lý.
//
// Logic thuần, tách khỏi JSX để test được — mirror ĐÚNG ngữ nghĩa BE (order-progress.ts +
// admin-online-orders.service.ts), đừng sáng tác thêm ở đây:
// - "bếp xong" = mọi món hợp lệ (total − cancelled) đều READY/SERVED — `isKitchenDone`.
// - 2 mốc thời gian xét TRƯỚC đếm món: khách đã nhận thì item_states không nói được gì thêm.
// - Nút bấm DUY NHẤT là "Đã đi ship" (DELIVERY chưa ship). KHÔNG còn nút "khách đã nhận/tới
//   lấy" (chủ dự án bỏ 2026-08-04): khách nhận = thanh toán — luồng checkout tự ghi
//   `received_at` cho đơn online, mốc RECEIVED vẫn tồn tại trong dữ liệu.
//
// Nhãn chặng chép NGUYÊN VĂN `stageLabel()` phía BE — khách ở /o/:token và nhân viên ở màn
// quản lý phải đọc thấy cùng một chữ cho cùng một trạng thái.
import type { AdminOnlineOrderRow } from '@order/schemas';

export type FulfillmentAction = 'ship';

/** Khoá chặng để FILTER — tách khỏi `label` vì nhãn đổi theo PICKUP/DELIVERY còn chặng thì
 * không ("Đã xong, chờ giao" và "Sẵn sàng lấy hàng" là cùng một chặng READY). */
export type FulfillmentStep = 'KITCHEN' | 'READY' | 'SHIPPED' | 'RECEIVED';

export type FulfillmentView = {
  /** Chặng hiện tại — dùng cho chip lọc ở tab "Đã xác nhận". */
  step: FulfillmentStep;
  /** Nhãn chặng hiện tại — vd "Đang chuẩn bị", "Đang giao", "Đã nhận hàng". */
  label: string;
  /** Đơn đã đi hết đường (khách đã cầm hàng). */
  done: boolean;
  /** Nút kế tiếp nhân viên cần bấm. `null` khi đã xong. */
  action: FulfillmentAction | null;
  /** Chữ trên nút kế tiếp. */
  actionLabel: string | null;
  /** Món bếp đã xong (READY + SERVED). `null` khi chưa có Order thật. */
  doneCount: number | null;
  /** Mẫu số = total − cancelled (M2.D-21). `null` khi chưa có Order thật. */
  validCount: number | null;
  /** Số món đã huỷ/hết hàng — hiện chú thích khi > 0. */
  cancelledCount: number;
};

type FulfillmentFields = Pick<
  AdminOnlineOrderRow,
  'fulfillment_type' | 'item_state_counts' | 'shipped_at_ms' | 'received_at_ms'
>;

export function fulfillmentView(row: FulfillmentFields): FulfillmentView {
  const delivery = row.fulfillment_type === 'DELIVERY';
  const counts = row.item_state_counts;
  const doneCount = counts ? counts.ready + counts.served : null;
  const validCount = counts ? counts.total - counts.cancelled : null;
  const cancelledCount = counts?.cancelled ?? 0;
  const kitchenDone = validCount !== null && validCount > 0 && doneCount === validCount;

  const base = { doneCount, validCount, cancelledCount };

  if (row.received_at_ms !== null) {
    return {
      ...base,
      step: 'RECEIVED',
      label: delivery ? 'Đã nhận hàng' : 'Đã lấy hàng',
      done: true,
      action: null,
      actionLabel: null,
    };
  }

  if (delivery && row.shipped_at_ms !== null) {
    // Sau "đã đi ship" không còn nút nào — chặng kế là THANH TOÁN ở màn bàn (checkout tự
    // ghi received_at). Bày thêm nút "khách đã nhận" ở đây là 2 nút cho cùng 1 sự kiện.
    return {
      ...base,
      step: 'SHIPPED',
      label: 'Đang giao',
      done: false,
      action: null,
      actionLabel: null,
    };
  }

  // Chặng bếp. Nút ship vẫn hiện cả khi bếp CHƯA xong — BE cho ship sớm (quán tự quyết,
  // vd shipper mang phần đã xong đi trước); FE không chặn thay BE. PICKUP không có nút nào:
  // khách tới lấy + trả tiền = checkout ở màn bàn lo trọn.
  const label = kitchenDone
    ? delivery
      ? 'Đã xong, chờ giao'
      : 'Sẵn sàng lấy hàng'
    : 'Đang chuẩn bị';
  return {
    ...base,
    step: kitchenDone ? 'READY' : 'KITCHEN',
    label,
    done: false,
    action: delivery ? 'ship' : null,
    actionLabel: delivery ? 'Đã đi ship' : null,
  };
}

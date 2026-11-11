// Đếm số đơn "Đã xác nhận" theo từng CHẶNG (chip lọc KITCHEN/READY/SHIPPED ở tab Đã xác nhận).
//
// Vì sao đếm ở BE: FE mỗi lúc chỉ tải 1 tab, nên đang đứng ở tab "Chờ duyệt" thì FE không có
// dữ liệu nào để biết "Đang giao: 3". Cùng lý lẽ với `status_counts`.
//
// ⚠ Phân loại PHẢI khớp từng nhánh với `fulfillmentView()` ở apps/web/src/lib/fulfillment.ts —
// chip hiện "3" mà bấm vào lọc ra 2 đơn là nhân viên hết tin con số. Sửa một bên thì sửa bên kia.
//
// Module thuần: không import Nest/TypeORM, để unit test không cần dựng DB.

export type StepKey = 'KITCHEN' | 'READY' | 'SHIPPED';

export type StepInput = {
  fulfillment_type: string;
  shipped_at: unknown;
  received_at: unknown;
  /** Tổng dòng món (không tính dòng ghi chú). 0 khi đơn chưa có Order thật hoặc chưa có món. */
  total: number;
  /** Món đã huỷ/hết hàng — mọi state NGOÀI 5 state sống, cùng nhánh `default` của countsByOrder. */
  cancelled: number;
  /** Món bếp đã xong = READY + SERVED. */
  done: number;
};

export function classifyStep(r: StepInput): StepKey {
  // Đơn chỉ vào đây khi CHƯA thu tiền. Khách đã nhận (RECEIVED) mà chưa thu thì vẫn là "Đang
  // giao" về mặt việc phải làm — còn nợ một lần thu tiền — nên gộp vào SHIPPED, không có chip riêng.
  if (r.received_at != null) return 'SHIPPED';
  if (r.fulfillment_type === 'DELIVERY' && r.shipped_at != null) return 'SHIPPED';
  // "Bếp xong" = mọi món HỢP LỆ đều READY/SERVED (M2.D-21). validCount = 0 (huỷ hết, hoặc chưa
  // có món) KHÔNG tính là xong — y như `kitchenDone` phía FE.
  const valid = r.total - r.cancelled;
  return valid > 0 && r.done === valid ? 'READY' : 'KITCHEN';
}

export function tallySteps(rows: StepInput[]): Record<StepKey, number> {
  const out: Record<StepKey, number> = { KITCHEN: 0, READY: 0, SHIPPED: 0 };
  for (const r of rows) out[classifyStep(r)] += 1;
  return out;
}

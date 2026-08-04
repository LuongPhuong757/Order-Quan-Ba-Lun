// Nguồn: docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §6 (dòng 402-454) — công thức % + 5 mốc
// `stage`; M2.D-15 (PICKUP hoàn tất ở READY, không cần SERVED), M2.D-19 (đơn điệu — % không
// bao giờ tụt), M2.D-20 (chặn 95% khi chưa xong hẳn), M2.D-21 (món huỷ/hết hàng PHẢI hiện
// cho khách, không được che — ngoại lệ bắt buộc của G-1).
//
// Module thuần: không import gì từ @nestjs/* hay typeorm. `nowMs`/mọi dữ liệu đều là tham số —
// KHÔNG tự đọc giờ hệ thống bên trong hàm (khuôn mẫu store-status.ts).
//
// Hàm này là NGUỒN SỰ THẬT DUY NHẤT của % — FE không được tự suy diễn %, chỉ hiển thị nguyên
// văn kết quả trả về từ đây.
//
// ─── Mở rộng 2026-08-04: 2 chặng giao hàng ───────────────────────────────────────────────────
// Chủ dự án chốt: cần phân biệt "bếp xong, chờ mang đi" / "đã đi ship" / "khách đã nhận".
// Trước đó mọi thứ sau khi duyệt đều suy diễn từ `item_states`, nên:
//   - `all items READY` bị dán nhãn stage `DELIVERING` = "Đang giao" khi chưa ai mang đi đâu cả.
//   - `SERVED` nhập nhằng: bếp đưa hàng cho shipper? hay khách đã nhận? Không phân biệt được.
// Nay 2 chặng đó do 2 MỐC THỜI GIAN trên `orders` quyết định (`shipped_at`, `received_at`), và
// `item_states` chỉ còn lo chặng bếp. Lý do chọn mốc thời gian thay vì cột status: xem comment
// dài ở `orders/entities/order.entity.ts`.
//
// ⚠ GHI ĐÈ M2.D-15 (LOCKED). Quyết định gốc: "PICKUP hoàn tất ở READY, không cần SERVED" → đơn
// PICKUP đạt 100% ngay khi bếp xong. Chủ dự án chốt 2026-08-04 là cần biết khách ĐÃ ĐẾN LẤY
// chưa, nên PICKUP cũng phải chờ `received_at` mới 100%. Xem `OVERRIDE-DEBT.md` OD-19.
// Hệ quả trong file này: `all_done` KHÔNG còn suy ra từ `item_states` — nó là `received_at != null`.

export const STATE_WEIGHT: Record<string, number> = {
  PENDING: 0,
  KITCHEN: 0.15,
  COOKING: 0.45,
  READY: 0.8,
  SERVED: 1.0,
};

// Loại khỏi mẫu số khi tính %. Viết dạng danh sách để nếu REQ-E thêm trạng thái báo-hết mới
// thì chỉ cần sửa 1 chỗ.
export const EXCLUDED_ITEM_STATES = ['CANCELLED', 'OUT_OF_STOCK'] as const;

/** Trần % của chặng BẾP — đạt trần này nghĩa là "bếp xong hết, chờ chặng sau".
 *
 * DELIVERY còn 2 chặng nữa (ship + nhận) nên trần thấp hơn PICKUP (chỉ còn 1 chặng).
 * Cả 2 đều ≤ 95 nên M2.D-20 ("tối đa 95% khi chưa xong") vẫn được tôn trọng — mức mới còn chặt
 * hơn chứ không nới. Đừng nâng 2 số này lên 100: 100% phải dành riêng cho `received_at`. */
export const KITCHEN_CEILING = { DELIVERY: 70, PICKUP: 85 } as const;

/** % khi shipper đã rời quán nhưng khách chưa xác nhận nhận hàng. Chỉ dùng cho DELIVERY. */
export const SHIPPING_PERCENT = 90;

export type OrderStage =
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'COOKING'
  /** Bếp xong hết, chờ shipper mang đi. Đây là cái trước đây bị gọi sai là `DELIVERING`. */
  | 'READY_TO_SHIP'
  /** Shipper ĐÃ rời quán (`shipped_at != null`). */
  | 'DELIVERING'
  | 'READY_FOR_PICKUP'
  /** Khách đã cầm hàng (`received_at != null`) — DELIVERY: đã nhận, PICKUP: đã lấy. */
  | 'COMPLETED'
  | 'REJECTED';

export type ComputeProgressInput = {
  request_status: 'WAITING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED_BY_CUSTOMER';
  fulfillment_type: 'PICKUP' | 'DELIVERY';
  item_states: string[];
  max_progress_shown: number;
  /** Mốc `orders.shipped_at`. `null` = chưa đi ship. Với PICKUP luôn `null` (guard ở service). */
  shipped_at?: number | null;
  /** Mốc `orders.received_at`. `null` = khách chưa cầm hàng. */
  received_at?: number | null;
};

export type ComputeProgressResult = {
  stage: OrderStage;
  percent: number;
  cancelled_count: number;
  cancelled_note: string | null;
  /** Khách đã cầm hàng. Nay = `received_at != null`, KHÔNG suy từ `item_states` nữa (OD-19). */
  all_done: boolean;
};

function clamp(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n) || 0));
}

export function computeProgress(input: ComputeProgressInput): ComputeProgressResult {
  // 1) Đơn đã kết thúc — trả ngay, bỏ qua đơn điệu có chủ ý (đơn đã kết thúc, FE ẩn %).
  if (input.request_status === 'REJECTED' || input.request_status === 'CANCELLED_BY_CUSTOMER') {
    return { stage: 'REJECTED', percent: 0, cancelled_count: 0, cancelled_note: null, all_done: false };
  }

  // 2) Chưa có Order thật (còn đang WAITING duyệt).
  if (input.request_status === 'WAITING') {
    return {
      stage: 'RECEIVED',
      percent: clamp(input.max_progress_shown),
      cancelled_count: 0,
      cancelled_note: null,
      all_done: false,
    };
  }

  // 3) Trừ món huỷ/hết hàng khỏi mẫu số (M2.D-21).
  const valid = input.item_states.filter(
    (s) => !(EXCLUDED_ITEM_STATES as readonly string[]).includes(s),
  );
  const cancelled_count = input.item_states.length - valid.length;

  const shipped = input.shipped_at != null;
  const received = input.received_at != null;
  const ceiling = KITCHEN_CEILING[input.fulfillment_type];

  let percent: number;
  let stage: OrderStage;

  // 4) Hai chặng cuối do MỐC THỜI GIAN quyết định, xét TRƯỚC chặng bếp.
  //    Cố ý xét trước: khi khách đã nhận hàng thì `item_states` không còn nói được gì thêm, và
  //    nếu xét sau thì một món bị huỷ muộn có thể kéo % tụt xuống — phá M2.D-19.
  if (received) {
    percent = 100;
    stage = 'COMPLETED';
  } else if (shipped) {
    percent = SHIPPING_PERCENT;
    stage = 'DELIVERING';
  } else if (valid.length === 0) {
    // Huỷ hết món (hoặc chưa có món hợp lệ nào) — không chia 0, không NaN.
    percent = clamp(input.max_progress_shown);
    stage = 'CONFIRMED';
  } else {
    // 5) Chặng bếp: trung bình trọng số item, co về trần của luồng.
    //
    // TRẦN MANG ĐÚNG MỘT NGHĨA: "bếp xong hết". Nên 2 nhánh tách hẳn:
    // - xong hết  → ĐÚNG BẰNG trần. Không tính theo trọng số, vì mọi món READY cho ra
    //   0.8 × trần (= 56 với DELIVERY) trong khi bếp thật sự đã xong — con số đó nói sai.
    // - chưa xong → chặn ở `trần - 1`, để "chạm trần" ⟺ "bếp xong" là tương đương hai chiều.
    //   Thiếu `-1` thì 19 SERVED + 1 COOKING cũng làm tròn lên tới trần và khách thấy
    //   "đã xong" khi còn 1 món đang nấu.
    const kitchenDone = isKitchenDone(valid);
    if (kitchenDone) {
      percent = ceiling;
    } else {
      const raw = valid.reduce((sum, s) => sum + (STATE_WEIGHT[s] ?? 0), 0) / valid.length;
      percent = Math.min(Math.round(raw * ceiling), ceiling - 1);
    }
    stage = deriveKitchenStage(valid, kitchenDone, input.fulfillment_type);
  }

  // 6) Đơn điệu (M2.D-19) — áp CUỐI CÙNG để không mốc nào phá được nó.
  percent = clamp(Math.max(percent, clamp(input.max_progress_shown)));

  const cancelled_note =
    cancelled_count > 0 ? `${cancelled_count} món đã huỷ — quán sẽ liên hệ bạn` : null;

  return { stage, percent, cancelled_count, cancelled_note, all_done: received };
}

/** Bếp đã xong hết chưa.
 *
 * `SERVED` ở đây nghĩa là "đã rời bếp" — với đơn online nó KHÔNG còn nghĩa "đã giao khách" nữa
 * (đó là việc của `received_at`), nên READY và SERVED gộp thành cùng một kết luận: bếp xong.
 * Gọi với `valid` (đã trừ CANCELLED/OUT_OF_STOCK) và `valid.length > 0`. */
export function isKitchenDone(valid: string[]): boolean {
  return valid.every((s) => s === 'READY' || s === 'SERVED');
}

/** Stage của chặng BẾP (chưa ship, chưa nhận). */
function deriveKitchenStage(
  valid: string[],
  kitchenDone: boolean,
  fulfillment_type: 'PICKUP' | 'DELIVERY',
): OrderStage {
  if (kitchenDone) {
    return fulfillment_type === 'PICKUP' ? 'READY_FOR_PICKUP' : 'READY_TO_SHIP';
  }
  if (valid.some((s) => s === 'COOKING' || s === 'READY' || s === 'SERVED')) return 'COOKING';
  return 'CONFIRMED';
}

// Nhãn hiển thị dùng khi service (plan 09-09) gọi computeProgress() cho request bị khách tự
// huỷ (CANCELLED_BY_CUSTOMER) — tránh 2 nguồn nhãn cho cùng stage 'REJECTED'.
export const STAGE_LABEL_CANCELLED_BY_CUSTOMER = 'Đơn đã huỷ';

export function stageLabel(stage: OrderStage, fulfillment_type: 'PICKUP' | 'DELIVERY'): string {
  switch (stage) {
    case 'RECEIVED':
      return 'Đã tiếp nhận';
    case 'CONFIRMED':
      return 'Đã xác nhận';
    case 'COOKING':
      return 'Đang chuẩn bị';
    case 'READY_TO_SHIP':
      return 'Đã xong, chờ giao';
    case 'DELIVERING':
      return 'Đang giao';
    case 'READY_FOR_PICKUP':
      return 'Sẵn sàng lấy hàng';
    case 'COMPLETED':
      // Cùng một stage nhưng 2 luồng nói 2 câu khác nhau — khách tự lấy thì "đã giao" là vô nghĩa.
      return fulfillment_type === 'PICKUP' ? 'Đã lấy hàng' : 'Đã nhận hàng';
    case 'REJECTED':
      return 'Đơn đã bị từ chối';
    default: {
      const _exhaustive: never = stage;
      return _exhaustive;
    }
  }
}
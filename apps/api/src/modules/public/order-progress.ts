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

export type OrderStage =
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'COOKING'
  | 'DELIVERING'
  | 'READY_FOR_PICKUP'
  | 'COMPLETED'
  | 'REJECTED';

export type ComputeProgressInput = {
  request_status: 'WAITING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED_BY_CUSTOMER';
  fulfillment_type: 'PICKUP' | 'DELIVERY';
  item_states: string[];
  max_progress_shown: number;
};

export type ComputeProgressResult = {
  stage: OrderStage;
  percent: number;
  cancelled_count: number;
  cancelled_note: string | null;
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

  let percent: number;
  let stage: OrderStage;
  let all_done: boolean;

  if (valid.length === 0) {
    // Huỷ hết món (hoặc chưa có món hợp lệ nào) — không chia 0, không NaN.
    percent = clamp(input.max_progress_shown);
    stage = 'CONFIRMED';
    all_done = false;
  } else {
    const raw = valid.reduce((sum, s) => sum + (STATE_WEIGHT[s] ?? 0), 0) / valid.length;
    percent = Math.round(raw * 100);

    const doneStates = input.fulfillment_type === 'PICKUP' ? ['READY', 'SERVED'] : ['SERVED'];
    all_done = valid.every((s) => doneStates.includes(s));

    percent = all_done ? 100 : Math.min(percent, 95);
    percent = Math.max(percent, clamp(input.max_progress_shown));
    percent = clamp(percent);

    stage = deriveStage(valid, input.fulfillment_type);
  }

  const cancelled_note =
    cancelled_count > 0 ? `${cancelled_count} món đã huỷ — quán sẽ liên hệ bạn` : null;

  return { stage, percent, cancelled_count, cancelled_note, all_done };
}

function deriveStage(valid: string[], fulfillment_type: 'PICKUP' | 'DELIVERY'): OrderStage {
  if (valid.every((s) => s === 'SERVED')) return 'COMPLETED';
  if (valid.every((s) => s === 'READY' || s === 'SERVED')) {
    return fulfillment_type === 'PICKUP' ? 'READY_FOR_PICKUP' : 'DELIVERING';
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
    case 'DELIVERING':
      return 'Đang giao';
    case 'READY_FOR_PICKUP':
      return 'Sẵn sàng lấy hàng';
    case 'COMPLETED':
      return 'Hoàn tất';
    case 'REJECTED':
      return 'Đơn đã bị từ chối';
    default: {
      // exhaustiveness guard — fulfillment_type giữ lại trong chữ ký để nhất quán API dù
      // hiện tại không rẽ nhánh theo nó ngoài DELIVERING/READY_FOR_PICKUP ở trên.
      const _exhaustive: never = stage;
      void fulfillment_type;
      return _exhaustive;
    }
  }
}

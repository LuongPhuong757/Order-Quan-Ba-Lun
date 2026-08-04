// Tra cứu lịch sử đơn theo SĐT (2026-08-04) — phần QUYẾT ĐỊNH thuần của
// `PublicOrdersService.lookupByPhone()`: nhận các row đã đọc sẵn, trả về đúng shape
// `PublicOrderHistoryEntry`. Service chỉ còn việc query DB rồi gọi hàm này từng đơn.
//
// Module thuần: không import @nestjs/* hay typeorm (khuôn order-progress.ts / phone.ts) —
// test bằng object literal, không cần dựng app/DB.
//
// Ranh giới kế thừa NGUYÊN VẸN từ `getByToken()` — sửa bên đó thì soi lại bên này:
//  - G-1/M2.D-23: `state` từng món chỉ dùng TÍNH stage, không bao giờ ra response. Mỗi dòng
//    `items` map tay đúng 2 field (`name`/`qty`) — KHÔNG spread row.
//  - M2.D-47: sau duyệt, `items` + `subtotal` lấy từ `order_items` THẬT (đã trừ món huỷ),
//    không phải `items_snapshot`.
//  - Dòng ghi chú (`is_note`) không phải món — loại trước khi tính bất cứ thứ gì.
//  - KHÁC getByToken một điểm CÓ CHỦ ĐÍCH: hàm này KHÔNG ghi `max_progress_shown` (đây là
//    trang danh sách, không hiện %, và 1 lần tra là N đơn — ghi N lệnh UPDATE là vô ích).

import {
  EXCLUDED_ITEM_STATES,
  STAGE_LABEL_CANCELLED_BY_CUSTOMER,
  computeProgress,
  stageLabel,
} from './order-progress.js';

export type HistoryRequestRow = {
  order_token: string;
  status: 'WAITING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED_BY_CUSTOMER';
  fulfillment_type: 'PICKUP' | 'DELIVERY';
  submitted_at: number;
  max_progress_shown: number;
  subtotal: number;
  items_snapshot: Array<{ name: string; qty: number; unit_price: number }>;
  order_id: string | null;
};

export type HistoryOrderRow = {
  shipped_at: number | null;
  received_at: number | null;
};

export type HistoryOrderItemRow = {
  menu_item_name: string;
  menu_item_price: number;
  qty: number;
  state: string;
  is_note: boolean;
};

export type PublicOrderHistoryEntryShape = {
  order_token: string;
  status: HistoryRequestRow['status'];
  fulfillment_type: HistoryRequestRow['fulfillment_type'];
  stage: string;
  stage_label: string;
  submitted_at_ms: number;
  items: Array<{ name: string; qty: number }>;
  subtotal: number;
};

/**
 * Dựng 1 dòng lịch sử. `order`/`orderItems` chỉ có nghĩa khi `request.order_id != null`
 * (đơn đã duyệt) — đơn còn WAITING/REJECTED-trước-duyệt truyền `null`/`[]`.
 */
export function buildHistoryEntry(
  request: HistoryRequestRow,
  order: HistoryOrderRow | null,
  orderItems: HistoryOrderItemRow[],
): PublicOrderHistoryEntryShape {
  let itemStates: string[] = [];
  let items: Array<{ name: string; qty: number }>;
  let subtotal: number;

  if (request.order_id) {
    const real = orderItems.filter((r) => !r.is_note);
    itemStates = real.map((r) => r.state);
    const visible = real.filter(
      (r) => !(EXCLUDED_ITEM_STATES as readonly string[]).includes(r.state),
    );
    items = visible.map((r) => ({ name: r.menu_item_name, qty: r.qty }));
    // M2.D-62 — tiền MÓN, không cộng ship_fee.
    subtotal = visible.reduce((sum, r) => sum + r.menu_item_price * r.qty, 0);
  } else {
    items = request.items_snapshot.map((it) => ({ name: it.name, qty: it.qty }));
    subtotal = request.subtotal;
  }

  const progress = computeProgress({
    request_status: request.status,
    fulfillment_type: request.fulfillment_type,
    item_states: itemStates,
    max_progress_shown: request.max_progress_shown,
    shipped_at: order?.shipped_at ?? null,
    received_at: order?.received_at ?? null,
  });

  return {
    order_token: request.order_token,
    status: request.status,
    fulfillment_type: request.fulfillment_type,
    stage: progress.stage,
    // Cùng khuôn getByToken: khách tự huỷ và quán từ chối chung stage 'REJECTED' nhưng
    // khác câu chữ — nói "quán đã từ chối" với đơn do chính khách huỷ là sai sự thật.
    stage_label:
      request.status === 'CANCELLED_BY_CUSTOMER'
        ? STAGE_LABEL_CANCELLED_BY_CUSTOMER
        : stageLabel(progress.stage, request.fulfillment_type),
    submitted_at_ms: request.submitted_at,
    items,
    subtotal,
  };
}

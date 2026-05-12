import { z } from 'zod';

// P01.D-03 BR-D — Order lifecycle (REQ-D state machine)
export const OrderItemState = z.enum([
  'PENDING',     // mới gọi, chưa báo bếp (huỷ free)
  'KITCHEN',     // đã báo bếp (huỷ cần confirm 2 click)
  'COOKING',     // bếp đang làm
  'READY',       // xong, chờ giao
  'SERVED',      // đã giao bàn (terminal — tính báo cáo)
  'CANCELLED',   // huỷ (terminal)
]);
export type OrderItemState = z.infer<typeof OrderItemState>;

export const OrderItem = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid(),
  menu_item_id: z.string().uuid(),
  menu_item_name: z.string(),    // snapshot khi gọi
  menu_item_price: z.number().int(),  // snapshot
  qty: z.number().int().positive(),
  state: OrderItemState,
  note: z.string().nullable(),
  cancelled_reason: z.string().nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type OrderItem = z.infer<typeof OrderItem>;

export const Order = z.object({
  id: z.string().uuid(),
  table_id: z.string().uuid(),
  table_code: z.string(),
  opened_at: z.number().int(),
  closed_at: z.number().int().nullable(),
  is_paid: z.boolean(),
  items: z.array(OrderItem),
});
export type Order = z.infer<typeof Order>;

export const AddItemDto = z.object({
  menu_item_id: z.string().uuid(),
  qty: z.number().int().positive().max(99),
  note: z.string().max(255).nullable().optional(),
});
export type AddItemDto = z.infer<typeof AddItemDto>;

export const ChangeStateDto = z.object({
  to: OrderItemState,
  reason: z.string().max(255).optional(),
});
export type ChangeStateDto = z.infer<typeof ChangeStateDto>;

// State transition matrix — for FE button display + BE validation.
// SERVED là shortcut: cho phép bỏ qua các bước trung gian khi món có sẵn
// (drink, snack đã có trên quầy → giao luôn không cần bếp xử lý).
export const ALLOWED_TRANSITIONS: Record<OrderItemState, OrderItemState[]> = {
  PENDING:   ['KITCHEN', 'SERVED', 'CANCELLED'],
  KITCHEN:   ['COOKING', 'SERVED', 'CANCELLED'],
  COOKING:   ['READY',   'SERVED', 'CANCELLED'],
  READY:     ['SERVED',  'CANCELLED'],
  SERVED:    [],
  CANCELLED: [],
};

// Per state: does cancel need 2-click confirm? (P01.D-03 BR-D)
export const CANCEL_NEEDS_CONFIRM: Record<OrderItemState, boolean> = {
  PENDING: false,
  KITCHEN: true,
  COOKING: true,
  READY: true,
  SERVED: false, // can't cancel
  CANCELLED: false,
};

// VN human-readable
export const STATE_LABEL_VN: Record<OrderItemState, string> = {
  PENDING:   'Đang gọi',
  KITCHEN:   'Đã báo bếp',
  COOKING:   'Đang làm',
  READY:     'Xong, chờ giao',
  SERVED:    'Đã giao',
  CANCELLED: 'Đã huỷ',
};

export const STATE_COLOR: Record<OrderItemState, string> = {
  PENDING:   '#6b7280',
  KITCHEN:   '#f59e0b',
  COOKING:   '#3b82f6',
  READY:     '#10b981',
  SERVED:    '#059669',
  CANCELLED: '#dc2626',
};

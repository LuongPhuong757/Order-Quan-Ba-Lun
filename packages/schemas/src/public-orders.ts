import { z } from 'zod';

// M2.D-08..16, M2.D-40..43 — hợp đồng POST /api/public/orders + GET /api/public/orders/:token.

export const OnlineOrderItemInput = z.object({
  menu_item_id: z.string().uuid(),
  qty: z.number().int().positive().max(99),
  note: z.string().max(255).optional(),
  // CỐ Ý KHÔNG có unit_price/name — BE tự lookup giá + tên từ DB, KHÔNG BAO GIỜ tin
  // giá do client gửi (xem threat T-08-01: client tự đặt giá 0đ nếu DTO nhận unit_price).
});
export type OnlineOrderItemInput = z.infer<typeof OnlineOrderItemInput>;

export const OnlineOrderSubmit = z
  .object({
    customer_token: z.string().min(32),
    customer_name: z.string().min(1).max(128),
    customer_phone: z.string().min(9).max(16),
    fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
    customer_address: z.string().max(255).optional(),
    customer_lat: z.number().min(-90).max(90).optional(),
    customer_lng: z.number().min(-180).max(180).optional(),
    customer_map_link: z.string().max(512).optional(),
    customer_note: z.string().max(500).optional(),
    items: z.array(OnlineOrderItemInput).min(1).max(50),
  })
  .refine(
    (v) =>
      v.fulfillment_type === 'PICKUP' ||
      (v.customer_address !== undefined && v.customer_address.length > 0),
    {
      message: 'Địa chỉ giao hàng bắt buộc khi chọn Giao tận nơi',
      path: ['customer_address'],
    },
  );
export type OnlineOrderSubmit = z.infer<typeof OnlineOrderSubmit>;

// Màn xác nhận tối giản sau submit (phase 8). Nội dung đầy đủ (%, 5 mốc) là phase 9.
// M2.D-23 / điều kiện G-1: TUYỆT ĐỐI không có field `status` bên trong từng item.
export const PublicOrderStatus = z.object({
  order_token: z.string(),
  status: z.enum(['WAITING', 'CONFIRMED', 'REJECTED', 'CANCELLED_BY_CUSTOMER']),
  fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number().int().positive(),
      unit_price: z.number().int().nonnegative(),
    }),
  ),
  subtotal: z.number().int().nonnegative(),
  submitted_at_ms: z.number().int(),
  store_phone: z.string(),
  reject_reason: z.string().nullable(),
});
export type PublicOrderStatus = z.infer<typeof PublicOrderStatus>;

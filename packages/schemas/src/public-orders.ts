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
    // Phiên OTP của SĐT (2026-08-04) — BẮT BUỘC khi `otp_login_enabled` bật: BE đối chiếu
    // phiên ↔ `customer_phone`, lệch/thiếu là `OTP_SESSION_REQUIRED` (FE mở bước nhập OTP).
    // Optional ở tầng schema vì công tắc tắt thì luồng cũ (không OTP) phải chạy y nguyên.
    session_token: z.string().min(32).optional(),
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

/**
 * Hợp đồng `GET /api/public/orders/:token` — whitelist ĐÓNG theo spec §6.
 *
 * 3 điều bắt buộc phải nhớ khi sửa schema này:
 *
 * 1. **M2.D-23 / hard gate G-1:** TUYỆT ĐỐI không có field `status` bên trong từng item. Khách
 *    thấy % tổng thể của cả đơn, KHÔNG thấy trạng thái từng món (món này đã nấu, món kia chưa) —
 *    đó là thông tin vận hành nội bộ và là điều kiện được chốt của G-1.
 *
 * 2. **`.strict()` là lưới an toàn CUỐI CÙNG cho G-1.** `getByToken()` gọi
 *    `PublicOrderStatus.strict().parse(...)`; nếu service lỡ trả `status` từng món hay
 *    `internal_reject_note` (D-09) thì parse THROW thay vì leak ra mạng. Đừng bao giờ đổi
 *    `.strict()` thành `.passthrough()` — làm vậy là gỡ đúng cái chốt an toàn này.
 *
 * 3. Ngoại lệ bắt buộc của G-1 là **M2.D-21**: món bị huỷ/hết hàng PHẢI cho khách biết
 *    (`cancelled_count` + `cancelled_note`) — che đi là lừa khách. Nên món huỷ bị TRỪ khỏi
 *    `items` nhưng được đếm thành 1 dòng cảnh báo riêng.
 *
 * `subtotal` là tiền MÓN, KHÔNG bao giờ gồm `ship_fee` (M2.D-62 — phí ship là tiền thu hộ).
 */
/** 6 mốc tiến độ + nhánh `REJECTED` (spec §6, M2.D-23 — mốc của CẢ ĐƠN, không phải của từng món).
 * Tách ra khỏi `PublicOrderStatus` để `OrderStepper` ở `apps/shop` dùng đúng union này thay vì gõ
 * lại — gõ lại là mở đường cho FE và BE lệch nhau khi thêm mốc.
 *
 * ⚠ 2026-08-04: thêm `READY_TO_SHIP` và sửa nghĩa `DELIVERING`.
 * Trước đó "bếp xong hết" bị dán nhãn `DELIVERING` = "Đang giao" khi chưa ai mang đi đâu cả.
 * Nay `DELIVERING` CHỈ xuất hiện khi `orders.shipped_at != null`, và `COMPLETED` chỉ khi
 * `orders.received_at != null`. Union này phải khớp `OrderStage` ở
 * `apps/api/src/modules/public/order-progress.ts` — 2 chỗ lệch nhau là 500 ở tầng zod, không
 * phải hiển thị sai im lặng (đúng như test đã bắt được). */
export const OrderStage = z.enum([
  'RECEIVED',
  'CONFIRMED',
  'COOKING',
  'READY_TO_SHIP',
  'DELIVERING',
  'READY_FOR_PICKUP',
  'COMPLETED',
  'REJECTED',
]);
export type OrderStage = z.infer<typeof OrderStage>;

export const PublicOrderStatus = z.object({
  order_token: z.string(),
  status: z.enum(['WAITING', 'CONFIRMED', 'REJECTED', 'CANCELLED_BY_CUSTOMER']),
  fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number().int().positive(),
      unit_price: z.number().int().nonnegative(),
      // 2026-08-04: ảnh món cho trang theo dõi đơn (giống giỏ hàng). Tra LIVE từ `menu_items`
      // theo `menu_item_id` lúc đọc — KHÔNG snapshot: ảnh chỉ để minh hoạ, không phải dữ liệu
      // chốt giá. Món đã xoá khỏi menu / chưa có ảnh → null, FE tự vẽ placeholder.
      image: z.string().nullable(),
    }),
  ),
  subtotal: z.number().int().nonnegative(),
  submitted_at_ms: z.number().int(),
  store_phone: z.string(),
  reject_reason: z.string().nullable(),
  // ── Phase 9 (REQ-O, spec §6) ──
  stage: OrderStage,
  stage_label: z.string(),
  percent: z.number().int().min(0).max(100),
  cancelled_count: z.number().int().nonnegative(),
  cancelled_note: z.string().nullable(),
  eta_min: z.number().int().nullable(),
  eta_max: z.number().int().nullable(),
  updated_at_ms: z.number().int(),
});
export type PublicOrderStatus = z.infer<typeof PublicOrderStatus>;

/**
 * Hợp đồng `DELETE /api/public/orders/:token` — khách tự huỷ đơn khi quán CHƯA duyệt
 * (M2.D-44, phần "nửa huỷ"; nửa sửa đơn `PATCH` hoãn sang phase 10).
 *
 * Không có request body: `order_token` nằm trên URL và chính nó là credential duy nhất của đơn.
 *
 * `status` là literal chứ không phải enum 4 giá trị: endpoint này chỉ có đúng một kết cục thành
 * công. Mọi trạng thái khác (`CONFIRMED`/`REJECTED`) là nhánh LỖI 409, không phải một giá trị
 * hợp lệ của response — khai bằng enum rộng là mở đường cho FE tin rằng huỷ đã thành công trong
 * khi quán vừa xác nhận đơn.
 *
 * Gọi lần thứ hai trên đơn đã huỷ vẫn trả 200 với cùng payload (idempotent): khách bấm 2 lần
 * hoặc mạng chập chờn không được nhận thông báo lỗi cho một việc đã xong.
 */
export const PublicOrderCancelResult = z.object({
  order_token: z.string(),
  status: z.literal('CANCELLED_BY_CUSTOMER'),
});
export type PublicOrderCancelResult = z.infer<typeof PublicOrderCancelResult>;

/**
 * Hợp đồng `POST /api/public/orders/lookup` — tra cứu lịch sử đơn theo SĐT (2026-08-04).
 *
 * Vì sao POST chứ không GET `?phone=`: SĐT là dữ liệu cá nhân, để trên query string là lọt
 * vào access log nginx + history trình duyệt. Body POST thì không (khuôn đã dùng cho
 * `POST orders` — SĐT cũng đi trong body).
 *
 * Ranh giới quyền ĐÃ CHỐT với chủ dự án (2026-08-04, cùng tinh thần T-09-80): SĐT là
 * credential DUY NHẤT — ai biết SĐT là xem được lịch sử đơn của số đó. Chấp nhận vì:
 *  1. Payload là whitelist ĐÓNG — KHÔNG có địa chỉ, tên khách, toạ độ, note. Chỉ có thứ
 *     trang `/o/:token` vốn đã cho xem (món + tiền + tiến độ).
 *  2. Throttle 10 lần/phút/IP như mọi endpoint public khác — dò quét SĐT hàng loạt rất đắt.
 */
export const PublicOrderLookup = z
  .object({
    phone: z.string().min(9).max(20).optional(),
    /** Phiên OTP (2026-08-04) — khi `otp_login_enabled` bật, đây là credential DUY NHẤT
     * được chấp nhận (SĐT trần bị từ chối, vá lỗ "ai biết SĐT là xem được lịch sử").
     * SĐT tra cứu lấy từ phiên phía BE, không tin `phone` client gửi. */
    session_token: z.string().min(32).optional(),
  })
  .refine((v) => v.phone !== undefined || v.session_token !== undefined, {
    message: 'Thiếu số điện thoại',
    path: ['phone'],
  });
export type PublicOrderLookup = z.infer<typeof PublicOrderLookup>;

/**
 * Một dòng trong lịch sử đơn của khách. Whitelist ĐÓNG như `PublicOrderStatus` và CHẶT HƠN:
 * không `reject_reason`, không `cancelled_note`, không ETA — muốn xem chi tiết thì bấm vào
 * đơn để mở `/o/:token` (nơi các field đó đã có sẵn). G-1/M2.D-23 vẫn áp: không trạng thái
 * từng món; `items` ở đây còn không có cả `unit_price` — danh sách chỉ cần tên + số lượng.
 */
export const PublicOrderHistoryEntry = z.object({
  order_token: z.string(),
  status: z.enum(['WAITING', 'CONFIRMED', 'REJECTED', 'CANCELLED_BY_CUSTOMER']),
  fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  stage: OrderStage,
  stage_label: z.string(),
  submitted_at_ms: z.number().int(),
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number().int().positive(),
    }),
  ),
  /** Tiền MÓN (M2.D-62) — sau duyệt tính từ `order_items` thật (M2.D-47), như `subtotal`
   * của `PublicOrderStatus`. */
  subtotal: z.number().int().nonnegative(),
});
export type PublicOrderHistoryEntry = z.infer<typeof PublicOrderHistoryEntry>;

export const PublicOrderHistory = z.object({
  /** SĐT đã chuẩn hoá (`normalizePhone`) — FE lưu lại bản này để lần sau tự tra. */
  phone: z.string(),
  /** Mới nhất trước. Toàn bộ lịch sử, không phân trang (chốt 2026-08-04 — quán nhỏ). */
  orders: z.array(PublicOrderHistoryEntry),
});
export type PublicOrderHistory = z.infer<typeof PublicOrderHistory>;

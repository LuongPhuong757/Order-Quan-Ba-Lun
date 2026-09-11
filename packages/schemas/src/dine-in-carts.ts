import { z } from 'zod';

// M4.D-01..26 — hợp đồng "khách tự gọi món tại bàn bằng QR"
// (docs/MILESTONE-04-QR-DINE-IN-SPEC.md).
//
// Khác luồng đặt online (`public-orders.ts`) ở chỗ CỐ Ý thiếu rất nhiều thứ: không tên, không
// SĐT, không địa chỉ, không hình thức nhận hàng, không phiên OTP (M4.D-02). Khách quét QR
// chung dán trong quán, chọn món, rồi đọc một mã 5 số cho nhân viên — hết.

/** Dòng món khách gửi lên khi bấm "Sinh mã". Cùng khuôn `OnlineOrderItemInput`:
 * CỐ Ý KHÔNG có `unit_price`/`name` — BE tự tra giá từ `menu_items` (M4.D-25). */
export const DineInCartItemInput = z.object({
  menu_item_id: z.string().uuid(),
  qty: z.number().int().positive().max(99),
  note: z.string().max(255).optional(),
});
export type DineInCartItemInput = z.infer<typeof DineInCartItemInput>;

/**
 * `POST /api/public/dine-in-carts` — khách (hoặc nhân viên đứng tại bàn) bấm "Sinh mã".
 *
 * `customer_token` là token thiết bị sinh 100% client-side, dùng cho hai việc: rate-limit
 * (M4.D-26) và kiểm quyền huỷ ở `DELETE` (M4.D-07). Nó KHÔNG phải danh tính — giỏ tại bàn
 * vô danh theo M4.D-02.
 */
export const DineInCartCreate = z.object({
  customer_token: z.string().min(32),
  items: z.array(DineInCartItemInput).min(1).max(50),
});
export type DineInCartCreate = z.infer<typeof DineInCartCreate>;

export const DineInCartCreateResult = z.object({
  code: z.string(),
  expires_at: z.number().int(),
});
export type DineInCartCreateResult = z.infer<typeof DineInCartCreateResult>;

/**
 * Trạng thái mã, suy ra từ các mốc thời gian trong bảng — bảng `dine_in_carts` CỐ Ý không có
 * cột `status` (spec §5.2). Bốn trạng thái mà thêm một cột enum thì sẽ có ca enum lệch với mốc
 * thời gian, và không ai biết bên nào đúng.
 */
export const DINE_IN_CART_STATES = ['ACTIVE', 'USED', 'CANCELLED', 'EXPIRED'] as const;
export type DineInCartState = (typeof DINE_IN_CART_STATES)[number];

/**
 * `GET /api/public/dine-in-carts/:code` — khách mở lại tab thì vẫn thấy mã của mình.
 *
 * `.strict()` là lưới an toàn: response này TUYỆT ĐỐI không được chứa bàn nào đã nhận giỏ hay
 * tên nhân viên nào đã nhập mã. Khách không cần biết, và đó là thông tin vận hành nội bộ —
 * cùng lý lẽ với hard gate G-1 của luồng online (`PublicOrderStatus`).
 */
export const PublicDineInCartStatus = z.object({
  code: z.string(),
  state: z.enum(DINE_IN_CART_STATES),
  /** Còn lại bao nhiêu ms — FE vẽ đếm ngược. `0` khi mã không còn ACTIVE. */
  expires_in_ms: z.number().int().min(0),
  item_count: z.number().int().min(0),
  subtotal: z.number().int().min(0),
});
export type PublicDineInCartStatus = z.infer<typeof PublicDineInCartStatus>;

export const DineInCartCancel = z.object({
  customer_token: z.string().min(32),
});
export type DineInCartCancel = z.infer<typeof DineInCartCancel>;

// ── Phía nhân viên (`admin` + `order`) ────────────────────────────────────────────────────

/**
 * Một dòng trong PREVIEW của nhân viên (M4.D-17). Ba field cuối là phần ĐỐI CHIẾU với menu
 * hiện tại — chúng là lý do preview tồn tại:
 *
 * - `unit_price` là giá SẼ TÍNH, tức giá menu hiện tại (M4.D-20 — giá chốt lúc xác nhận).
 * - `snapshot_unit_price` là giá lúc khách bấm sinh mã. Lệch nhau thì FE hiện cảnh báo để
 *   nhân viên nói trước với khách, không để hệ thống tự quyết.
 * - `unavailable` là món vừa hết / bị tắt khỏi menu trong lúc chờ (M4.D-21) — nhân viên bỏ
 *   dòng đó và đổ phần còn lại, KHÔNG chặn cả giỏ.
 */
export const DineInCartPreviewLine = z.object({
  menu_item_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  qty: z.number().int().positive(),
  note: z.string().nullable(),
  unit_price: z.number().int().min(0),
  snapshot_unit_price: z.number().int().min(0),
  price_changed: z.boolean(),
  unavailable: z.boolean(),
});
export type DineInCartPreviewLine = z.infer<typeof DineInCartPreviewLine>;

/**
 * `GET /api/orders/dine-in-carts/:code` — preview. Endpoint này CỐ Ý không tiêu mã: nhân viên
 * gõ sai rồi thoát thì mã của bàn khác không bị hỏng. Chỉ `apply` mới tiêu mã (M4.D-13).
 *
 * `subtotal` là tổng của các dòng CÒN BÁN ĐƯỢC theo giá hiện tại — không phải `subtotal` đã
 * lưu lúc sinh mã. Nhân viên cần thấy con số sẽ thật sự vào bill.
 */
export const DineInCartPreview = z.object({
  code: z.string(),
  created_at: z.number().int(),
  expires_at: z.number().int(),
  lines: z.array(DineInCartPreviewLine),
  /** Tổng theo giá hiện tại, đã bỏ các dòng `unavailable`. */
  subtotal: z.number().int().min(0),
  item_count: z.number().int().min(0),
  has_price_change: z.boolean(),
  has_unavailable: z.boolean(),
});
export type DineInCartPreview = z.infer<typeof DineInCartPreview>;

/**
 * `POST /api/orders/:id/dine-in-carts/:code/apply` — đổ giỏ vào đơn.
 *
 * `skip_menu_item_ids` là các dòng nhân viên chủ động bỏ ở preview. Món `unavailable` thì BE
 * tự bỏ dù có nằm trong danh sách này hay không — không tin FE về chuyện món còn bán được.
 */
export const DineInCartApply = z.object({
  skip_menu_item_ids: z.array(z.string().uuid()).max(50).optional(),
});
export type DineInCartApply = z.infer<typeof DineInCartApply>;

export const DineInCartApplyResult = z.object({
  added_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0),
  subtotal_added: z.number().int().min(0),
});
export type DineInCartApplyResult = z.infer<typeof DineInCartApplyResult>;

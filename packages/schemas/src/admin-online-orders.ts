import { z } from 'zod';

// Hợp đồng zod DUY NHẤT cho 3 endpoint admin online-orders (GET list / POST confirm /
// POST reject) + SSE stream event. Nguồn: docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §6-§7,
// 09-CONTEXT.md, 09-UI-SPEC.md § Copywriting Contract — Mặt A.
//
// D-02: cả 3 role admin/order/kitchen đều duyệt được (GHI ĐÈ M2.D-33). Không có lớp chặn
// role thứ 2 ở tầng dữ liệu — audit log (ghi rõ AI duyệt đơn nào) là kiểm soát bù trừ thay
// thế cho lớp bảo vệ mà M2.D-33 từng cung cấp.
//
// D-08: lý do từ chối gửi tới khách CHỈ được chọn từ 5 mã soạn sẵn dưới đây (enum, không
// phải free text) — tránh chữ admin gõ vội giờ cao điểm đi thẳng tới khách.
//
// D-09: ghi chú nội bộ (`internal_note`) CHỈ lưu DB + audit log. Field này CHỈ xuất hiện
// trong `RejectOnlineOrderBody` (request body của admin gửi lên) — TUYỆT ĐỐI KHÔNG được có
// mặt trong `AdminOnlineOrderRow`, `AdminOnlineOrderList`, hay `OnlineOrderStreamEvent`,
// và càng không được có mặt trong bất kỳ schema công khai nào (`PublicOrderStatus` v.v.).

export const RejectReasonCode = z.enum([
  'OUT_OF_INGREDIENT',
  'OUT_OF_DELIVERY_AREA',
  'OVERLOADED',
  'CANNOT_CONTACT',
  'OTHER',
]);
export type RejectReasonCode = z.infer<typeof RejectReasonCode>;

// Câu đi tới khách — chép nguyên văn 09-UI-SPEC.md § Copywriting Contract — Mặt A.
// `OTHER` → rỗng: với lý do "Khác", chính `reason_other_text` là câu gửi khách.
export const REJECT_REASON_TEXT: Record<RejectReasonCode, string> = {
  OUT_OF_INGREDIENT: 'Hết nguyên liệu món đã đặt',
  OUT_OF_DELIVERY_AREA: 'Ngoài khu vực giao hàng',
  OVERLOADED: 'Quán đang quá tải, chưa thể nhận thêm',
  CANNOT_CONTACT: 'Không liên lạc được với khách',
  OTHER: '',
};

export const AdminOnlineOrderItem = z.object({
  menu_item_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  unit_price: z.number().int().nonnegative(),
  qty: z.number().int().positive(),
  note: z.string().nullable(),
  // Re-check tồn kho tại thời điểm GET (M2.D-61) — KHÔNG phải cột DB, tính lúc đọc.
  is_out_of_stock: z.boolean(),
});
export type AdminOnlineOrderItem = z.infer<typeof AdminOnlineOrderItem>;

export const AdminOnlineOrderRow = z.object({
  id: z.string().uuid(),
  // 4 ký tự đầu + "…" (C-INFRA-03, OD-02) — admin không cần token đầy đủ để duyệt đơn,
  // và `order_token` là bearer credential không nên hiện toàn bộ trên màn hình dùng chung.
  order_token_masked: z.string(),
  status: z.enum(['WAITING', 'CONFIRMED', 'REJECTED', 'CANCELLED_BY_CUSTOMER']),
  fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  customer_name: z.string(),
  customer_phone: z.string(),
  customer_address: z.string().nullable(),
  customer_map_link: z.string().nullable(),
  distance_km: z.string().nullable(),
  customer_note: z.string().nullable(),
  items: z.array(AdminOnlineOrderItem),
  subtotal: z.number().int().nonnegative(),
  submitted_at_ms: z.number().int(),
  waiting_seconds: z.number().int().nonnegative(),
  out_of_stock_count: z.number().int().nonnegative(),

  // ── 3 field dưới đây CHỈ có giá trị khi đơn đã xử lý (CONFIRMED/REJECTED) ──
  // Thêm cùng lúc mở filter theo trạng thái (OD-11): tab "Đã xác nhận"/"Đã từ chối" mà không
  // hiện được xử lý LÚC NÀO, do AI, và vì sao từ chối thì gần như vô dụng.
  /** Mốc duyệt/từ chối. `null` khi còn WAITING. */
  reviewed_at_ms: z.number().int().nullable(),
  /** Tên người duyệt/từ chối — đây là mặt hiển thị của kiểm soát bù trừ D-02. */
  reviewed_by_full_name: z.string().nullable(),
  /** Lý do từ chối ĐÃ GỬI TỚI KHÁCH. `null` khi không phải đơn bị từ chối.
   * TUYỆT ĐỐI KHÔNG map `internal_reject_note` vào đây — ghi chú nội bộ không đi ra HTTP (D-09). */
  reject_reason: z.string().nullable(),
});
export type AdminOnlineOrderRow = z.infer<typeof AdminOnlineOrderRow>;

/** Trạng thái xem được ở màn quản lý đơn online. `CANCELLED_BY_CUSTOMER` KHÔNG có ở đây —
 * khách tự huỷ thì không cần nhân viên làm gì, đưa vào tab chỉ thêm nhiễu. */
export const AdminOnlineOrderStatusFilter = z.enum(['WAITING', 'CONFIRMED', 'REJECTED']);
export type AdminOnlineOrderStatusFilter = z.infer<typeof AdminOnlineOrderStatusFilter>;

export const AdminOnlineOrderList = z.object({
  items: z.array(AdminOnlineOrderRow),
  // Ngưỡng leo thang SMS (giây) — FE cần để đổi màu đồng hồ đếm giây chờ từng đơn.
  // 09-UI-SPEC: đây là setting, KHÔNG được hardcode 90 ở FE.
  escalate_sms_after_s: z.number().int(),
});
export type AdminOnlineOrderList = z.infer<typeof AdminOnlineOrderList>;

export const ConfirmOnlineOrderBody = z.object({
  ship_fee: z.number().int().min(0).max(1_000_000).optional(),
  // Món admin tick bỏ khỏi đơn lúc xác nhận (M2.D-61 — re-check tồn kho).
  drop_menu_item_ids: z.array(z.string().uuid()).max(50).optional(),
});
export type ConfirmOnlineOrderBody = z.infer<typeof ConfirmOnlineOrderBody>;

export const RejectOnlineOrderBody = z
  .object({
    reason_code: RejectReasonCode,
    reason_other_text: z.string().min(1).max(255).optional(),
    // CHỈ lưu DB + audit log (D-09). Field này KHÔNG được xuất hiện trong `PublicOrderStatus`
    // hay bất kỳ response `/api/public/*` nào.
    internal_note: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.reason_code === 'OTHER' && (!v.reason_other_text || v.reason_other_text.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason_other_text'],
        message: 'Vui lòng ghi rõ lý do gửi tới khách',
      });
    }
  });
export type RejectOnlineOrderBody = z.infer<typeof RejectOnlineOrderBody>;

// Payload SSE cố tình TỐI GIẢN: không kèm dữ liệu đơn. FE nhận event rồi tự gọi lại
// `GET /admin/online-orders?status=WAITING` (D-06 — DB là nguồn sự thật duy nhất, đúng cả
// khi API restart hay dữ liệu bị sửa tay). KHÔNG "tối ưu" bằng cách nhồi cả đơn vào event —
// nếu làm vậy sẽ tạo ra 1 nguồn sự thật thứ 2 (in-memory event) lệch với DB.
export const OnlineOrderStreamEvent = z.object({
  type: z.enum(['new', 'reviewed', 'heartbeat']),
  request_id: z.string().nullable(),
  at_ms: z.number().int(),
});
export type OnlineOrderStreamEvent = z.infer<typeof OnlineOrderStreamEvent>;

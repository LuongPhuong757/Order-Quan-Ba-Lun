import { z } from 'zod';

// M7 — khách tự gọi món tại bàn. Hợp đồng của 4 endpoint công khai `/api/public/table/*`
// và 4 endpoint nội bộ `/table-requests/*`, `/table-calls/*`.
// Tài liệu đầy đủ: docs/MILESTONE-07-API.md

/* ── Khách gõ số bàn ──────────────────────────────────────────────────────────────────── */

export const TableOpenInput = z.object({
  // Chuỗi THÔ khách gõ: "5", "05", "bàn 5", "B05". Chuẩn hoá ở BE (`table-input.ts`),
  // KHÔNG bắt FE tự đoán — FE đoán sai là món vào bàn người khác (M7.R1).
  table_input: z.string().min(1).max(16),
  // Chỉ gửi khi lần trước BE trả NEED_CODE (M7.D-05).
  code: z.string().regex(/^\d{4}$/).optional(),
  // M7.D-16 — FE LUÔN gửi kèm nếu localStorage còn: máy cũ quay lại thì không phải nhập mã.
  guest_token: z.string().length(64).optional(),
});
export type TableOpenInput = z.infer<typeof TableOpenInput>;

export const TableOpenResult = z.union([
  z.object({
    state: z.literal('OPENED'),
    guest_token: z.string().length(64),
    table_name: z.string(),
    // Mã của bàn — chỉ có khi bàn đã báo bếp ít nhất một lần (M7.D-17).
    guest_code: z.string().regex(/^\d{4}$/).nullable(),
  }),
  z.object({
    state: z.literal('NEED_CODE'),
    table_name: z.string(),
  }),
]);
export type TableOpenResult = z.infer<typeof TableOpenResult>;

/* ── Khách gửi lượt gọi ───────────────────────────────────────────────────────────────── */

export const TableCartLine = z.object({
  menu_item_id: z.string().uuid(),
  qty: z.number().int().positive().max(20), // chặt hơn giỏ online (99) — M7.R4
  note: z.string().max(255).optional(),
  // CỐ Ý KHÔNG có giá: bảng chờ không có cột giá, giá chốt lúc nhân viên duyệt (M7.D-11).
});
export type TableCartLine = z.infer<typeof TableCartLine>;

export const TableCartInput = z.object({
  guest_token: z.string().length(64),
  // Ép UUID v4 để không ai nhận chuỗi rỗng/cố định làm giá trị hợp lệ — khi đó mọi lượt sau
  // bị unique nuốt âm thầm, trông y hệt bug chứ không ra lỗi.
  client_request_id: z.string().uuid(),
  items: z.array(TableCartLine).min(1).max(20),
});
export type TableCartInput = z.infer<typeof TableCartInput>;

export const TableCartResult = z.object({
  request_id: z.string(),
  status: z.literal('WAITING'),
  // null khi bàn chưa từng báo bếp — màn khách hiện "đang chờ quán xác nhận" (M7.D-17).
  guest_code: z.string().regex(/^\d{4}$/).nullable(),
  items_preview: z.array(
    z.object({
      name: z.string(),
      qty: z.number().int(),
      // "giá TẠM TÍNH" — FE bắt buộc gắn nhãn, vì D-11 chốt giá lúc duyệt.
      price_estimate: z.number().int(),
    }),
  ),
});
export type TableCartResult = z.infer<typeof TableCartResult>;

/* ── Màn "Món của bàn" ────────────────────────────────────────────────────────────────── */

// ⚠ ALLOWLIST, không phải blacklist. `.strict()` là hàng rào thứ hai sau mapper tường minh.
// Lọt `order_token` ra đây là người lạ HUỶ ĐƯỢC ĐƠN của khách khác (M7.R9 — CRITICAL).
export const TableStateResult = z
  .object({
    table_name: z.string(),
    guest_code: z.string().regex(/^\d{4}$/).nullable(),
    waiting: z.array(
      z.object({
        request_id: z.string(),
        created_at: z.number(),
        items: z.array(
          z.object({ name: z.string(), qty: z.number().int(), note: z.string().nullable() }).strict(),
        ),
      }).strict(),
    ),
    ordered: z.array(
      z.object({
        name: z.string(),
        qty: z.number().int(),
        unit_price: z.number().int(),
        line_total: z.number().int(),
      }).strict(),
    ),
    subtotal: z.number().int(),
    calls: z.array(
      z.object({
        kind: z.enum(['STAFF', 'BILL']),
        created_at: z.number(),
        acked: z.boolean(),
        note: z.string().nullable(),
      }).strict(),
    ),
    server_now_ms: z.number(),
  })
  .strict();
export type TableStateResult = z.infer<typeof TableStateResult>;

/* ── Gọi nhân viên / xin tính tiền ────────────────────────────────────────────────────── */

export const TABLE_CALL_KINDS = ['STAFF', 'BILL'] as const;
export const TableCallKind = z.enum(TABLE_CALL_KINDS);
export type TableCallKind = z.infer<typeof TableCallKind>;

export const TableCallInput = z.object({
  guest_token: z.string().length(64),
  kind: TableCallKind,
  /** Lý do khách gọi, khách tự gõ hoặc chọn từ gợi ý ("thêm bát đũa", "thêm đá"…).
   *
   * Mục đích là để nhân viên MANG LUÔN thứ khách cần xuống bàn, khỏi phải xuống hỏi rồi đi
   * lên lấy. Nên nó chỉ là gợi ý, KHÔNG bắt buộc: bắt gõ mới gọi được là thêm một rào cho
   * người chỉ muốn vẫy tay gọi nhân viên.
   *
   * 120 ký tự: đủ cho một câu dặn, và thẻ trên màn bếp còn đọc được bằng mắt từ xa. */
  note: z.string().trim().max(120).optional(),
});
export type TableCallInput = z.infer<typeof TableCallInput>;

/* ── Nhân viên: lượt chờ duyệt ────────────────────────────────────────────────────────── */

export const PendingRequestItem = z.object({
  menu_item_id: z.string(),
  name: z.string(),
  qty: z.number().int(),
  note: z.string().nullable(),
  // Giá HIỆN TẠI (D-11), không phải giá lúc khách gửi.
  price_now: z.number().int(),
  out_of_stock: z.boolean(),
});
export type PendingRequestItem = z.infer<typeof PendingRequestItem>;

export const PendingRequest = z.object({
  id: z.string(),
  order_id: z.string(),
  table_code: z.string(),
  table_name: z.string(),
  created_at: z.number(),
  items: z.array(PendingRequestItem),
  // KHÔNG cộng dòng out_of_stock — nhân viên phải thấy đúng số tiền sẽ vào bill.
  total_now: z.number().int(),
});
export type PendingRequest = z.infer<typeof PendingRequest>;

export const PendingCall = z.object({
  id: z.string(),
  table_code: z.string(),
  table_name: z.string(),
  kind: TableCallKind,
  created_at: z.number(),
  /** Lý do khách ghi khi bấm gọi. NULL = khách gọi suông, không ghi gì. */
  note: z.string().nullable(),
});
export type PendingCall = z.infer<typeof PendingCall>;

export const PendingResult = z.object({
  requests: z.array(PendingRequest),
  calls: z.array(PendingCall),
});
export type PendingResult = z.infer<typeof PendingResult>;

export const ApproveResult = z.object({
  added: z.number().int(),
  skipped: z.array(
    z.object({
      name: z.string(),
      reason: z.enum(['GONE', 'OUT_OF_STOCK']),
    }),
  ),
  order_id: z.string(),
});
export type ApproveResult = z.infer<typeof ApproveResult>;

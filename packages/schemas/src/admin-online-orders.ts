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

/** Nhãn NGẮN cho nhân viên chọn trong hộp thoại Từ chối — đây là ngôn ngữ nội bộ, cần liếc là
 * hiểu ngay. KHÔNG bao giờ gửi tới khách; câu gửi khách là `REJECT_REASON_TEXT` bên dưới. */
export const REJECT_REASON_LABEL: Record<RejectReasonCode, string> = {
  OUT_OF_INGREDIENT: 'Hết nguyên liệu',
  OUT_OF_DELIVERY_AREA: 'Ngoài khu vực giao',
  OVERLOADED: 'Quán quá tải',
  CANNOT_CONTACT: 'Không liên lạc được',
  OTHER: 'Lý do khác',
};

// Câu ĐI TỚI KHÁCH. Chủ dự án viết lại 2026-08-06 (GHI ĐÈ bản ngắn gọn chép từ 09-UI-SPEC.md
// § Copywriting Contract — Mặt A): "mỗi lần từ chối hãy viết lịch sự hơn vì mình đang là người
// từ chối, làm sao để trải nghiệm của khách không bị ảnh hưởng".
//
// 3 điều mỗi câu phải có, đừng rút gọn mất:
//   1. Quán XIN LỖI trước — người bị từ chối cần nghe câu đó trước lý do.
//   2. Lý do nói ở phía QUÁN, không phải lỗi của khách ("bếp đang quá tải", không phải "bạn đặt
//      đông quá"); riêng CANNOT_CONTACT tuyệt đối không trách khách không nghe máy.
//   3. KHÔNG bắt khách làm lại việc gì. Bản đầu có thêm vế "chọn giúp quán món khác / hình thức
//      tự đến lấy" ở 2 câu đầu — chủ dự án bỏ đi cùng ngày: đơn vừa bị từ chối mà còn giao việc
//      cho khách thì lời xin lỗi mất nghĩa.
//
// `OTHER` → rỗng: với lý do "Khác", chính `reason_other_text` admin gõ là câu gửi khách.
export const REJECT_REASON_TEXT: Record<RejectReasonCode, string> = {
  // 2 câu này chủ dự án CỐ Ý cắt bỏ vế mời chào ở cuối (2026-08-06): đơn đã bị từ chối rồi thì
  // "chọn giúp quán món khác" / "chọn hình thức tự đến lấy" là bảo khách tự làm lại từ đầu.
  // Đừng thêm lại cho "đủ công thức".
  OUT_OF_INGREDIENT:
    'Quán thành thật xin lỗi quý khách, món quý khách đặt vừa hết nguyên liệu nên quán chưa phục vụ được lần này.',
  OUT_OF_DELIVERY_AREA:
    'Quán thành thật xin lỗi quý khách, địa chỉ của quý khách nằm ngoài khu vực quán giao được nên lần này quán chưa phục vụ tận nơi được.',
  OVERLOADED:
    'Quán thành thật xin lỗi quý khách, bếp đang quá tải nên chưa kịp phục vụ đơn của quý khách. Mong quý khách thông cảm và quay lại với quán vào lúc khác ạ.',
  CANNOT_CONTACT:
    'Quán đã gọi vài lần nhưng chưa liên lạc được với quý khách nên chưa dám lên món. Quán thành thật xin lỗi, quý khách đặt lại giúp quán khi thuận tiện nhé ạ.',
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
  /**
   * Toạ độ khách chia sẻ, dạng CHUỖI vì cột DB là `decimal` (cùng lý lẽ với `distance_km` —
   * không tin driver trả về `number`).
   *
   * Thêm 2026-08-05: trước đó lat/lng chỉ nằm trong DB để BE tính `distance_km` rồi thôi, màn
   * quản lý đơn không nhận được nên nút "Mở bản đồ" CHỈ hiện khi khách dán link Maps. Khách
   * bấm "Chia sẻ vị trí" (đường chính, GPS thật) thì shipper không có bản đồ nào để mở — công
   * sức chia sẻ vị trí coi như bỏ. Giờ FE tự dựng link từ 2 field này khi thiếu map_link.
   */
  customer_lat: z.string().nullable(),
  customer_lng: z.string().nullable(),
  distance_km: z.string().nullable(),
  customer_note: z.string().nullable(),
  items: z.array(AdminOnlineOrderItem),
  /** Tiền MÓN. KHÔNG gồm phí ship (M2.D-62) — xem `ship_fee` ngay dưới. */
  subtotal: z.number().int().nonnegative(),
  /**
   * Phí ship đã chốt (`orders.ship_fee`). `0` khi chưa duyệt / đơn đến lấy / quán miễn phí.
   *
   * Thêm 2026-08-06 vì màn này và màn bàn nói 2 con số khác nhau cho CÙNG một đơn: màn bàn hiện
   * 140.000đ (đã cộng phí ship) còn màn quản lý đơn hiện 120.000đ (chỉ tiền món), không màn nào
   * nói ra vì sao lệch. Nhân viên đối chiếu 2 màn xong không biết tin số nào.
   */
  ship_fee: z.number().int().nonnegative(),
  /**
   * Phí ship GỢI Ý cho ô nhập lúc duyệt — BE tính từ `distance_km` + `free_ship_km` +
   * `ship_fee_per_km` (2026-08-06).
   *
   * `null` = KHÔNG có gợi ý nào, và ô nhập phải để TRỐNG như trước: đơn đến lấy, đơn chưa có toạ
   * độ (khách không chia sẻ vị trí), hoặc chủ quán chưa đặt giá mỗi km. Đừng đổi `null` thành `0`
   * ở bất cứ tầng nào — `0` là một lời khẳng định ("miễn phí"), `null` là "không biết", và ô nhập
   * điền sẵn số 0 cho một đơn giao xa 8km là cách âm thầm làm quán mất tiền.
   *
   * Chỉ là GỢI Ý: nhân viên sửa đè thoải mái, con số ghi vào đơn vẫn là con số họ bấm gửi.
   */
  suggested_ship_fee: z.number().int().nonnegative().nullable(),
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

  // ── Khối dưới đây CHỈ có giá trị khi đơn đã CONFIRMED (đã có `orders` row) ───────────────
  // Thêm 2026-08-04. Trước đó số bàn được cấp chỉ hiện MỘT LẦN trong toast lúc bấm Xác nhận rồi
  // mất hẳn — mở lại tab "Đã xác nhận" không còn biết đơn nào thuộc bàn nào, dù DB có sẵn liên kết.

  /** Mã bàn đã cấp (`orders.table_code`, vd `ship-03`). `null` khi đơn chưa duyệt / bị từ chối. */
  table_code: z.string().nullable(),

  /** TÊN bàn đầy đủ (`restaurant_tables.name`, vd "Ship 03" / "Mang về 02") — thứ hiện ra màn
   * hình (chỉ đạo chủ dự án 2026-08-04: không hiện mã viết tắt). Đọc từ DB chứ KHÔNG suy từ
   * `table_code` ở FE: bàn đổi tên tay thì tên thật mới đúng. `null` cùng điều kiện table_code. */
  table_name: z.string().nullable(),

  /** Đếm món LIVE theo `order_items.state`.
   *
   * ⚠ ĐỌC TỪ `order_items` THẬT, KHÔNG từ `items_snapshot`. Hai danh sách này khác nhau: lúc
   * duyệt, `drop_menu_item_ids` bỏ món hết hàng khỏi đơn thật (M2.D-61). Đếm theo snapshot thì
   * một đơn bị bỏ 1 món sẽ hiện "3/5 xong" mãi mãi, không bao giờ tới đủ.
   *
   * `null` khi chưa có Order thật. `cancelled` gộp cả CANCELLED và OUT_OF_STOCK. */
  item_state_counts: z
    .object({
      total: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
      kitchen: z.number().int().nonnegative(),
      cooking: z.number().int().nonnegative(),
      ready: z.number().int().nonnegative(),
      served: z.number().int().nonnegative(),
      cancelled: z.number().int().nonnegative(),
    })
    .nullable(),

  /** `orders.shipped_at` — shipper đã rời quán. Luôn `null` với PICKUP. */
  shipped_at_ms: z.number().int().nullable(),

  /** `orders.received_at` — khách đã cầm hàng (DELIVERY: đã nhận, PICKUP: đã lấy). */
  received_at_ms: z.number().int().nullable(),

  /** Mốc THU TIỀN (checkout ở màn bàn) — `orders.closed_at` KHI VÀ CHỈ KHI `is_paid=1`.
   * Có giá trị ⟺ đơn thuộc tab "Thành công". ⚠ KHÔNG phải closed_at trần: đơn bị huỷ giữa
   * chừng cũng bị niêm bằng closed_at nhưng is_paid=0 — field này phải là null ở đơn đó,
   * nếu không card đơn huỷ hiện pill "Thành công" (bug 2026-08-04). */
  paid_at_ms: z.number().int().nullable(),
});
export type AdminOnlineOrderRow = z.infer<typeof AdminOnlineOrderRow>;

/** Trạng thái xem được ở màn quản lý đơn online. `CANCELLED_BY_CUSTOMER` KHÔNG có ở đây —
 * khách tự huỷ thì không cần nhân viên làm gì, đưa vào tab chỉ thêm nhiễu. */
// `COMPLETED` (2026-08-04) KHÔNG phải giá trị của `online_order_requests.status` — nó là góc
// nhìn: đơn CONFIRMED mà Order đã checkout (`orders.closed_at` có). Chủ dự án chốt: thu tiền
// xong là đơn "thành công", rời tab Đã xác nhận để tab đó chỉ còn việc đang phải theo.
export const AdminOnlineOrderStatusFilter = z.enum([
  'WAITING',
  'CONFIRMED',
  'REJECTED',
  'COMPLETED',
]);
export type AdminOnlineOrderStatusFilter = z.infer<typeof AdminOnlineOrderStatusFilter>;

/** Cửa sổ thời gian order + bếp được xem đơn online, tính từ lúc KHÁCH ĐẶT (`submitted_at`).
 * Chỉ đạo chủ dự án 2026-08-06: "bếp và order chỉ xem các đơn đặt trong vòng 14h, admin xem hết".
 *
 * Cùng họ với `STAFF_HISTORY_WINDOW_MS` (48h) của nhật ký bàn nhưng KHÁC con số — đây là màn
 * việc-đang-làm nên cửa sổ hẹp hơn. Khai ở package schemas vì cả BE (thực thi) lẫn FE (câu
 * "chỉ hiện 14 giờ gần nhất") đều cần đúng một con số. */
export const STAFF_ONLINE_WINDOW_HOURS = 14;

/** Query `?hours=` của `GET /admin/online-orders` — bộ lọc thời gian của ADMIN.
 *
 * Vắng mặt = không giới hạn. Trần 1 năm để một lần gõ tay `?hours=999999` không biến màn duyệt
 * đơn thành câu quét toàn bảng. Order/bếp gửi param này cũng không nới rộng được quá 14h —
 * xem `resolveOnlineWindowMs`. */
export const AdminOnlineOrderHoursQuery = z.coerce.number().int().min(1).max(24 * 366);

export const AdminOnlineOrderList = z.object({
  items: z.array(AdminOnlineOrderRow),
  // Ngưỡng leo thang SMS (giây) — FE cần để đổi màu đồng hồ đếm giây chờ từng đơn.
  // 09-UI-SPEC: đây là setting, KHÔNG được hardcode 90 ở FE.
  escalate_sms_after_s: z.number().int(),
  /** Cửa sổ ĐANG ÁP DỤNG cho lần gọi này, tính bằng giờ. `null` = không giới hạn (chỉ admin).
   *
   * BE trả về thay vì để FE tự suy từ role: với order/bếp, con số này là LÝ DO danh sách thiếu
   * đơn cũ — màn hình phải nói ra được, nếu không nhân viên tưởng đơn bị mất. */
  window_hours: z.number().int().positive().nullable(),
  /** Số đơn TỪNG TAB (badge cạnh nhãn tab, chỉ đạo 2026-08-04) — đếm ở BE trong CÙNG lần gọi
   * vì FE mỗi lúc chỉ tải 1 tab, tự đếm thì 3 tab kia luôn hiện số cũ.
   *
   * ⚠ Đếm trong CÙNG cửa sổ `window_hours` với `items`. Đếm toàn bảng trong khi danh sách bị
   * cắt theo 14h là badge "12" đứng trên một tab mở ra chỉ có 3 đơn. */
  status_counts: z.object({
    WAITING: z.number().int().nonnegative(),
    CONFIRMED: z.number().int().nonnegative(),
    REJECTED: z.number().int().nonnegative(),
    COMPLETED: z.number().int().nonnegative(),
  }),
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
    /**
     * Tick "chặn số này khỏi đặt online" ngay trong hộp thoại từ chối / huỷ đơn (chỉ đạo chủ dự
     * án 2026-08-06: "khách cố tình phá đám thì cho vào blacklist luôn, đỡ mất công vào màn
     * blacklist").
     *
     * 3 điều đã chốt và KHÔNG được nới:
     * 1. **SĐT lấy từ ĐƠN, không bao giờ từ client.** Body chỉ có cờ bật/tắt — nhận số từ client
     *    là biến 2 endpoint duyệt đơn (cả 3 role gọi được) thành đường chặn số bất kỳ.
     * 2. **Chặn VĨNH VIỄN** (M2.D-59: blacklist chỉ thêm/xoá tay). Gỡ vẫn CHỈ admin làm được ở
     *    `/admin/phone-blacklist` — quyền chặn mở cho 3 role, quyền gỡ thì không.
     * 3. Số đã có trong danh sách → coi như XONG, không phải lỗi: nhân viên tick lần hai không
     *    có lý do gì phải nhìn một câu đỏ, và đơn thì vẫn phải huỷ cho xong.
     */
    blacklist_phone: z.boolean().optional(),
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

/** Body `PATCH :id/items` — sửa món của đơn ĐANG CHỜ DUYỆT (Task.md: "cho phép sửa đơn rồi
 * mới xác nhận", chốt 2026-08-04). Danh sách gửi lên là danh sách THAY THẾ:
 * - id ĐANG có trong đơn  → nhận qty mới (giữ giá + ghi chú đã chốt lúc khách đặt);
 * - id vắng mặt           → món bị bỏ khỏi đơn;
 * - id KHÔNG có trong đơn → GỌI THÊM món đó (chỉ đạo chủ dự án 2026-08-04): BE lấy giá menu
 *   HIỆN TẠI và `note` gửi kèm; món phải đang bán + còn hàng, không thì 409. Vì giá món thêm
 *   chốt sau lưng khách, nhân viên phải đọc lại đơn+tổng mới cho khách trước khi Xác nhận. */
export const EditOnlineOrderItemsBody = z.object({
  items: z
    .array(
      z.object({
        menu_item_id: z.string().uuid(),
        qty: z.number().int().min(1).max(99),
        /** Ghi chú cho bếp — CHỈ dùng khi là món GỌI THÊM; món sẵn có giữ note cũ của khách. */
        note: z.string().max(255).nullable().optional(),
      }),
    )
    .min(1, 'Đơn phải còn ít nhất 1 món — muốn bỏ cả đơn hãy dùng nút Từ chối')
    .max(50),
});
export type EditOnlineOrderItemsBody = z.infer<typeof EditOnlineOrderItemsBody>;

/** Kết quả `PATCH :id/items` — trả danh sách món MỚI (đã re-check tồn kho như GET list) +
 * subtotal mới để FE vá row tại chỗ, không phải gọi lại GET. */
export const EditOnlineOrderItemsResult = z.object({
  items: z.array(AdminOnlineOrderItem),
  subtotal: z.number().int().nonnegative(),
});
export type EditOnlineOrderItemsResult = z.infer<typeof EditOnlineOrderItemsResult>;

/** Kết quả `POST :id/ship` và `:id/receive` (2 chặng giao hàng, 2026-08-04). Trả về CẢ HAI mốc
 * (không chỉ mốc vừa set) để FE vá row tại chỗ mà không phải gọi thêm 1 GET — và vì BE không
 * ghi đè mốc đã có (bấm 2 lần), FE phải tin con số trả về chứ không tự lấy `Date.now()`. */
export const FulfillmentResult = z.object({
  order_id: z.string().uuid(),
  table_code: z.string(),
  fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  shipped_at_ms: z.number().int().nullable(),
  received_at_ms: z.number().int().nullable(),
});
export type FulfillmentResult = z.infer<typeof FulfillmentResult>;

/** Nhãn tiếng Việt của 2 hình thức nhận hàng. Khai ở đây để BE (câu báo lỗi 409, nhật ký bàn)
 * và FE (nút "Chuyển sang …", câu xác nhận) đọc CÙNG một chuỗi — nhân viên bấm nút ghi
 * "Đến lấy tại quán" thì nhật ký cũng phải ghi đúng chữ đó.
 *
 * ⚠ Chuỗi này trùng `PICKUP_LABEL`/`DELIVERY_LABEL` mà trang khách (`apps/shop`) đang khai
 * riêng — cố ý chưa gộp: chữ cho KHÁCH và chữ cho NHÂN VIÊN được phép rẽ nhánh về sau. */
export const FULFILLMENT_LABEL: Record<'PICKUP' | 'DELIVERY', string> = {
  PICKUP: 'Đến lấy tại quán',
  DELIVERY: 'Giao tận nơi',
};

/** Body `POST :id/fulfillment` — ĐỔI hình thức nhận hàng của một đơn (chốt 2026-08-06:
 * "chuyển từ đi ship sang lấy tại quán và ngược lại, order/bếp/admin đều làm được, bất cứ lúc
 * nào TRƯỚC khi mang đi ship").
 *
 * `customer_address` chỉ có nghĩa khi đổi SANG `DELIVERY`:
 * - đơn chưa có địa chỉ (khách đặt PICKUP) → BẮT BUỘC gửi, không thì 400 `ADDRESS_REQUIRED`;
 * - đơn đã có địa chỉ và nhân viên không gõ gì → giữ nguyên địa chỉ cũ.
 * Gõ địa chỉ MỚI khác địa chỉ đang lưu thì toạ độ + link bản đồ + `distance_km` bị XOÁ, vì cả 3
 * thuộc về địa chỉ cũ — giữ lại là để shipper mở bản đồ ra một cái nhà không còn liên quan.
 *
 * `ship_fee` chỉ áp cho đơn ĐÃ DUYỆT đổi sang `DELIVERY` (đơn chờ duyệt chưa có `orders` để
 * ghi phí — nhân viên nhập ở ô phí ship lúc bấm Xác nhận như cũ). Đổi sang `PICKUP` thì phí ship
 * LUÔN về 0, không cần gửi field này. */
export const SwitchFulfillmentBody = z.object({
  fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  customer_address: z.string().max(255).optional(),
  ship_fee: z.number().int().min(0).max(1_000_000).optional(),
});
export type SwitchFulfillmentBody = z.infer<typeof SwitchFulfillmentBody>;

/** Kết quả `POST :id/fulfillment`. Trả đủ 6 thứ card đang hiển thị để FE vá row tại chỗ, không
 * phải gọi lại GET list — và `from_fulfillment_type` để audit log (`after_json` lấy từ chính
 * response này) tự đọc được "đổi từ gì sang gì" mà không cần chụp before/after riêng. */
export const SwitchFulfillmentResult = z.object({
  request_id: z.string().uuid(),
  from_fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  customer_address: z.string().nullable(),
  distance_km: z.string().nullable(),
  /** Bàn MỚI sau khi đổi (`null` khi đơn chưa duyệt — chưa có bàn nào để đổi). */
  table_code: z.string().nullable(),
  table_name: z.string().nullable(),
  /** Mã bàn TRƯỚC khi đổi, để câu toast nói được "Ship 03 → Mang về 02". */
  previous_table_code: z.string().nullable(),
  /** Bàn mới là bàn TỰ TẠO (hết bàn trống cùng loại) — cùng cơ chế M2.D-05 của confirm(). */
  table_created: z.boolean(),
  ship_fee: z.number().int().nonnegative(),
  /** Gợi ý phí ship TÍNH LẠI theo `distance_km` mới (2026-08-06) — cùng nghĩa `null` với
   * `AdminOnlineOrderRow.suggested_ship_fee`. Đi kèm ở đây để FE vá row bằng số mới thay vì giữ
   * gợi ý của địa chỉ cũ. */
  suggested_ship_fee: z.number().int().nonnegative().nullable(),
});
export type SwitchFulfillmentResult = z.infer<typeof SwitchFulfillmentResult>;

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

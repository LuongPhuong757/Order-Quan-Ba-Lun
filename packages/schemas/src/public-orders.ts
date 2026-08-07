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
      /** Id món trong menu — thứ DUY NHẤT ở payload này không phải để hiển thị.
       *
       * Thêm 2026-08-06 cho luồng khách tự sửa đơn (`PATCH`): trang `/o/:token` phải dựng lại
       * được giỏ hàng từ đơn đang chờ, mà `PATCH` chỉ nhận `menu_item_id` (giá do BE tra, xem
       * `OnlineOrderItemInput`). Không có field này thì FE không có đường nào biết dòng "Bún chả"
       * ứng với món nào trong menu.
       *
       * KHÔNG vi phạm G-1: đây là id công khai, `GET /api/public/menu` đã trả đúng nó cho mọi
       * khách. `null` khi món được thêm tay ở bàn sau khi quán duyệt (`order_items.menu_item_id`
       * rỗng) — FE phải chịu được null, đừng đổi thành `z.string()`. */
      menu_item_id: z.string().nullable(),
      name: z.string(),
      qty: z.number().int().positive(),
      unit_price: z.number().int().nonnegative(),
      // 2026-08-04: ảnh món cho trang theo dõi đơn (giống giỏ hàng). Tra LIVE từ `menu_items`
      // theo `menu_item_id` lúc đọc — KHÔNG snapshot: ảnh chỉ để minh hoạ, không phải dữ liệu
      // chốt giá. Món đã xoá khỏi menu / chưa có ảnh → null, FE tự vẽ placeholder.
      image: z.string().nullable(),
      /** Ghi chú KHÁCH tự dặn cho món này ("ít cay"). Không đụng G-1: G-1 cấm lộ TRẠNG THÁI
       * từng món (thông tin vận hành nội bộ), còn đây là dữ liệu chính khách vừa nhập —
       * cho xem lại để khách soát mình đã dặn đúng chưa. */
      note: z.string().nullable(),
    }),
  ),
  subtotal: z.number().int().nonnegative(),
  /**
   * Phí giao hàng quán chốt khi duyệt đơn (M2.D-62). `0` = chưa có/không áp dụng (đơn PICKUP,
   * đơn còn chờ duyệt, hoặc quán miễn phí ship).
   *
   * Thêm 2026-08-06 vì chủ dự án phát hiện: admin nhập phí ship xong thì KHÁCH KHÔNG HỀ BIẾT —
   * trang `/o/:token` chỉ hiện tiền món và gọi nó là "Tổng cộng". Khách chuẩn bị đúng số tiền đó,
   * shipper tới đòi thêm, và người chịu trận là shipper. Tiền khách phải trả mà khách không được
   * báo trước là lỗi nặng hơn mọi lỗi hiển thị khác.
   *
   * `subtotal` VẪN là tiền MÓN và KHÔNG bao giờ gồm số này (M2.D-62 — phí ship là tiền thu hộ,
   * không vào doanh thu món). FE tự cộng để hiện dòng "Tổng cộng".
   */
  ship_fee: z.number().int().nonnegative(),
  /**
   * Phí giao TẠM TÍNH — con số khách đã nhìn thấy ở bước đặt hàng, tính lại từ `distance_km` đã
   * lưu trong đơn + bảng bậc hiện hành (`computeShipFee`, cùng công thức với trang đặt hàng và
   * với ô điền sẵn phía admin).
   *
   * `null` khi KHÔNG được nói với khách một con số nào:
   *   - đơn PICKUP (không có phí giao),
   *   - chưa đo được km (khách không chia sẻ vị trí / quán chưa có toạ độ) hoặc bảng bậc rỗng,
   *   - **đơn đã được quán duyệt** — lúc đó `ship_fee` là số CHỐT, và để cả hai số cùng sống là
   *     mời khách đoán xem số nào mới là số phải trả.
   *
   * Thêm 2026-08-07 vì chủ dự án phát hiện: khách xem phí ship ở giỏ hàng, đặt xong vào trang theo
   * dõi thì phí ship biến mất và "Tổng cộng" tụt xuống chỉ còn tiền món — trông y như quán đã bỏ
   * phí ship. FE PHẢI hiện kèm câu "tạm tính, quán gọi lại xác nhận" (xem `OrderTrackPage`);
   * hiện số này như một khoản đã chốt là tái lập đúng lỗi mà `ship_fee` sinh ra hồi 2026-08-06.
   *
   * `subtotal` VẪN là tiền MÓN và không gồm số này.
   */
  ship_fee_estimated: z.number().int().nonnegative().nullable(),
  /** Ghi chú KHÁCH dặn cho CẢ ĐƠN ("giao giờ trưa"). Cùng lý lẽ với `note` của từng món: đây là
   * dữ liệu chính khách nhập, cho xem lại để soát — không phải thông tin vận hành nội bộ, nên
   * không đụng G-1. (Ghi chú NỘI BỘ của admin là `internal_reject_note`, D-09 cấm tuyệt đối.)
   *
   * Thêm 2026-08-06 cùng luồng khách tự sửa đơn: thiếu field này thì màn sửa hiện ô ghi chú
   * TRỐNG, và mỗi lần khách sửa món là lời dặn cũ bị xoá im lặng. */
  customer_note: z.string().nullable(),
  /** Địa chỉ giao hàng (null khi PICKUP).
   *
   * ⚠ Đây là NGOẠI LỆ có chủ đích của "whitelist đóng, không PII" ở docblock đầu schema này —
   * chủ dự án chốt 2026-08-06: khách phải sửa được địa chỉ khi đơn còn chờ duyệt. Không có field
   * này thì màn sửa hiện ô địa chỉ TRỐNG, và mỗi lần khách sửa món là địa chỉ giao bị ghi đè bằng
   * rỗng — hỏng đúng thứ quan trọng nhất của đơn giao tận nơi.
   *
   * Ranh giới vẫn giữ: chỉ địa chỉ, KHÔNG tên, KHÔNG SĐT, KHÔNG toạ độ. Ai cầm `order_token` thì
   * vốn đã sửa/huỷ được đơn rồi, nên đọc được địa chỉ giao của chính đơn đó không mở thêm cửa
   * nào; còn SĐT thì tuyệt đối không ra (nó là khoá tra cứu lịch sử của khách). */
  customer_address: z.string().nullable(),
  submitted_at_ms: z.number().int(),
  store_phone: z.string(),
  reject_reason: z.string().nullable(),
  // ── Phase 9 (REQ-O, spec §6) ──
  stage: OrderStage,
  stage_label: z.string(),
  percent: z.number().int().min(0).max(100),
  cancelled_count: z.number().int().nonnegative(),
  cancelled_note: z.string().nullable(),
  /**
   * Dòng phụ dưới nhãn mốc — BE soạn sẵn, FE render NGUYÊN VĂN. `null` = không hiện dòng nào.
   *
   * Thay cho cặp `eta_min`/`eta_max` (bỏ 2026-08-06). Hai số đó buộc FE tự ghép câu "Dự kiến còn
   * khoảng X–Y phút", và vì FE không biết mốc nào thì con số còn đúng nên nó hiện y hệt ở cả 6 mốc
   * của đơn giao tận nơi — kể cả lúc shipper sắp tới cửa. Nay việc "mốc này nói gì" nằm ở ĐÚNG MỘT
   * chỗ là `etaLine()` phía BE, cùng nhà với `stage_label`; xem docblock hàm đó.
   *
   * Đừng đưa lại số phút thô vào payload rồi để FE tự quyết: đó chính là cấu trúc đã sinh ra lỗi.
   */
  eta_text: z.string().nullable(),
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
 * Hợp đồng `PATCH /api/public/orders/:token` — khách tự SỬA đơn khi quán CHƯA duyệt.
 *
 * Đây là NỬA CÒN LẠI của M2.D-44, bị hoãn từ phase 9 (xem đầu `cancel-order.ts`) và được chủ dự
 * án chốt làm ngày 2026-08-06: "chưa xác nhận thì khách vẫn sửa hoặc huỷ được".
 *
 * 3 ranh giới đã chốt, đừng nới:
 *
 * 1. **Sửa được MÓN + GHI CHÚ + ĐỊA CHỈ GIAO. KHÔNG sửa được SĐT.** SĐT là thứ neo mọi ràng buộc
 *    của đơn (quota 3 đơn/giờ, blacklist, "1 đơn mở / 1 SĐT", phiên OTP) — cho đổi qua endpoint
 *    chỉ cầm `order_token` là mở đường đi vòng qua cả 4 chốt đó. Tên cũng không, vì `GET /:token`
 *    không trả tên nên FE không có bản cũ để prefill (địa chỉ thì đã được nới, xem
 *    `PublicOrderStatus.customer_address`).
 *
 *    Địa chỉ chỉ có nghĩa với đơn DELIVERY. Đơn PICKUP gửi `customer_address` lên là 409 —
 *    KHÔNG âm thầm bỏ qua: âm thầm bỏ qua nghĩa là khách gõ địa chỉ, bấm cập nhật, thấy "thành
 *    công", rồi ra quán mới biết chẳng ai giao gì cả.
 *
 *    Đổi địa chỉ thì toạ độ đi kèm PHẢI được gửi lại (hoặc xoá): giữ toạ độ cũ cho địa chỉ mới là
 *    ghim bản đồ chỉ sang nhà cũ — shipper đi theo ghim, không đi theo chữ.
 * 2. **Đơn đã xác nhận thì KHÔNG sửa** — 409, và câu báo mời khách đặt ĐƠN MỚI (chốt 2026-08-06:
 *    không làm cơ chế "đơn bổ sung" gắn vào đơn cũ). Bếp có thể đã nấu, shipper có thể đã cầm đơn
 *    đi; sửa vào lúc đó là sửa một bản không ai đọc nữa.
 * 3. **Không có `unit_price`** — cùng lý do T-08-49 của `OnlineOrderItemInput`: giá luôn do BE
 *    quyết. Món cũ giữ giá đã chốt lúc đặt, món gọi thêm lấy giá menu hiện tại.
 *
 * `customer_note`: vắng mặt = GIỮ NGUYÊN ghi chú cũ; chuỗi rỗng = XOÁ. Hai chuyện khác nhau, đừng
 * gộp — gộp thì mọi lần sửa món của khách không gõ lại ghi chú sẽ im lặng xoá lời dặn cũ.
 */
export const PublicOrderEdit = z.object({
  items: z.array(OnlineOrderItemInput).min(1).max(50),
  customer_note: z.string().max(500).optional(),
  /** Địa chỉ giao mới. Vắng mặt = GIỮ NGUYÊN (cùng quy ước với `customer_note`). CHỈ hợp lệ với
   * đơn DELIVERY; `.min(1)` vì đơn giao mà địa chỉ rỗng là đơn không giao được — muốn bỏ giao tận
   * nơi thì huỷ đơn rồi đặt lại kiểu Đến lấy. */
  customer_address: z.string().min(1).max(255).optional(),
  /** Toạ độ mới đi kèm địa chỉ. Gửi `null` tường minh = XOÁ toạ độ cũ (khách đổi sang địa chỉ
   * khác mà không chia sẻ lại vị trí) — vắng mặt mới là giữ nguyên. Phân biệt được hai chuyện này
   * là điều kiện để không bao giờ còn ghim bản đồ chỉ sang nhà cũ. */
  customer_lat: z.number().min(-90).max(90).nullable().optional(),
  customer_lng: z.number().min(-180).max(180).nullable().optional(),
  customer_map_link: z.string().max(512).nullable().optional(),
});
export type PublicOrderEdit = z.infer<typeof PublicOrderEdit>;

/**
 * Kết quả sửa đơn. Trả lại danh sách món ĐÃ CHỐT phía server (kèm giá) thay vì chỉ `{ ok: true }`:
 * khách vừa sửa xong phải đọc được bản server thực sự lưu, nhất là món gọi thêm — giá của nó lấy
 * từ menu tại thời điểm sửa, FE không tự đoán được.
 */
export const PublicOrderEditResult = z.object({
  order_token: z.string(),
  items: z.array(
    z.object({
      menu_item_id: z.string(),
      name: z.string(),
      qty: z.number().int().positive(),
      unit_price: z.number().int().nonnegative(),
      note: z.string().nullable(),
    }),
  ),
  subtotal: z.number().int().nonnegative(),
});
export type PublicOrderEditResult = z.infer<typeof PublicOrderEditResult>;

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
      /** Id món trong menu — thứ duy nhất ở dòng này không phải để hiển thị.
       *
       * Thêm 2026-08-06 cho nút "Đặt lại" trên card lịch sử: nạp lại giỏ hàng chỉ cần id + qty,
       * còn giá/tên/ảnh thì FE tra LIVE từ `/api/public/menu` (giá cũ của đơn tháng trước không
       * phải giá hôm nay — nạp lại theo giá cũ là hứa với khách một mức giá không tồn tại).
       *
       * `null` khi món do nhân viên thêm tay ở bàn sau khi duyệt (`order_items.menu_item_id`
       * rỗng) hoặc món đã bị xoá khỏi menu — FE phải chịu được null (bỏ qua dòng đó và nói ra).
       * Cùng lý lẽ không-vi-phạm-G-1 với `menu_item_id` của `PublicOrderStatus`: id này vốn đã
       * công khai qua `GET /api/public/menu`. */
      menu_item_id: z.string().nullable(),
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

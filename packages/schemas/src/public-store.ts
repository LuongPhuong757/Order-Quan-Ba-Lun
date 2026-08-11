import { z } from 'zod';
import { ShipFeeTier } from './ship-fee.js';

// M2.D-17/D-27/D-30 — hợp đồng GET /api/public/store.
// store_lat/store_lng KHÔNG trả cho khách (toạ độ quán không cần lộ,
// khoảng cách luôn tính ở BE — xem Architectural Responsibility Map trong 08-RESEARCH.md).

export const OpenHourRule = z.object({
  dow: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  from: z.string(), // "HH:mm"
  to: z.string(), // "HH:mm"
});
export type OpenHourRule = z.infer<typeof OpenHourRule>;

export const PublicStoreStatus = z.object({
  ordering_enabled: z.boolean(),
  off_reason: z.string(),
  store_phone: z.string(),
  // ── Footer trang khách (2026-08-04) — địa chỉ + Facebook + Zalo ──
  // Rỗng = chủ quán chưa điền → footer ẩn dòng/nút đó (không hiện link chết).
  // `store_zalo` là SĐT hoặc link zalo.me/Zalo OA — FE tự nhận dạng (xem shop-contact.ts).
  store_address: z.string(),
  store_facebook_url: z.string(),
  store_instagram_url: z.string(),
  store_zalo: z.string(),
  open_hours: z.array(OpenHourRule),
  is_open_now: z.boolean(),
  blocking_reason: z.enum(['MANUAL_OFF', 'OUTSIDE_HOURS']).nullable(),
  // ── D-11/D-14 (phase 9) — 2 câu chữ chủ quán tự soạn ──
  // `ordering_enabled === false` nay CHỈ có nghĩa "đang Đóng cửa", KHÔNG còn nghĩa "chặn đặt đơn".
  // Khách vẫn gửi được đơn; hai chuỗi này là toàn bộ khác biệt mà khách nhìn thấy.
  //
  // Vì sao `closed_submit_confirm_text` cũng nằm ở endpoint này (lệch gợi ý của 09-PATTERNS.md):
  // trang `/o/:token` cần câu xác nhận ĐÓ SAU KHI TẢI LẠI TRANG. Truyền qua router state thì khách
  // refresh một cái là mất. Đặt ở đây (1 request, không poll, vài trăm byte) cho `OrderTrackPage`
  // đọc lại bất cứ lúc nào — và tự đúng nếu quán đã mở lại trong lúc đó.
  closed_banner_text: z.string(),
  closed_submit_confirm_text: z.string(),
  pickup_enabled: z.boolean(),
  delivery_enabled: z.boolean(),
  // ── OTP đăng nhập bằng SĐT (2026-08-04) ──
  // true = checkout/tra cứu yêu cầu phiên OTP (`otp_login_enabled` trong settings). FE đọc
  // cờ này để quyết định có chen bước OTP hay không — nhưng chốt CHẶN THẬT nằm ở BE
  // (`submit-order.ts` + `lookupByPhone`), cờ này chỉ là UI hint.
  otp_required: z.boolean(),
  /**
   * Bảng phí giao theo bậc giá trị đơn (2026-08-07) — CÔNG KHAI có chủ đích: trang khách phải
   * hiện được bảng giá này ở bước đặt hàng và trang Hướng dẫn, kể cả khi chưa biết khách ở đâu.
   * Nó là bảng giá niêm yết, không phải dữ liệu nội bộ.
   *
   * Rỗng = quán chưa cấu hình → không đâu hiện phí tạm tính, và trang khách chỉ nói "phí giao do
   * quán xác nhận khi gọi lại". Đó cũng là mặc định của hệ thống.
   */
  ship_fee_tiers: z.array(ShipFeeTier),
  distance_factor: z.number(),
  /**
   * Bản đồ ở bước chọn vị trí có được vẽ không (2026-08-07) — công tắc `map_checkout_enabled`.
   *
   * Là CỜ HIỂN THỊ thuần: tắt thì trang khách quay về đúng hành vi cũ (nút "Xem trên bản đồ" mở
   * Google Maps ở tab ngoài), không có gì về đơn thay đổi. Toạ độ vẫn được gửi kèm đơn như cũ vì
   * nó đến từ GPS/link khách dán, không phải từ bản đồ.
   *
   * Cờ đi kèm `GET /api/public/store` chứ không phải một request riêng: trang khách đã gọi
   * endpoint này trước khi vẽ gì, thêm một request nữa chỉ để hỏi "có vẽ map không" là đánh đổi
   * ngược — tốn một vòng mạng trên 4G để tiết kiệm vài byte.
   */
  map_checkout_enabled: z.boolean(),
  /**
   * Ô "Tỉnh / Thành phố" của khách có bị khoá về một tỉnh không (2026-08-11) — công tắc
   * `province_lock_enabled` ở /admin.
   *
   * `true` → trang khách bày tỉnh thành một dòng chữ chỉ đọc (Bắc Ninh), khách chỉ chọn xã.
   * `false` → chọn được cả 34 tỉnh. Mặc định `false`.
   *
   * CỜ HIỂN THỊ, KHÔNG PHẢI LUẬT NHẬN ĐƠN. BE vẫn nhận mã xã của mọi tỉnh khi cờ đang bật, và đó
   * là cố ý: khoá là để dẫn hướng cho khách khỏi chọn nhầm chỗ quán không tới, còn việc từ chối
   * đơn quá xa đã có `delivery-radius.ts` làm bằng toạ độ thật. Lấy ranh giới hành chính làm luật
   * nhận đơn là loại nhầm người ở rìa tỉnh — nhà cách quán 3 km nhưng khác tỉnh — trong khi vẫn
   * nhận người cùng tỉnh mà cách 60 km. Đơn vị hành chính không phải đơn vị đo khoảng cách.
   *
   * Vì vậy đổi cờ này KHÔNG đụng gì tới đơn cũ và không cần đợi khách tải lại trang.
   */
  province_lock_enabled: z.boolean(),
  eta: z.object({
    pickup: z.object({ min: z.number().int(), max: z.number().int() }),
    delivery: z.object({ min: z.number().int(), max: z.number().int() }),
  }),
});
export type PublicStoreStatus = z.infer<typeof PublicStoreStatus>;

/**
 * `POST /api/public/ship-quote` — ước tính khoảng cách + phí giao TRƯỚC khi khách gửi đơn
 * (2026-08-06).
 *
 * Vì sao là endpoint riêng chứ không nhét toạ độ quán vào `GET /api/public/store` cho FE tự tính:
 * `store_lat`/`store_lng` CỐ Ý không công khai (xem đầu file này), và "BE là nơi duy nhất tính
 * Haversine" là ranh giới đã chốt từ M2.D-49/D-50. Cho FE tính thì con số khách thấy ở checkout và
 * con số quán thấy ở màn duyệt đơn sẽ trôi khỏi nhau ngay lần đầu ai đó sửa hệ số đường bộ.
 *
 * POST chứ không GET: toạ độ nhà khách không nên nằm trên URL (log truy cập, header Referer).
 */
export const PublicShipQuoteInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /**
   * TIỀN MÓN của giỏ hàng (không gồm ship) — quyết định BẬC phí nào được áp dụng (2026-08-07).
   *
   * Con số này do client gửi và điều đó CHẤP NHẬN ĐƯỢC vì nó chỉ ảnh hưởng tới một ƯỚC TÍNH hiển
   * thị: phí thật ghi vào đơn là số nhân viên gõ lúc duyệt, tính từ `subtotal` server tự cộng lại
   * từ giá trong DB. Khai man ở đây chỉ làm khách tự xem một con số sai, không đổi được gì.
   */
  subtotal: z.number().int().nonnegative(),
});
export type PublicShipQuoteInput = z.infer<typeof PublicShipQuoteInput>;

export const PublicShipQuote = z.object({
  /** Km đường bộ ƯỚC TÍNH (Haversine × `distance_factor`). `null` = quán chưa cấu hình toạ độ
   * → không có gốc để đo, và FE phải im lặng thay vì đoán bừa. */
  distance_km: z.number().nullable(),
  /**
   * Phí giao TẠM TÍNH theo bậc ứng với `subtotal`. `null` = chưa tính được (thiếu toạ độ quán)
   * HOẶC quán chưa cấu hình bảng bậc — cả hai đều nghĩa là "đừng hứa với khách con số nào",
   * khác hẳn `0` nghĩa là MIỄN PHÍ.
   *
   * Đây LUÔN là ước tính: phí chốt thật do quán nhập lúc duyệt đơn (M2.D-62), và mọi câu chữ FE
   * kèm số này phải nói rõ điều đó.
   */
  ship_fee: z.number().int().nonnegative().nullable(),
  /** Bậc ĐANG ÁP DỤNG cho giỏ hàng này — FE dùng để viết "Đơn từ 100.000đ: miễn phí 5 km".
   *  `null` khi quán chưa cấu hình bảng bậc. */
  tier: ShipFeeTier.nullable(),
  /** Bậc NGAY TRÊN (nếu còn) — để gợi ý "mua thêm 40.000đ nữa được miễn phí 7 km". */
  next_tier: ShipFeeTier.nullable(),
  /**
   * Bán kính giao TỐI ĐA của quán (2026-08-07) — `0` = quán không đặt giới hạn.
   *
   * Công khai có chủ đích, cùng lý lẽ với `ship_fee_tiers`: đây là điều kiện phục vụ, khách phải
   * đọc được con số quán đang áp thay vì chỉ nhận một câu "quá xa". Nó KHÔNG tiết lộ vị trí quán
   * (một bán kính không có tâm thì không định vị được gì).
   */
  max_delivery_km: z.number(),
  /**
   * Vị trí khách VƯỢT bán kính trên → quán không nhận đơn giao tới đây.
   *
   * Vì sao là field riêng chứ không để FE tự so `distance_km > max_delivery_km`: đây là một QUYẾT
   * ĐỊNH nghiệp vụ, và nó phải do đúng một nơi ra — BE. FE tự so thì hai bên lệch nhau ngay lần
   * đầu ai đó đổi cách làm tròn km, và triệu chứng là khách bị chặn ở bước cuối sau khi trang
   * checkout đã bảo "ổn" (hoặc ngược lại).
   *
   * `false` khi CHƯA tính được (`distance_km === null`, quán thiếu toạ độ) hoặc quán không đặt
   * giới hạn — "không biết" không bao giờ được thành "quá xa".
   */
  too_far: z.boolean(),
});
export type PublicShipQuote = z.infer<typeof PublicShipQuote>;

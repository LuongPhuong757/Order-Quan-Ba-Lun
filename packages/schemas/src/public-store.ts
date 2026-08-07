import { z } from 'zod';

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
  free_ship_km: z.number().int(),
  distance_factor: z.number(),
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
});
export type PublicShipQuoteInput = z.infer<typeof PublicShipQuoteInput>;

export const PublicShipQuote = z.object({
  /** Km đường bộ ƯỚC TÍNH (Haversine × `distance_factor`). `null` = quán chưa cấu hình toạ độ
   * → không có gốc để đo, và FE phải im lặng thay vì đoán bừa. */
  distance_km: z.number().nullable(),
  /**
   * Phí giao TẠM TÍNH theo `free_ship_km` + `ship_fee_per_km`. `null` = chưa tính được
   * (thiếu toạ độ quán) HOẶC chủ quán chưa đặt giá mỗi km (`ship_fee_per_km = 0`) — hai trường
   * hợp đều có nghĩa "đừng hứa với khách một con số nào", khác hẳn `0` nghĩa là MIỄN PHÍ.
   *
   * Đây LUÔN là ước tính: phí chốt thật do quán nhập lúc duyệt đơn (M2.D-62), và mọi câu chữ FE
   * kèm số này phải nói rõ điều đó.
   */
  ship_fee: z.number().int().nonnegative().nullable(),
  /** Bán kính miễn phí đang áp dụng — FE dùng để giải thích vì sao phí bằng 0. */
  free_ship_km: z.number().int(),
});
export type PublicShipQuote = z.infer<typeof PublicShipQuote>;

// Nguồn: docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §4.1 (dòng ~230-260).
// Đủ 21 key + kiểu parse của bảng `store_settings` (key-value, cột `value` luôn là text —
// 20 key từ phase 8, rồi phase 9 (D-12/D-14) xoá key auto-OFF và thêm 2 key câu chữ —
// xem entity `store-settings.entity.ts`). SettingsService (plan 08-05) đọc bảng này để biết
// cách parse `value` theo `kind` và giá trị fallback khi DB chưa có row (quán mới cài).
//
// Module thuần: không import gì từ @nestjs/* hay typeorm (chỉ 1 `import type` từ @order/schemas,
// không kéo theo runtime nào).

import type { ShipFeeTier } from '@order/schemas';

export type SettingKind = 'bool' | 'int' | 'float' | 'string' | 'json';

export type SettingDefault =
  | { key: string; kind: 'bool'; default: boolean }
  | { key: string; kind: 'int'; default: number }
  | { key: string; kind: 'float'; default: number }
  | { key: string; kind: 'string'; default: string }
  | { key: string; kind: 'json'; default: unknown };

export const SETTINGS_DEFAULTS: readonly SettingDefault[] = [
  { key: 'online_ordering_enabled', kind: 'bool', default: true },
  { key: 'online_ordering_off_mode', kind: 'string', default: 'MANUAL' },
  { key: 'online_ordering_off_reason', kind: 'string', default: '' },
  { key: 'online_ordering_off_until_ms', kind: 'json', default: null },
  // [] = chưa cấu hình giờ mở cửa → evaluateOrderingStatus() coi là KHÔNG giới hạn giờ,
  // luôn mở (xem isWithinOpenHours() trong store-status.ts). Không phải "đóng cửa cả tuần".
  { key: 'open_hours', kind: 'json', default: [] },
  { key: 'store_phone', kind: 'string', default: '' },
  // ── Footer trang khách (2026-08-04) — địa chỉ + 2 kênh liên hệ ──
  // Rỗng = footer ẨN HẲN dòng/nút tương ứng (không hiện link chết) — xem Footer.tsx apps/shop.
  // Chủ quán sửa ở /admin (khối "Thông tin quán"), ăn ngay không cần build lại (tiền lệ D-14).
  { key: 'store_address', kind: 'string', default: '' },
  { key: 'store_facebook_url', kind: 'string', default: '' },
  { key: 'store_instagram_url', kind: 'string', default: '' },
  // Số điện thoại Zalo HOẶC link đầy đủ (zalo.me / Zalo OA) — FE tự nhận dạng dạng nào.
  { key: 'store_zalo', kind: 'string', default: '' },
  // null = chưa cấu hình toạ độ quán → chưa tính được distance_km (Haversine cần gốc thật).
  { key: 'store_lat', kind: 'json', default: null },
  { key: 'store_lng', kind: 'json', default: null },
  // ── Bảng phí giao theo BẬC GIÁ TRỊ ĐƠN (2026-08-07) ──
  // `[{ min_subtotal, free_km, per_km }, …]` — xem `@order/schemas/ship-fee.ts` (công thức dùng
  // chung cho cả 3 nơi: trang khách, màn duyệt đơn, và BE).
  // `[]` = CHƯA CẤU HÌNH → không đâu hiện phí tạm tính, ô phí ship ở màn duyệt để trống, câu chữ
  // quay về "quán sẽ báo phí khi gọi lại". Mặc định phải là rỗng chứ không phải một bảng "hợp
  // lý": mỗi quán một bảng giá, đoán hộ họ là khách đọc được con số quán chưa bao giờ đồng ý.
  { key: 'ship_fee_tiers', kind: 'json', default: [] },
  { key: 'distance_factor', kind: 'float', default: 1.3 },
  { key: 'pickup_enabled', kind: 'bool', default: true },
  { key: 'delivery_enabled', kind: 'bool', default: true },
  { key: 'escalate_sms_after_s', kind: 'int', default: 90 },
  // ── D-14 (chốt 2026-07-31) — 2 câu chữ chủ quán tự sửa ở `/admin/settings` ──
  // Đổi chữ là ăn ngay ở trang khách, KHÔNG cần build lại — quan trọng vì Milestone 2 đang cấm
  // deploy production. **Độ dài KHÔNG giới hạn** (cột `store_settings.value` là text): chủ quán tự
  // soạn câu, không ai đoán trước được họ viết dài bao nhiêu, nên tầng nào cũng không được cắt.
  { key: 'closed_banner_text', kind: 'string', default: 'Hiện chúng tôi đang đóng cửa, đơn của quý khách cứ tiếp tục đặt và chúng tôi sẽ xử lý sớm nhất có thể' },
  { key: 'closed_submit_confirm_text', kind: 'string', default: 'Chúng tôi đã tiếp nhận đơn, và sẽ liên hệ khi quán mở lại' },
  // ⚠ Key `escalate_autooff_…` cũ (mức leo thang thứ 4 — tự TẮT nhận đơn sau 1800s) ĐÃ BỊ XOÁ HẲN
  // theo D-12 — không phải để lại no-op. Tên key cố ý không viết đủ ở đây để lệnh kiểm
  // "không còn nơi nào tham chiếu key đó" giữ được ý nghĩa.
  // Lý do xoá thay vì giữ: `outbox-rules.ts` chưa bao giờ sinh
  // hàng `level = 'L4'` (có test khẳng định điều đó), và `OnlineOrderSettingsPanel.tsx` không có UI nào
  // render key này — giữ lại một setting không ai đọc là mời người sau cài lại auto-OFF.
  // Dòng cũ trong DB (nếu admin từng ghi) được `readAll()` bỏ qua tự nhiên qua `if (!kind) continue`,
  // không cần xoá tay. D-12 ghi đè M2.D-36 (phần auto-OFF) và M2.D-60 — xem OVERRIDE-DEBT.md OD-15.
  { key: 'notify_sms_recipients', kind: 'json', default: [] },
  { key: 'notify_email_recipients', kind: 'json', default: [] },
  { key: 'eta_pickup_min', kind: 'int', default: 15 },
  { key: 'eta_pickup_max', kind: 'int', default: 25 },
  { key: 'eta_delivery_min', kind: 'int', default: 30 },
  { key: 'eta_delivery_max', kind: 'int', default: 45 },
  // ── Bảng xếp hạng "Top món" trên trang khách (chỉ đạo 2026-08-04) ──
  // Số hiển thị là SUM suất SERVED THẬT của đơn đã thanh toán (POS + online) —
  // KHÔNG có setting "số cộng thêm": DESIGN.md apps/shop cấm số liệu bán hàng bịa.
  { key: 'top_dishes_enabled', kind: 'bool', default: true },
  { key: 'top_dishes_limit', kind: 'int', default: 10 },
  // 'all' | '30d' | '7d' | 'today' — khoảng thời gian cộng dồn số suất.
  { key: 'top_dishes_window', kind: 'string', default: 'all' },
  // Danh sách menu_item_id chủ quán không muốn lộ trên bảng xếp hạng.
  { key: 'top_dishes_hidden_ids', kind: 'json', default: [] },
  // ── OTP đăng nhập bằng SĐT (2026-08-04) ──
  // Mặc định TẮT vì kênh gửi thật (ZNS/SMS) chưa đăng ký — sender hiện là mock ghi log,
  // bật lên khi chưa có kênh thật = khách không nhận được mã = không ai đặt được đơn.
  // Bật ở /admin (khu Đơn hàng online) sau khi cắm sender thật, hoặc để thử nghiệm.
  { key: 'otp_login_enabled', kind: 'bool', default: false },
  // ── Bản đồ (2026-08-07) — 2 công tắc RIÊNG cho 2 nơi, không phải một ──
  // Chủ quán yêu cầu tắt được "nếu lag ảnh hưởng hệ thống". Hai nơi có rủi ro hoàn toàn khác nhau
  // nên gộp thành một công tắc là buộc họ hi sinh cái không có vấn đề để cứu cái có:
  //  - `map_checkout_enabled`: map trong trang khách. Khách dùng 4G, đang ở bước dễ bỏ giỏ nhất →
  //    đây là cái đáng tắt trước khi mạng khu vực chậm.
  //  - `map_admin_enabled`: map tổng quan ở màn duyệt đơn. Đã nằm sau một nút bấm (không tải khi
  //    vào trang), nên gần như không có lý do phải tắt cùng lúc với cái trên.
  // Mặc định BẬT vì đây là tính năng vừa được đặt làm; tắt là hành động có chủ ý của chủ quán.
  { key: 'map_checkout_enabled', kind: 'bool', default: true },
  { key: 'map_admin_enabled', kind: 'bool', default: true },
] as const;

// Map key → giá trị đã parse. Dùng chung giữa SettingsService và SettingsController để
// không khai type trùng.
export type StoreSettingsMap = {
  online_ordering_enabled: boolean;
  online_ordering_off_mode: 'MANUAL' | 'UNTIL_TOMORROW';
  online_ordering_off_reason: string;
  online_ordering_off_until_ms: number | null;
  open_hours: Array<{ dow: 0 | 1 | 2 | 3 | 4 | 5 | 6; from: string; to: string }>;
  store_phone: string;
  store_address: string;
  store_facebook_url: string;
  store_instagram_url: string;
  store_zalo: string;
  store_lat: number | null;
  store_lng: number | null;
  /** Đọc từ DB nên có thể là dữ liệu rác — LUÔN chạy qua `normalizeShipFeeTiers()` trước khi dùng
   *  (cùng cách các key json khác được canh ở chỗ dùng, ví dụ `top_dishes_hidden_ids`). */
  ship_fee_tiers: ShipFeeTier[];
  distance_factor: number;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  escalate_sms_after_s: number;
  closed_banner_text: string;
  closed_submit_confirm_text: string;
  notify_sms_recipients: string[];
  notify_email_recipients: string[];
  eta_pickup_min: number;
  eta_pickup_max: number;
  eta_delivery_min: number;
  eta_delivery_max: number;
  top_dishes_enabled: boolean;
  top_dishes_limit: number;
  top_dishes_window: string;
  top_dishes_hidden_ids: string[];
  otp_login_enabled: boolean;
  map_checkout_enabled: boolean;
  map_admin_enabled: boolean;
};

export const SETTINGS_DEFAULTS_MAP: StoreSettingsMap = Object.fromEntries(
  SETTINGS_DEFAULTS.map((d) => [d.key, d.default]),
) as unknown as StoreSettingsMap;

export const SETTINGS_KIND_BY_KEY: Record<string, SettingKind> = Object.fromEntries(
  SETTINGS_DEFAULTS.map((d) => [d.key, d.kind]),
);

// Nguồn: docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md §4.1 (dòng ~230-260).
// Đủ 20 key + kiểu parse của bảng `store_settings` (key-value, cột `value` luôn là text —
// xem entity `store-settings.entity.ts`). SettingsService (plan 08-05) đọc bảng này để biết
// cách parse `value` theo `kind` và giá trị fallback khi DB chưa có row (quán mới cài).
//
// Module thuần: không import gì từ @nestjs/* hay typeorm.

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
  // null = chưa cấu hình toạ độ quán → chưa tính được distance_km (Haversine cần gốc thật).
  { key: 'store_lat', kind: 'json', default: null },
  { key: 'store_lng', kind: 'json', default: null },
  { key: 'free_ship_km', kind: 'int', default: 10 },
  { key: 'distance_factor', kind: 'float', default: 1.3 },
  { key: 'pickup_enabled', kind: 'bool', default: true },
  { key: 'delivery_enabled', kind: 'bool', default: true },
  { key: 'escalate_sms_after_s', kind: 'int', default: 90 },
  // M2.D-60 ghi đè M2.D-36: 1800s (30 phút), KHÔNG phải 300s. docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md
  // dòng ~469 (pseudo-code) còn ghi 300s — đó là STALE, không implement theo dòng đó.
  { key: 'escalate_autooff_after_s', kind: 'int', default: 1800 },
  { key: 'notify_sms_recipients', kind: 'json', default: [] },
  { key: 'notify_email_recipients', kind: 'json', default: [] },
  { key: 'eta_pickup_min', kind: 'int', default: 15 },
  { key: 'eta_pickup_max', kind: 'int', default: 25 },
  { key: 'eta_delivery_min', kind: 'int', default: 30 },
  { key: 'eta_delivery_max', kind: 'int', default: 45 },
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
  store_lat: number | null;
  store_lng: number | null;
  free_ship_km: number;
  distance_factor: number;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  escalate_sms_after_s: number;
  escalate_autooff_after_s: number;
  notify_sms_recipients: string[];
  notify_email_recipients: string[];
  eta_pickup_min: number;
  eta_pickup_max: number;
  eta_delivery_min: number;
  eta_delivery_max: number;
};

export const SETTINGS_DEFAULTS_MAP: StoreSettingsMap = Object.fromEntries(
  SETTINGS_DEFAULTS.map((d) => [d.key, d.default]),
) as unknown as StoreSettingsMap;

export const SETTINGS_KIND_BY_KEY: Record<string, SettingKind> = Object.fromEntries(
  SETTINGS_DEFAULTS.map((d) => [d.key, d.kind]),
);

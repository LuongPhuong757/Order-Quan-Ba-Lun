import { describe, expect, it } from 'vitest';
import { PublicStoreStatus } from '@order/schemas';
import { SETTINGS_DEFAULTS_MAP } from '../settings/settings.defaults.js';

/**
 * Khoá hình dạng response của `GET /api/public/store` — cùng vai trò với
 * `public-menu-shape.test.ts` và `public-top-dishes-shape.test.ts`.
 *
 * VÌ SAO THÊM (2026-08-11): docblock của `public-store.controller.ts` viết rõ "thêm field vào
 * `PublicStoreStatus` mà quên payload (hoặc ngược lại) = **500 ngay**" — vì payload chạy qua
 * `.strict().parse()`. Nhưng KHÔNG có test nào canh cặp đó, trong khi 2 endpoint công khai kia
 * đều có. Endpoint này lại là request ĐẦU TIÊN trang khách gọi: nó 500 thì khách không mở được
 * menu, không phải "một khối hiển thị sai".
 *
 * Không dựng Nest module ở đây (controller chỉ ghép field từ `SettingsService`, không có nhánh
 * logic nào) — thứ cần canh là HỢP ĐỒNG giữa 3 file: schema, danh sách settings, và payload.
 */

/** Dựng payload đúng như controller dựng, từ defaults. Sửa controller mà quên chỗ này thì test
 *  dưới đỏ ở phép so key, chứ không phải chờ production 500. */
const payloadFromSettings = (s: typeof SETTINGS_DEFAULTS_MAP): PublicStoreStatus => ({
  ordering_enabled: s.online_ordering_enabled,
  off_reason: s.online_ordering_off_reason,
  store_phone: s.store_phone,
  store_address: s.store_address,
  store_facebook_url: s.store_facebook_url,
  store_instagram_url: s.store_instagram_url,
  store_zalo: s.store_zalo,
  open_hours: s.open_hours,
  is_open_now: true,
  blocking_reason: null,
  // Mốc cố định thay vì Date.now(): test shape canh HỢP ĐỒNG, không canh đồng hồ.
  server_now_ms: 1_800_000_000_000,
  closed_banner_text: s.closed_banner_text,
  closed_submit_confirm_text: s.closed_submit_confirm_text,
  pickup_enabled: s.pickup_enabled,
  delivery_enabled: s.delivery_enabled,
  otp_required: s.otp_login_enabled,
  ship_fee_tiers: [],
  distance_factor: s.distance_factor,
  map_checkout_enabled: s.map_checkout_enabled,
  province_lock_enabled: s.province_lock_enabled,
  eta: {
    pickup: { min: s.eta_pickup_min, max: s.eta_pickup_max },
    delivery: { min: s.eta_delivery_min, max: s.eta_delivery_max },
  },
});

describe('GET /api/public/store — hình dạng payload', () => {
  it('payload dựng từ settings mặc định qua được strict().parse()', () => {
    expect(() => PublicStoreStatus.strict().parse(payloadFromSettings(SETTINGS_DEFAULTS_MAP))).not.toThrow();
  });

  it('field nội bộ lọt vào → strict() chặn (đây là hàng rào chống leak toạ độ quán)', () => {
    const leaked = { ...payloadFromSettings(SETTINGS_DEFAULTS_MAP), store_lat: 21.18, store_lng: 106.07 };
    expect(() => PublicStoreStatus.strict().parse(leaked)).toThrow();
  });

  it('thiếu một field schema đòi → parse throw, không im lặng trả thiếu', () => {
    const { map_checkout_enabled: _omit, ...missing } = payloadFromSettings(SETTINGS_DEFAULTS_MAP);
    expect(() => PublicStoreStatus.strict().parse(missing)).toThrow();
  });
});

/**
 * Khoá tỉnh (2026-08-11) — cờ hiển thị cho ô "Tỉnh / Thành phố" ở trang khách.
 *
 * Mặc định phải là TẮT, và đây là thứ đáng canh bằng test chứ không chỉ bằng comment: đảo mặc
 * định thành `true` là âm thầm THU HẸP vùng khách đặt được ngay ở lần deploy kế tiếp — không lỗi,
 * không cảnh báo, chỉ là khách Hà Nội không điền nổi địa chỉ nữa và không ai biết vì sao.
 */
describe('province_lock_enabled', () => {
  it('mặc định TẮT — mở khoá phải là hành động có chủ đích của chủ quán ở /admin', () => {
    expect(SETTINGS_DEFAULTS_MAP.province_lock_enabled).toBe(false);
  });

  it('là boolean trong schema công khai (trang khách đọc thẳng cờ này)', () => {
    const parsed = PublicStoreStatus.strict().parse({
      ...payloadFromSettings(SETTINGS_DEFAULTS_MAP),
      province_lock_enabled: true,
    });
    expect(parsed.province_lock_enabled).toBe(true);
  });
});

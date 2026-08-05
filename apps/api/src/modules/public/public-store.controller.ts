import { Controller, Get, Header } from '@nestjs/common';
import { apiOk, type ApiOk } from '@order/utils';
import { PublicStoreStatus } from '@order/schemas';
import { SettingsService } from '../settings/settings.service.js';

/**
 * GET /api/public/store — trang khách gọi đầu tiên để biết quán có nhận đơn không.
 *
 * `ordering_enabled`/`is_open_now`/`blocking_reason` PHẢI lấy từ
 * `SettingsService.getOrderingStatus()` — ĐƯỜNG DUY NHẤT để biết trạng thái công tắc
 * (D-17, T-08-... xem `store-status.ts`). TUYỆT ĐỐI không đọc thẳng cột công tắc thô của
 * bảng settings: cột đó có thể vẫn ghi giá trị tắt trong khi thực tế đã tự-ON qua nửa đêm
 * (mode `UNTIL_TOMORROW`) — `getOrderingStatus()` tính lại lúc đọc, không cần cron.
 *
 * Whitelist thủ công (**17 field** — phase 9 thêm 2 câu chữ lúc Đóng cửa theo D-11/D-14,
 * 2026-08-04 thêm 4 field footer: địa chỉ + Facebook + Instagram + Zalo, xem
 * payload bên dưới) + `.strict().parse()` trước khi trả — nếu ai đó
 * sau này spread thêm field nội bộ (toạ độ quán, cấu hình leo thang SMS/email...) thì test/dev
 * throw ngay thay vì âm thầm leak dữ liệu quán ra production (T-08-34).
 * ⚠ Thêm field vào `PublicStoreStatus` mà quên payload dưới đây (hoặc ngược lại) = **500 ngay**.
 *
 * `Cache-Control: no-store` bắt buộc: từ phase 9, `ordering_enabled === false` không còn chặn
 * đặt đơn (D-11) nên đây không còn là chuyện "mất đơn" nữa — nhưng vẫn giữ `no-store` vì câu chữ
 * chủ quán vừa sửa phải ăn ngay, không đợi cache hết hạn (D-14).
 *
 * Không `@Throttle` riêng — throttler `default` global 600 req/phút/IP (phase 7) đã áp.
 */
@Controller('api/public')
export class PublicStoreController {
  constructor(private readonly settings: SettingsService) {}

  @Get('store')
  @Header('Cache-Control', 'no-store')
  async getStore(): Promise<ApiOk<PublicStoreStatus>> {
    const settings = await this.settings.readAll();
    const status = await this.settings.getOrderingStatus(Date.now());

    const payload: PublicStoreStatus = {
      ordering_enabled: status.enabled,
      off_reason: settings.online_ordering_off_reason,
      store_phone: settings.store_phone,
      store_address: settings.store_address,
      store_facebook_url: settings.store_facebook_url,
      store_instagram_url: settings.store_instagram_url,
      store_zalo: settings.store_zalo,
      open_hours: settings.open_hours,
      is_open_now: status.is_open_now,
      blocking_reason: status.blocking_reason,
      closed_banner_text: settings.closed_banner_text,
      closed_submit_confirm_text: settings.closed_submit_confirm_text,
      pickup_enabled: settings.pickup_enabled,
      delivery_enabled: settings.delivery_enabled,
      // OTP đăng nhập (2026-08-04) — UI hint cho apps/shop; chốt chặn thật ở submit/lookup.
      otp_required: settings.otp_login_enabled,
      free_ship_km: settings.free_ship_km,
      distance_factor: settings.distance_factor,
      eta: {
        pickup: { min: settings.eta_pickup_min, max: settings.eta_pickup_max },
        delivery: { min: settings.eta_delivery_min, max: settings.eta_delivery_max },
      },
    };

    return apiOk(PublicStoreStatus.strict().parse(payload));
  }
}

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
 * Whitelist thủ công (11 field) + `.strict().parse()` trước khi trả — nếu ai đó sau này
 * spread thêm field nội bộ (toạ độ quán, cấu hình leo thang SMS/email...) thì test/dev
 * throw ngay thay vì âm thầm leak dữ liệu quán ra production (T-08-34).
 *
 * `Cache-Control: no-store` bắt buộc: khoảng cách giữa "chủ quán tắt" và "khách bị chặn"
 * phải bằng 0, mà trình duyệt/proxy cache vài chục giây là đủ để mất một đơn (T-08-36).
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
      open_hours: settings.open_hours,
      is_open_now: status.is_open_now,
      blocking_reason: status.blocking_reason,
      pickup_enabled: settings.pickup_enabled,
      delivery_enabled: settings.delivery_enabled,
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

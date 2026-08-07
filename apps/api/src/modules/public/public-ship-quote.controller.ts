import { BadRequestException, Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { apiOk, type ApiOk } from '@order/utils';
import { PublicShipQuote, PublicShipQuoteInput } from '@order/schemas';
import { SettingsService } from '../settings/settings.service.js';
import { estimatedRoadDistanceKm, haversineKm } from './haversine.js';
import { computeShipFee } from './ship-fee.js';

/**
 * `POST /api/public/ship-quote` — khách chia sẻ vị trí ở bước checkout thì thấy ngay
 * "≈ X km · phí tạm tính Y" thay vì một câu hẹn (2026-08-06).
 *
 * Vì sao cần: trước đó trang checkout luôn hiện đúng một câu "trong N km miễn phí, xa hơn có phụ
 * phí — phí cuối do quán xác nhận khi gọi lại". Khách ở xa chốt đơn mà không biết mình sẽ phải trả
 * thêm bao nhiêu; con số thật chỉ tới ở cú điện thoại xác nhận, và đó là lúc đơn bị huỷ.
 *
 * 3 ranh giới:
 *  1. **Toạ độ quán không ra khỏi đây.** Response chỉ có km + tiền + bán kính miễn phí. Đưa
 *     `store_lat/lng` cho FE tự tính là phá ranh giới đã chốt ở `public-store.ts` và mở đường cho
 *     FE/BE tính lệch nhau.
 *  2. **Không ghi gì.** Đây là phép tính thuần trên 2 con số khách gửi — không đơn, không log toạ
 *     độ, không rate-limit theo SĐT (chưa có SĐT nào ở bước này).
 *  3. **`null` chứ không phải `0`** khi chưa cấu hình được (xem `computeShipFee`): số 0 nói với
 *     khách là "miễn phí", một lời hứa quán không đưa ra.
 *
 * `@Throttle` 30/phút/IP: lỏng hơn `POST orders` (10) vì khách bấm "Lấy lại vị trí" vài lần là
 * chuyện bình thường, nhưng vẫn chặn được vòng lặp dò toạ độ để tìm ra vị trí quán.
 */
@Controller('api/public')
export class PublicShipQuoteController {
  constructor(private readonly settings: SettingsService) {}

  @Post('ship-quote')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async quote(@Body() body: unknown): Promise<ApiOk<PublicShipQuote>> {
    const parsed = PublicShipQuoteInput.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Toạ độ không hợp lệ' });
    }

    const s = await this.settings.readAll();

    // Quán chưa cấu hình toạ độ → không có gốc để đo. Trả null cả 2 field và để FE giữ nguyên câu
    // hẹn cũ; đoán bừa một con số ở đây là con số sai ở mọi đơn.
    const distance_km =
      s.store_lat === null || s.store_lng === null
        ? null
        : estimatedRoadDistanceKm(
            haversineKm(parsed.data.lat, parsed.data.lng, s.store_lat, s.store_lng),
            s.distance_factor,
          );

    const payload: PublicShipQuote = {
      distance_km,
      ship_fee: computeShipFee({
        distanceKm: distance_km,
        freeShipKm: s.free_ship_km,
        perKm: s.ship_fee_per_km,
      }),
      free_ship_km: s.free_ship_km,
    };

    return apiOk(PublicShipQuote.strict().parse(payload));
  }
}

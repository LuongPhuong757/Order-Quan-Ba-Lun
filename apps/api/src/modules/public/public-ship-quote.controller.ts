import { BadRequestException, Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { apiOk, type ApiOk } from '@order/utils';
import {
  PublicShipQuote,
  PublicShipQuoteInput,
  computeShipFee,
  nextShipTier,
  normalizeShipFeeTiers,
} from '@order/schemas';
import { SettingsService } from '../settings/settings.service.js';
import { estimatedRoadDistanceKm, haversineKm } from './haversine.js';
import { isBeyondDeliveryRadius } from './delivery-radius.js';

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

    // Bậc phí phụ thuộc TIỀN MÓN của giỏ (2026-08-07) — cùng bảng bậc, cùng hàm với màn duyệt đơn.
    const tiers = normalizeShipFeeTiers(s.ship_fee_tiers);
    const { fee, tier } = computeShipFee({
      distanceKm: distance_km,
      subtotal: parsed.data.subtotal,
      tiers,
    });

    const payload: PublicShipQuote = {
      distance_km,
      ship_fee: fee,
      tier,
      // Bậc trên kế tiếp — trang khách dùng để nói "mua thêm 40.000đ nữa được miễn phí 7 km".
      next_tier: nextShipTier(tiers, parsed.data.subtotal),
      // Bán kính giao tối đa (2026-08-07). Trả cả con số VÀ kết luận: con số để trang khách viết
      // được câu "quán chỉ giao trong 5 km", kết luận `too_far` để nó không phải tự so sánh —
      // quyết định nghiệp vụ chỉ ra từ một nơi, xem `delivery-radius.ts`.
      max_delivery_km: s.max_delivery_km,
      too_far: isBeyondDeliveryRadius(distance_km, s.max_delivery_km),
    };

    return apiOk(PublicShipQuote.strict().parse(payload));
  }
}

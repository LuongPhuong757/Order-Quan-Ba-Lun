// GET + PUT /admin/settings — chỉ admin gọi được (AdminGuard class-level).
//
// Prefix route KHÔNG có `/api` (lệch chữ spec §5.2 vốn ghi `/api/admin/settings`), khớp
// convention thật của repo (`admin/users`, `admin/audit`) và khớp apps/web/src/lib/api.ts
// (baseURL là host, path gọi thẳng `/admin/...`). Xem entry OVERRIDE-DEBT.md (plan 08-13).
import { BadRequestException, Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { normalizeShipFeeTiers } from '@order/schemas';
import type { Request } from 'express';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { SettingsService } from './settings.service.js';
import { collapseToDefaultExceptions, endOfTodayIctMs, expandToWeek } from '../public/store-status.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DOW_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;

class OpenHoursDefaultDto {
  @IsString() @Matches(HHMM)
  from!: string;

  @IsString() @Matches(HHMM)
  to!: string;
}

class OpenHoursExceptionDto {
  @IsIn(DOW_VALUES)
  dow!: (typeof DOW_VALUES)[number];

  @IsString() @Matches(HHMM)
  from!: string;

  @IsString() @Matches(HHMM)
  to!: string;
}

class OpenHoursInputDto {
  @ValidateNested()
  @Type(() => OpenHoursDefaultDto)
  default!: OpenHoursDefaultDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpenHoursExceptionDto)
  exceptions!: OpenHoursExceptionDto[];
}

class UpdateSettingsDto {
  @IsOptional() online_ordering_enabled?: boolean;
  @IsOptional() @IsIn(['MANUAL', 'UNTIL_TOMORROW']) online_ordering_off_mode?: 'MANUAL' | 'UNTIL_TOMORROW';
  @IsOptional() @IsString() @MaxLength(255) online_ordering_off_reason?: string;
  // D-14 — CỐ Ý KHÔNG có `@MaxLength`: chủ quán tự soạn câu hiện cho khách, độ dài không giới hạn.
  // Cột `store_settings.value` là `text` nên chịu được. Thêm `@MaxLength` ở đây là âm thầm cắt chuỗi
  // của chủ quán ở một tầng họ không nhìn thấy.
  @IsOptional() @IsString() closed_banner_text?: string;
  @IsOptional() @IsString() closed_submit_confirm_text?: string;
  @IsOptional() @IsString() @MaxLength(16) store_phone?: string;
  // Footer trang khách — rỗng = ẩn dòng/nút tương ứng, không phải lỗi.
  @IsOptional() @IsString() @MaxLength(255) store_address?: string;
  @IsOptional() @IsString() @MaxLength(255) store_facebook_url?: string;
  @IsOptional() @IsString() @MaxLength(255) store_instagram_url?: string;
  @IsOptional() @IsString() @MaxLength(255) store_zalo?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) store_lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) store_lng?: number;
  /**
   * Bảng phí giao theo bậc giá trị đơn (2026-08-07). Hình dạng từng dòng do zod `ShipFeeTier`
   * kiểm (trần 100 km / 200.000đ mỗi km — cao hơn mọi bảng giá thật, nhưng chặn được cú gõ nhầm
   * thừa một số 0 vốn sẽ hiện thẳng thành phí trên trang khách), nên ở đây chỉ nhận mảng thô rồi
   * validate ở `update()`. Gửi `[]` = tắt tính năng, quay về hành vi không tự tính phí ship.
   */
  @IsOptional() @IsArray() ship_fee_tiers?: unknown[];
  @IsOptional() @IsNumber() @Min(1) @Max(3) distance_factor?: number;
  /**
   * Bán kính giao tối đa (km) — `0` = tắt giới hạn. Trần 100 km cùng cỡ với trần `free_km` của
   * `ShipFeeTier`: cao hơn mọi bán kính giao thật, nhưng chặn được cú gõ nhầm thừa một số 0 (vốn
   * biến "5 km" thành "50 km" và mở toang cho đơn quán không giao nổi).
   * Không `@IsInt`: quán đặt 2.5 km là hợp lý.
   */
  @IsOptional() @IsNumber() @Min(0) @Max(100) max_delivery_km?: number;
  @IsOptional() pickup_enabled?: boolean;
  @IsOptional() delivery_enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(240) eta_pickup_min?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) eta_pickup_max?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) eta_delivery_min?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) eta_delivery_max?: number;
  @IsOptional() top_dishes_enabled?: boolean;
  // OTP đăng nhập bằng SĐT (2026-08-04) — xem settings.defaults.ts về vì sao mặc định tắt.
  @IsOptional() otp_login_enabled?: boolean;
  // Bản đồ (2026-08-07) — 2 công tắc riêng, xem settings.defaults.ts về vì sao không gộp làm một.
  @IsOptional() map_checkout_enabled?: boolean;
  @IsOptional() map_admin_enabled?: boolean;
  // Khoá ô tỉnh của khách về Bắc Ninh (2026-08-11) — xem settings.defaults.ts.
  @IsOptional() province_lock_enabled?: boolean;
  @IsOptional() @IsInt() @Min(3) @Max(10) top_dishes_limit?: number;
  @IsOptional() @IsIn(['all', '30d', '7d', 'today']) top_dishes_window?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) top_dishes_hidden_ids?: string[];
  @IsOptional()
  @ValidateNested()
  @Type(() => OpenHoursInputDto)
  open_hours_input?: OpenHoursInputDto;
}

@Controller('admin/settings')
@UseGuards(AdminGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get() {
    return this.buildResponse();
  }

  @Put()
  async update(@Body() dto: UpdateSettingsDto, @Req() req: Request) {
    const patch: Record<string, unknown> = {};

    if (dto.open_hours_input) {
      patch.open_hours = expandToWeek(dto.open_hours_input);
    }
    if (dto.online_ordering_enabled !== undefined) {
      patch.online_ordering_enabled = dto.online_ordering_enabled;
      if (dto.online_ordering_enabled === false) {
        // Mốc "OFF đến hết hôm nay" do BE tự tính (M2.D-28) — FE KHÔNG được gửi mốc này.
        if (dto.online_ordering_off_mode === 'UNTIL_TOMORROW') {
          patch.online_ordering_off_until_ms = endOfTodayIctMs(Date.now());
        } else if (dto.online_ordering_off_mode === 'MANUAL') {
          patch.online_ordering_off_until_ms = null;
        }
      } else {
        // Bật lại thì không còn lý do tạm ngưng treo lại.
        patch.online_ordering_off_reason = '';
        patch.online_ordering_off_until_ms = null;
      }
    }
    if (dto.online_ordering_off_mode !== undefined) {
      patch.online_ordering_off_mode = dto.online_ordering_off_mode;
    }
    if (dto.online_ordering_off_reason !== undefined) {
      patch.online_ordering_off_reason = dto.online_ordering_off_reason;
    }

    /**
     * Bảng bậc phí giao (2026-08-07) — chuẩn hoá + 1 luật CHẶN duy nhất: bậc đầu phải bắt đầu từ 0.
     *
     * Thiếu bậc 0 thì đơn nhỏ nhất rơi vào khoảng trống không luật nào phủ, và hệ thống lặng lẽ
     * KHÔNG tính phí ship cho đúng nhóm đơn quán cần thu nhất — một lỗi cấu hình không nhìn ra
     * được từ giao diện, chỉ lộ ra sau vài chục đơn mất tiền. Chặn thẳng ở đây, còn hơn để nó
     * thành mặc định im lặng.
     *
     * `normalizeShipFeeTiers` đã tự sắp xếp, bỏ dòng hỏng, bỏ mốc trùng và cắt còn tối đa 6 dòng —
     * FE gửi sao cũng được, thứ ghi vào DB luôn là bảng sạch.
     */
    if (dto.ship_fee_tiers !== undefined) {
      const tiers = normalizeShipFeeTiers(dto.ship_fee_tiers);
      if (tiers.length > 0 && tiers[0].min_subtotal !== 0) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Bậc phí ship đầu tiên phải áp dụng từ 0đ, nếu không đơn nhỏ sẽ không có phí nào.',
        });
      }
      patch.ship_fee_tiers = tiers;
    }
    // ⚠ Đây là chỗ THỨ HAI của round-trip 3 chỗ. `SettingsService.updateMany()` có
    // `if (!kind) continue`, nên một key thiếu ở `SETTINGS_DEFAULTS` hoặc thiếu trong mảng này sẽ bị
    // NUỐT LẶNG LẼ: admin bấm Lưu, nhận 200, và không gì được ghi. Thêm key mới thì phải sửa cả 3.
    for (const key of [
      'store_phone',
      'store_address',
      'store_facebook_url',
      'store_instagram_url',
      'store_zalo',
      'closed_banner_text',
      'closed_submit_confirm_text',
      'store_lat',
      'store_lng',
      'distance_factor',
      'max_delivery_km',
      'pickup_enabled',
      'delivery_enabled',
      'eta_pickup_min',
      'eta_pickup_max',
      'eta_delivery_min',
      'eta_delivery_max',
      'top_dishes_enabled',
      'top_dishes_limit',
      'top_dishes_window',
      'top_dishes_hidden_ids',
      'otp_login_enabled',
      'map_checkout_enabled',
      'map_admin_enabled',
      'province_lock_enabled',
    ] as const) {
      if (dto[key] !== undefined) patch[key] = dto[key];
    }

    const actor = { user_id: req.user!.sub, full_name: req.user!.full_name };
    await this.settings.updateMany(patch, actor);
    return this.buildResponse();
  }

  private async buildResponse() {
    const settings = await this.settings.readAll();
    const openHoursConfigured = settings.open_hours.length > 0;
    const open_hours_input = openHoursConfigured
      ? collapseToDefaultExceptions(settings.open_hours)
      : { default: { from: '10:00', to: '22:00' }, exceptions: [] };
    const ordering_status = await this.settings.getOrderingStatus(Date.now());
    return {
      data: {
        settings,
        open_hours_input,
        open_hours_configured: openHoursConfigured,
        ordering_status,
      },
    };
  }
}

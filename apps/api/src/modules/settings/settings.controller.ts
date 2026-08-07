// GET + PUT /admin/settings — chỉ admin gọi được (AdminGuard class-level).
//
// Prefix route KHÔNG có `/api` (lệch chữ spec §5.2 vốn ghi `/api/admin/settings`), khớp
// convention thật của repo (`admin/users`, `admin/audit`) và khớp apps/web/src/lib/api.ts
// (baseURL là host, path gọi thẳng `/admin/...`). Xem entry OVERRIDE-DEBT.md (plan 08-13).
import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
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
  @IsOptional() @IsInt() @Min(0) @Max(100) free_ship_km?: number;
  // Trần 200.000đ/km: cao hơn mọi bảng giá ship thật, nhưng vẫn chặn được cú gõ nhầm thừa số 0
  // (5.000 → 500.000) vốn sẽ hiện thẳng thành phí tạm tính trên trang khách.
  @IsOptional() @IsInt() @Min(0) @Max(200_000) ship_fee_per_km?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(3) distance_factor?: number;
  @IsOptional() pickup_enabled?: boolean;
  @IsOptional() delivery_enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(240) eta_pickup_min?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) eta_pickup_max?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) eta_delivery_min?: number;
  @IsOptional() @IsInt() @Min(0) @Max(240) eta_delivery_max?: number;
  @IsOptional() top_dishes_enabled?: boolean;
  // OTP đăng nhập bằng SĐT (2026-08-04) — xem settings.defaults.ts về vì sao mặc định tắt.
  @IsOptional() otp_login_enabled?: boolean;
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
      'free_ship_km',
      'ship_fee_per_km',
      'distance_factor',
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

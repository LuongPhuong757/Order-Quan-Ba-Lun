// SettingsService — tầng đọc/ghi duy nhất của bảng `store_settings` (key-value).
// `getOrderingStatus()` là ĐƯỜNG DUY NHẤT để biết "đang nhận đơn hay không" (M2.D-27) —
// cấm đọc thẳng cột `online_ordering_enabled` ở bất kỳ đâu khác, vì cột có thể ghi `false`
// trong khi thực tế đã tự-ON qua nửa đêm (D-17, xem evaluateOrderingStatus()).
//
// Không cache trong bộ nhớ: công tắc phải phản ánh ngay lần đọc kế tiếp — khoảng cách giữa
// "chủ quán tắt" và "khách bị chặn" phải bằng 0.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreSetting } from './entities/store-settings.entity.js';
import {
  SETTINGS_DEFAULTS_MAP,
  SETTINGS_KIND_BY_KEY,
  type SettingKind,
  type StoreSettingsMap,
} from './settings.defaults.js';
import { evaluateOrderingStatus, type OrderingStatus, type StoreOrderingSettings } from '../public/store-status.js';

type Actor = { user_id: string; full_name: string };

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(StoreSetting) private readonly repo: Repository<StoreSetting>,
  ) {}

  /** Đọc mọi row, parse theo `kind`, merge lên SETTINGS_DEFAULTS_MAP (key chưa có row → default).
   * DB trống vẫn chạy đúng — không cần seed script, row chỉ sinh khi admin ghi lần đầu. */
  async readAll(): Promise<StoreSettingsMap> {
    const rows = await this.repo.find();
    const result = { ...SETTINGS_DEFAULTS_MAP } as Record<string, unknown>;
    for (const row of rows) {
      const kind = SETTINGS_KIND_BY_KEY[row.key];
      if (!kind) continue; // key rác không thuộc SETTINGS_DEFAULTS — bỏ qua khi đọc
      try {
        result[row.key] = parseValue(row.value, kind);
      } catch (err) {
        // Một setting hỏng (vd JSON lỗi) không được làm sập trang menu công khai (T-08-24).
        this.logger.warn(`Không parse được setting "${row.key}", dùng giá trị mặc định: ${String(err)}`);
      }
    }
    return result as unknown as StoreSettingsMap;
  }

  /** Shape đúng những gì evaluateOrderingStatus() (hàm thuần) cần. */
  async readOrderingSettings(): Promise<StoreOrderingSettings> {
    const s = await this.readAll();
    return {
      online_ordering_enabled: s.online_ordering_enabled,
      online_ordering_off_mode: s.online_ordering_off_mode,
      online_ordering_off_reason: s.online_ordering_off_reason,
      online_ordering_off_until_ms: s.online_ordering_off_until_ms,
      open_hours: s.open_hours,
    };
  }

  /** Đường DUY NHẤT để suy ra "đang nhận đơn hay không" — mọi nơi khác gọi qua đây. */
  async getOrderingStatus(nowMs: number): Promise<OrderingStatus> {
    const s = await this.readOrderingSettings();
    return evaluateOrderingStatus(s, nowMs);
  }

  /** Upsert từng key có trong patch (save theo PK `key` — insert nếu chưa có row, update nếu đã có).
   * Bỏ qua key không thuộc SETTINGS_DEFAULTS (chống ghi key rác). */
  async updateMany(patch: Partial<StoreSettingsMap>, actor: Actor): Promise<StoreSettingsMap> {
    for (const [key, value] of Object.entries(patch)) {
      const kind = SETTINGS_KIND_BY_KEY[key];
      if (!kind) continue;
      const serialized = serializeValue(value, kind);
      await this.repo.save(
        this.repo.create({
          key,
          value: serialized,
          updated_by_user_id: actor.user_id,
          updated_by_full_name: actor.full_name,
        }),
      );
    }
    return this.readAll();
  }
}

function parseValue(raw: string, kind: SettingKind): unknown {
  switch (kind) {
    case 'bool':
      return raw === 'true';
    case 'int': {
      const n = parseInt(raw, 10);
      if (Number.isNaN(n)) throw new Error(`giá trị int không hợp lệ: ${raw}`);
      return n;
    }
    case 'float': {
      const n = parseFloat(raw);
      if (Number.isNaN(n)) throw new Error(`giá trị float không hợp lệ: ${raw}`);
      return n;
    }
    case 'json':
      return JSON.parse(raw);
    case 'string':
    default:
      return raw;
  }
}

function serializeValue(value: unknown, kind: SettingKind): string {
  switch (kind) {
    case 'bool':
      return value ? 'true' : 'false';
    case 'int':
    case 'float':
      return String(value);
    case 'json':
      return JSON.stringify(value);
    case 'string':
    default:
      return String(value);
  }
}

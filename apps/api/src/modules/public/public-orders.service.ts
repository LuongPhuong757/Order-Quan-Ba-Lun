// Cài `SubmitDeps` thật lên `DataSource`/`EntityManager`, bọc `submit()` trong 1 transaction
// có gap lock `FOR UPDATE` (RESEARCH Pattern 3, threat T-08-50 HIGH). Toàn bộ quyết định +
// build dữ liệu nằm ở `submit-order.ts` (Task 1, test được bằng fake-repository) — file này
// CHỈ có nhiệm vụ nối dây DB thật, không tự phát minh lại logic guard/giá.
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { OnlineOrderSubmit } from '@order/schemas';
import { PublicOrderStatus } from '@order/schemas';
import { SettingsService } from '../settings/settings.service.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { PhoneBlacklist } from '../settings/entities/phone-blacklist.entity.js';
import { OnlineOrderRequest } from './entities/online-order-request.entity.js';
import { hashIp, resolveIpHashSalt } from './ip-hash.js';
import { submitOrder, type MenuItemLookup, type SubmitDeps } from './submit-order.js';

@Injectable()
export class PublicOrdersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(OnlineOrderRequest) private readonly orderRepo: Repository<OnlineOrderRequest>,
    private readonly settingsSvc: SettingsService,
  ) {}

  /**
   * Bọc TOÀN BỘ validate + insert trong 1 transaction — gap lock `hasOpenOrderForPhoneLocked`
   * (`FOR UPDATE`) chỉ có hiệu lực chống race khi nằm CÙNG transaction với insert phía sau.
   */
  async submit(
    input: OnlineOrderSubmit,
    ctx: { ip: string; userAgent: string; nowMs: number },
  ): Promise<{ order_token: string; distance_km: string | null }> {
    return this.ds.transaction((mgr) => submitOrder(this.makeDeps(mgr), input, ctx));
  }

  private makeDeps(mgr: EntityManager): SubmitDeps {
    return {
      getOrderingStatus: (nowMs) => this.settingsSvc.getOrderingStatus(nowMs),

      readSettings: async () => {
        const s = await this.settingsSvc.readAll();
        return {
          store_phone: s.store_phone,
          store_lat: s.store_lat,
          store_lng: s.store_lng,
          distance_factor: s.distance_factor,
          free_ship_km: s.free_ship_km,
          online_ordering_off_reason: s.online_ordering_off_reason,
          pickup_enabled: s.pickup_enabled,
          delivery_enabled: s.delivery_enabled,
        };
      },

      // M2.D-59 — điều kiện `expires_at` viết sẵn cho tính năng chặn tạm thời sau này; hiện
      // cột luôn NULL (chỉ thêm/xoá tay), nhưng logic đọc đã đúng ngay từ đầu.
      isPhoneBlacklisted: async (phone) => {
        const count = await mgr
          .getRepository(PhoneBlacklist)
          .createQueryBuilder('b')
          .where('b.phone = :phone', { phone })
          .andWhere('(b.expires_at IS NULL OR b.expires_at > NOW())')
          .getCount();
        return count > 0;
      },

      // D-18 — đếm trong DB, KHÔNG throttler in-memory, KHÔNG Redis.
      countRecentByPhone: async (phone, sinceMs) => {
        const rows: Array<{ cnt: string | number }> = await mgr.query(
          'SELECT COUNT(*) AS cnt FROM online_order_requests WHERE customer_phone = ? AND submitted_at >= ?',
          [phone, new Date(sinceMs)],
        );
        return Number(rows[0]?.cnt ?? 0);
      },

      // T-08-50 (HIGH) — gap lock: `SELECT ... FOR UPDATE` trên khoảng index
      // `idx_oor_phone_status` trong CÙNG transaction với insert bên dưới. KHÔNG thay bằng
      // `findOne` thường (mất lock), KHÔNG dùng `GET_LOCK()` hay bảng lock phụ.
      hasOpenOrderForPhoneLocked: async (phone) => {
        const rows: Array<{ id: string }> = await mgr.query(
          `SELECT id FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`,
          [phone],
        );
        return rows.length > 0;
      },

      findMenuItemsByIds: async (ids): Promise<MenuItemLookup[]> => {
        if (ids.length === 0) return [];
        return mgr.getRepository(MenuItem).find({
          where: { id: In(ids) },
          select: ['id', 'code', 'name', 'price', 'unit', 'is_active', 'is_out_of_stock'],
        });
      },

      insertRequest: async (row) => {
        await mgr.getRepository(OnlineOrderRequest).insert({
          ...row,
          // decimal(10,7) → mysql2 nhận string; entity khai `string | null` (xem entity docblock).
          customer_lat: row.customer_lat !== null ? String(row.customer_lat) : null,
          customer_lng: row.customer_lng !== null ? String(row.customer_lng) : null,
        });
      },

      hashIpFn: (ip) => hashIp(ip, resolveIpHashSalt()),
    };
  }

  /**
   * Màn xác nhận tối giản sau submit (phase 8). Whitelist tường minh + `.strict().parse()` —
   * TUYỆT ĐỐI không trả `ip_hash`/`user_agent`/`customer_*`/`reviewed_by_*`/trạng thái từng
   * món (M2.D-23, điều kiện G-1). Nội dung đầy đủ (%, 5 mốc) là phase 9.
   */
  async getByToken(token: string): Promise<PublicOrderStatus> {
    const row = await this.orderRepo.findOne({ where: { order_token: token } });
    if (!row) {
      throw new NotFoundException({ code: 'ORDER_TOKEN_NOT_FOUND', message: 'Không tìm thấy đơn này.' });
    }
    const settings = await this.settingsSvc.readAll();
    const shaped = {
      order_token: row.order_token,
      status: row.status as PublicOrderStatus['status'],
      fulfillment_type: row.fulfillment_type as PublicOrderStatus['fulfillment_type'],
      items: row.items_snapshot.map((it) => ({ name: it.name, qty: it.qty, unit_price: it.unit_price })),
      subtotal: row.subtotal,
      submitted_at_ms: row.submitted_at,
      store_phone: settings.store_phone,
      reject_reason: row.reject_reason,
    };
    return PublicOrderStatus.strict().parse(shaped);
  }
}

import { Controller, Get, Header } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { apiOk, type ApiOk } from '@order/utils';
import { PublicTopDishes } from '@order/schemas';
import { Order } from '../orders/entities/order.entity.js';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { normalizeWindow, toPublicTopDish, windowStartMs, type TopDishRawRow } from './public-top-dishes.mapper.js';

// Trùng chữ với PAID_SQL của orders.service.ts (module-private bên đó) — "đơn đã
// thanh toán" phải là CÙNG MỘT định nghĩa với báo cáo admin, nếu không số trang khách
// và số HistoryPage lệch nhau và chủ quán sẽ nghĩ một trong hai nói dối.
const PAID_SQL = 'o.closed_at IS NOT NULL AND o.is_paid = 1';

/**
 * GET /api/public/top-dishes — bảng xếp hạng món trên trang khách (2026-08-04).
 *
 * Số `qty` là SUM suất SERVED THẬT của đơn đã thanh toán, CẢ POS lẫn online — cùng
 * gốc dữ liệu với `top_items` trong `OrdersService.stats()`, nhưng GROUP BY
 * `menu_item_id` (không phải name-snapshot như bên stats) để join được ảnh + tên
 * hiện hành từ `menu_items`. Món đã ẩn khỏi menu (`is_active = 0`) hoặc chủ quán
 * giấu tay (`top_dishes_hidden_ids`) không lộ ra đây.
 *
 * KHÔNG có cơ chế cộng số ảo — DESIGN.md apps/shop: badge/số "bán chạy" phải suy ra
 * từ dữ liệu bán thật. Cảm giác "realtime" đến từ FE (count-up + poll), không phải
 * từ việc bơm số.
 *
 * Whitelist qua `public-top-dishes.mapper.ts` + `.strict().parse()` (T-08-33) —
 * không trả entity thô. `Cache-Control: no-store`: admin đổi setting/đơn mới chốt
 * phải ăn ngay ở lần poll kế tiếp. Không `@Throttle` riêng — global 600 req/phút/IP.
 */
@Controller('api/public')
export class PublicTopDishesController {
  constructor(
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    private readonly settings: SettingsService,
  ) {}

  @Get('top-dishes')
  @Header('Cache-Control', 'no-store')
  async getTopDishes(): Promise<ApiOk<PublicTopDishes>> {
    const s = await this.settings.readAll();
    const window = normalizeWindow(s.top_dishes_window);

    // Tắt = không lộ gì và không tốn query GROUP BY nào.
    if (!s.top_dishes_enabled) {
      return apiOk(PublicTopDishes.strict().parse({ enabled: false, window, items: [] }));
    }

    // Kẹp cứng kể cả khi DB bị ghi tay giá trị lạ — LIMIT âm/0/khổng lồ đều vô nghĩa.
    const limit = Math.min(10, Math.max(3, s.top_dishes_limit));
    const hidden = (Array.isArray(s.top_dishes_hidden_ids) ? s.top_dishes_hidden_ids : []).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    const startMs = windowStartMs(window, Date.now());

    const qb = this.orderRepo
      .createQueryBuilder('o')
      .innerJoin('o.items', 'i')
      // INNER JOIN cố ý: món đã xoá mềm/đổi id (menu_item_id NULL hoặc không khớp)
      // không có tên + ảnh hiện hành để hiển thị → không vào bảng xếp hạng.
      .innerJoin(MenuItem, 'm', 'm.id = i.menu_item_id')
      .select('m.id', 'id')
      .addSelect('m.name', 'name')
      .addSelect('m.unit', 'unit')
      .addSelect('m.price', 'price')
      .addSelect('m.image_url', 'image_url')
      .addSelect('SUM(i.qty)', 'qty')
      .where(PAID_SQL)
      .andWhere("i.state = 'SERVED'")
      // Ghi chú ("lấy bát"...) không phải hàng bán — cùng lý do với stats().
      .andWhere('i.is_note = 0')
      .andWhere('m.is_active = 1')
      // Món ẩn khỏi web online không được lộ trên bảng xếp hạng — bấm vào nó
      // sẽ về menu tìm không ra, và lộ tên món quán không bán online.
      // Ẩn được ở 2 cấp: cờ lẻ trên món HOẶC ẩn cả nhóm (LEFT JOIN vì `group` là code
      // string không FK — món mồ côi nhóm thì g.* NULL, coi như nhóm không ẩn).
      .andWhere('m.is_online_hidden = 0')
      .leftJoin(MenuGroup, 'g', 'g.code = m.group')
      .andWhere('COALESCE(g.is_online_hidden, 0) = 0')
      .groupBy('m.id')
      .addGroupBy('m.name')
      .addGroupBy('m.unit')
      .addGroupBy('m.price')
      .addGroupBy('m.image_url')
      .orderBy('qty', 'DESC')
      // Tie-break theo tên để 2 món bằng suất không đổi chỗ nhau giữa 2 lần poll.
      .addOrderBy('m.name', 'ASC')
      .limit(limit);

    if (startMs !== null) qb.andWhere('o.closed_at >= :start', { start: new Date(startMs) });
    if (hidden.length > 0) qb.andWhere('m.id NOT IN (:...hidden)', { hidden });

    const rows = await qb.getRawMany<TopDishRawRow>();

    return apiOk(
      PublicTopDishes.strict().parse({
        enabled: true,
        window,
        items: rows.map(toPublicTopDish),
      }),
    );
  }
}

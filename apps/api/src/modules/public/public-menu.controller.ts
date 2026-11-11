import { Controller, Get, Header } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { apiOk, type ApiOk } from '@order/utils';
import type { PublicMenuGroup } from '@order/schemas';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { MenuCombo } from '../menu/entities/menu-combo.entity.js';
import { MenuFeaturedItem } from '../menu/entities/menu-featured-item.entity.js';
import { toPublicMenuGroup, toPublicMenuItem } from './public-menu.mapper.js';

type PublicMenuResponse = { groups: PublicMenuGroup[] };
type PublicCombo = { id: string; name: string; emoji: string | null; item_ids: string[] };

/**
 * GET /api/public/menu — trang khách tải 1 lần toàn bộ menu (D-03: không phân trang, không
 * tham số `q`; lọc nhóm và tìm kiếm đều client-side vì menu 1 quán lẩu chỉ vài chục món).
 *
 * Whitelist 7 field/món qua `public-menu.mapper.ts` (T-08-33, criterion 5 phase 8) — controller
 * TUYỆT ĐỐI không tự trả entity thô.
 *
 * Món hết hàng (M2.D-31) VẪN có trong response — BE không lọc theo `is_out_of_stock`, FE làm
 * mờ. Nhóm không còn món nào bị bỏ (tránh tile chết); món có `group` không khớp nhóm active
 * nào được gom vào nhóm tổng hợp `other` để không bao giờ rơi mất món.
 *
 * `Cache-Control: no-store` — menu đổi giá/hết hàng phải hiện ngay lần vào trang kế tiếp.
 * Không `@Throttle` riêng — throttler `default` global 600 req/phút/IP đã áp.
 */
@Controller('api/public')
export class PublicMenuController {
  constructor(
    @InjectRepository(MenuItem) private readonly itemRepo: Repository<MenuItem>,
    @InjectRepository(MenuGroup) private readonly groupRepo: Repository<MenuGroup>,
    @InjectRepository(MenuCombo) private readonly comboRepo: Repository<MenuCombo>,
    @InjectRepository(MenuFeaturedItem) private readonly featuredRepo: Repository<MenuFeaturedItem>,
  ) {}

  /**
   * GET /api/public/menu-combos — combo gợi ý món chủ quán đang BẬT + danh sách "món đề xuất"
   * (2026-10-03), cho nhân vật ở thực đơn tại bàn mời món. id món là id thật, trang khách tra tên,
   * giá, còn hàng từ thực đơn nó đã tải — món bị ẩn/xoá không có trong thực đơn thì tự bị bỏ qua.
   * `no-store`: chủ quán sửa combo xong mở thực đơn thử ngay — bản trước để `max-age=60` và trang
   * khách cứ mời theo combo đã xoá (đo 2026-10-03). Truy vấn hai bảng nhỏ, không đáng cache.
   */
  @Get('menu-combos')
  @Header('Cache-Control', 'no-store')
  async getCombos(): Promise<ApiOk<{ combos: PublicCombo[]; featured: string[] }>> {
    const [rows, featured] = await Promise.all([
      this.comboRepo.find({ where: { is_active: true }, order: { sort_order: 'ASC', created_at: 'ASC' } }),
      this.featuredRepo.find({ order: { sort_order: 'ASC' } }),
    ]);
    return apiOk({
      combos: rows.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, item_ids: c.item_ids })),
      featured: featured.map((f) => f.menu_item_id),
    });
  }

  @Get('menu')
  @Header('Cache-Control', 'no-store')
  async getMenu(): Promise<ApiOk<PublicMenuResponse>> {
    const [groups, items] = await Promise.all([
      this.groupRepo.find({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      }),
      // `is_online_hidden` (2026-08-04): món chủ quán không bán online bị LOẠI HẲN khỏi
      // response — khác món hết hàng (vẫn trả, FE làm mờ). Khách không thấy thì không đặt
      // được; lớp chặn thứ hai nằm ở submit-order (MENU_ITEM_UNAVAILABLE).
      this.itemRepo.find({
        where: { is_active: true, is_online_hidden: false },
        order: { name: 'ASC' },
      }),
    ]);

    const itemsByGroupCode = new Map<string, MenuItem[]>();
    const activeGroupCodes = new Set(groups.map((g) => g.code));
    // Nhóm bị ẩn khỏi web online (2026-08-04): loại CẢ nhóm LẪN món của nó. Món trong nhóm
    // ẩn TUYỆT ĐỐI không được rơi vào nhánh orphan bên dưới — nếu rơi, chúng hồi sinh trong
    // nhóm tổng hợp "Khác" và việc ẩn nhóm thành vô nghĩa.
    const hiddenGroupCodes = new Set(groups.filter((g) => g.is_online_hidden).map((g) => g.code));
    const orphanItems: MenuItem[] = [];
    for (const item of items) {
      if (hiddenGroupCodes.has(item.group)) continue;
      if (!activeGroupCodes.has(item.group)) {
        orphanItems.push(item);
        continue;
      }
      const list = itemsByGroupCode.get(item.group) ?? [];
      list.push(item);
      itemsByGroupCode.set(item.group, list);
    }

    const result: PublicMenuGroup[] = [];
    for (const group of groups) {
      if (group.is_online_hidden) continue;
      const groupItems = itemsByGroupCode.get(group.code) ?? [];
      // Nhóm rỗng bị bỏ — tránh dải danh mục có tile chết (không có món nào để bấm vào).
      if (groupItems.length === 0) continue;
      result.push(toPublicMenuGroup(group, groupItems.map(toPublicMenuItem)));
    }

    // Món có group không khớp bất kỳ nhóm active nào → gom vào nhóm tổng hợp "other".
    // Không bao giờ được rơi mất món (menu thiếu món là lỗi khách thấy ngay).
    if (orphanItems.length > 0) {
      result.push(
        toPublicMenuGroup(
          { id: randomUUID(), code: 'other', name: 'Khác', icon: null },
          orphanItems.map(toPublicMenuItem),
        ),
      );
    }

    return apiOk<PublicMenuResponse>({ groups: result });
  }

  /**
   * GET /api/public/menu-book — thực đơn của trang QR GỌI MÓN TẠI BÀN (`menu.<domain>/thuc-don`)
   * và quyển menu lật trang.
   *
   * 2026-11-11 (chủ quán): hai trang này hiện Y HỆT màn Gọi món của nhân viên — mọi món đang hoạt
   * động, nhóm theo `sort_order` của nhóm, trong nhóm theo TÊN A→Z (đúng `GET /menu?sort=group`).
   * BỎ cấu hình riêng "Menu xem" (`is_menu_hidden`, `menu_sort_order` — cột vẫn còn trong DB, không
   * còn ai đọc). Cũng KHÔNG xét `is_online_hidden`: công tắc đó chỉ dành cho web đặt giao / tự lấy
   * (`/api/public/menu`). Món hết VẪN trả về — trang QR làm mờ, quyển menu lật tự ẩn ở FE.
   *
   * `Cache-Control: public, max-age=60`: trang không có thao tác ghi; ~600 món payload không nhỏ.
   * Đi qua ĐÚNG mapper whitelist (`toPublicMenuItem`) như `/menu`. Endpoint CHỈ ĐỌC.
   * Nhóm rỗng bị bỏ; món mồ côi gom vào "Khác".
   */
  @Get('menu-book')
  @Header('Cache-Control', 'public, max-age=60')
  async getMenuBook(): Promise<ApiOk<PublicMenuResponse>> {
    const [groups, items] = await Promise.all([
      this.groupRepo.find({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      }),
      this.itemRepo.find({
        where: { is_active: true },
        order: { name: 'ASC' },
      }),
    ]);

    const groupCodes = new Set(groups.map((g) => g.code));
    const itemsByGroupCode = new Map<string, MenuItem[]>();
    const orphanItems: MenuItem[] = [];
    for (const item of items) {
      if (!groupCodes.has(item.group)) {
        orphanItems.push(item);
        continue;
      }
      const list = itemsByGroupCode.get(item.group) ?? [];
      list.push(item);
      itemsByGroupCode.set(item.group, list);
    }

    const result: PublicMenuGroup[] = [];
    for (const group of groups) {
      const groupItems = itemsByGroupCode.get(group.code) ?? [];
      if (groupItems.length === 0) continue;
      result.push(toPublicMenuGroup(group, groupItems.map(toPublicMenuItem)));
    }

    if (orphanItems.length > 0) {
      result.push(
        toPublicMenuGroup(
          { id: randomUUID(), code: 'other', name: 'Khác', icon: null },
          orphanItems.map(toPublicMenuItem),
        ),
      );
    }

    return apiOk<PublicMenuResponse>({ groups: result });
  }
}

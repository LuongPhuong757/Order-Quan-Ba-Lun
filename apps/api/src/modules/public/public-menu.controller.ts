import { Controller, Get, Header } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { apiOk, type ApiOk } from '@order/utils';
import type { PublicMenuGroup } from '@order/schemas';
import { MenuItem } from '../menu/entities/menu-item.entity.js';
import { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { toPublicMenuGroup, toPublicMenuItem } from './public-menu.mapper.js';

type PublicMenuResponse = { groups: PublicMenuGroup[] };

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
  ) {}

  @Get('menu')
  @Header('Cache-Control', 'no-store')
  async getMenu(): Promise<ApiOk<PublicMenuResponse>> {
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

    const itemsByGroupCode = new Map<string, MenuItem[]>();
    const activeGroupCodes = new Set(groups.map((g) => g.code));
    const orphanItems: MenuItem[] = [];
    for (const item of items) {
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
}

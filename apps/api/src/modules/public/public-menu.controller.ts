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
   * GET /api/public/menu-book — quyển menu điện tử ở `menu.<domain>` và `/thuc-don`, nay cũng
   * là màn khách tự gọi món tại bàn bằng QR (M4).
   *
   * QUY TẮC DUY NHẤT (M4.D-36, chủ quán chốt 2026-09-15): món nào nhân viên gọi được ở POS
   * thì khách thấy được ở đây — không hơn, không kém. KHÔNG còn màn cấu hình riêng cho quyển
   * menu: màn "Menu xem" (2026-09-04) cùng cờ `is_menu_hidden` (món + nhóm) và cột
   * `menu_sort_order` đã bị gỡ khỏi giao diện lẫn API ghi. Ba cột đó vẫn nằm trong entity
   * nhưng endpoint này KHÔNG đọc chúng nữa — xem docblock ở entity vì sao chưa xoá cột.
   *
   * Vì sao bỏ màn cấu hình: khách quét QR mà không thấy món nhân viên vẫn bán được thì khách
   * đi hỏi nhân viên — đúng cái việc M4 sinh ra để giảm. Một nguồn sự thật (POS) thì không có
   * ca "màn này nói một đằng, màn kia nói một nẻo". Nhóm không phải đồ ăn (cược tiền, ứng
   * tiền, mục ngoài quán...) cũng hiện — chủ quán chấp nhận; nhân viên soát ở preview trước
   * khi đổ vào bàn (M4.D-17) nên dòng lạ không tự vào bill được.
   *
   * KHÁC `/api/public/menu` ở hai điểm, đều cố ý:
   *
   * 1. BỎ QUA `is_online_hidden` (cả nhóm lẫn món). Đó là cờ của web đặt hàng ship; món chỉ
   *    bán tại chỗ vẫn phải gọi được tại bàn.
   * 2. Sắp Y NHƯ màn gọi món của nhân viên (`BulkOrderModal`): nhóm theo `sort_order` (thứ
   *    tự CHUNG, chủ quán kéo thả ở hộp "Thứ tự nhóm"), món trong nhóm theo tên.
   *
   * `Cache-Control: no-store` từ 2026-09-11: trang này có nút đặt món, giá trễ một phút là
   * khách chọn theo giá cũ rồi bill ra giá khác.
   *
   * GIỐNG `/api/public/menu` ở chỗ quan trọng nhất: đi qua ĐÚNG mapper whitelist 7 field
   * (`toPublicMenuItem`), nên mọi cột nội bộ thêm vào `menu_items` sau này vẫn không lọt.
   * Endpoint CHỈ ĐỌC. Nhóm rỗng vẫn bị bỏ (không có trang trắng), món mồ côi vẫn gom vào
   * "Khác" — không bao giờ được rơi mất món.
   */
  @Get('menu-book')
  @Header('Cache-Control', 'no-store')
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

    const activeGroupCodes = new Set(groups.map((g) => g.code));
    const itemsByGroupCode = new Map<string, MenuItem[]>();
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

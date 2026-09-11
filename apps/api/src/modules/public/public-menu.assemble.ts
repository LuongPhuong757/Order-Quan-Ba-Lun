import type { PublicMenuGroup } from '@order/schemas';
import type { MenuItem } from '../menu/entities/menu-item.entity.js';
import type { MenuGroup } from '../menu/entities/menu-group.entity.js';
import { toPublicMenuGroup, toPublicMenuItem } from './public-menu.mapper.js';

/**
 * Gom `menu_groups` + `menu_items` thành cây menu công khai.
 *
 * Ba luật dưới đây giống nhau ở cả 3 mặt menu (`/menu`, `/menu-book`, `/dine-in-menu`) và
 * KHÔNG được lệch nhau, vì mỗi lần lệch là một loại "menu thiếu món" mà khách thấy ngay:
 *
 * 1. Nhóm rỗng bị bỏ — không để tile danh mục bấm vào chẳng có gì.
 * 2. Món có `group` không khớp nhóm nào đang bật → gom vào nhóm tổng hợp `other` ("Khác").
 *    Không bao giờ được rơi mất món.
 * 3. Nhóm bị ẩn thì loại CẢ nhóm LẪN món của nó — món trong nhóm ẩn TUYỆT ĐỐI không được
 *    rơi vào nhánh mồ côi ở luật 2, vì như vậy nó hồi sinh trong "Khác" và việc ẩn nhóm
 *    thành vô nghĩa.
 *
 * Cái KHÁC nhau giữa 3 mặt menu là cờ nào quyết định ẩn/hiện và sắp theo gì — hai thứ đó do
 * người gọi truyền vào (`hiddenGroupCodes`) và tự sắp `items` trước khi gọi.
 *
 * Hàm THUẦN, nhận cả hàm sinh id để test được không cần `randomUUID`.
 */
export function assemblePublicMenu(
  groups: MenuGroup[],
  items: MenuItem[],
  opts: { hiddenGroupCodes: Set<string>; makeOrphanGroupId: () => string },
): PublicMenuGroup[] {
  const activeGroupCodes = new Set(groups.map((g) => g.code));
  const itemsByGroupCode = new Map<string, MenuItem[]>();
  const orphanItems: MenuItem[] = [];

  for (const item of items) {
    if (opts.hiddenGroupCodes.has(item.group)) continue;
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
    if (opts.hiddenGroupCodes.has(group.code)) continue;
    const groupItems = itemsByGroupCode.get(group.code) ?? [];
    if (groupItems.length === 0) continue;
    result.push(toPublicMenuGroup(group, groupItems.map(toPublicMenuItem)));
  }

  if (orphanItems.length > 0) {
    result.push(
      toPublicMenuGroup(
        { id: opts.makeOrphanGroupId(), code: 'other', name: 'Khác', icon: null },
        orphanItems.map(toPublicMenuItem),
      ),
    );
  }

  return result;
}

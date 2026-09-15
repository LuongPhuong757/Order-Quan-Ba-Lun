// Mốc đổi của menu cho `GET /menu/version` — tách ra khỏi controller để test tích hợp chạy được
// trên MySQL thật mà không phải dựng cả Nest.
import type { Repository } from 'typeorm';
import type { MenuItem } from './entities/menu-item.entity.js';

/**
 * `"<MAX(updated_at)>:<COUNT(*)>"` trên TOÀN bảng menu_items (kể cả món đã ẩn).
 *
 * - `updated_at` là UpdateDateColumn: bếp bấm "hết món", admin sửa giá / ẩn món / đổi nhóm đều
 *   đẩy MAX lên. Đọc qua index `idx_menu_updated` nên là 1 dòng cuối index, không quét bảng.
 * - COUNT bắt thêm ca xoá cứng dòng — lúc đó không còn `updated_at` nào để tăng.
 * - Trả về CHUỖI thô của driver (vd `2026-09-14 07:47:15.123456:597`), FE chỉ so bằng/khác,
 *   không parse. Cố tình không đổi sang epoch ms: một lần chuyển múi giờ sai là mốc nhảy dù
 *   menu không đổi, và ngược lại làm tròn mất micro giây là hai lần sửa cách nhau 1 ms trông
 *   như một.
 * - Bảng rỗng → `":0"`, vẫn là một mốc hợp lệ và khác mọi mốc có dòng.
 */
export async function computeMenuVersion(repo: Repository<MenuItem>): Promise<string> {
  const row = await repo
    .createQueryBuilder('m')
    .select('COUNT(*)', 'c')
    .addSelect('MAX(m.updated_at)', 'u')
    .getRawOne<{ c: string | number; u: string | Date | null }>();
  const u = row?.u == null ? '' : row.u instanceof Date ? row.u.toISOString() : String(row.u);
  return `${u}:${row?.c ?? 0}`;
}

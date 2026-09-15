// Màn Bếp tách hai nhịp poll (2026-09-15): `/orders` mỗi 2 giây như cũ, còn DANH MỤC (menu +
// nhóm bếp + tên bàn) chỉ tải lại khi thật sự cần. Đo 2026-09-14: kéo /menu (597 món, 26 KB nén)
// mỗi 2 giây là 62 MB/giờ mỗi máy bếp và chiếm ~1/3 chu kỳ poll trên 4G, trong khi menu chỉ
// đổi vài lần một ca (bếp bấm "hết món", admin sửa giá).
//
// "Khi nào cần" quyết định bằng mốc `/menu/version` (server trả `MAX(updated_at):COUNT`) poll
// cùng nhịp 2 giây — đổi là tải lại, nên máy bếp khác thấy "hết món" trong ≤2 giây y như trước.
// Thêm lưới 60 giây cho nhóm bếp và tên bàn, hai thứ KHÔNG nằm trong mốc menu.

export type CatalogPollState = {
  /** Mốc `/menu/version` ứng với danh mục đang hiển thị. null = chưa tải lần nào. */
  version: string | null;
  /** Lúc tải danh mục lần cuối (ms). 0 = chưa tải. */
  loadedAt: number;
};

/** Lưới an toàn cho nhóm bếp / tên bàn — không có mốc riêng nên tải lại theo tuổi. */
export const CATALOG_MAX_AGE_MS = 60_000;

/**
 * Có phải tải lại danh mục ở nhịp này không.
 * - Chưa tải lần nào → có (lần vẽ đầu cần menu để hiện định lượng và nhóm bếp).
 * - Mốc menu đổi → có (kể cả server không trả mốc: `null` khác chuỗi cũ là tải lại cho chắc).
 * - Quá `maxAgeMs` kể từ lần tải cuối → có.
 * - Còn lại → không, chỉ `/orders` chạy.
 */
export function shouldReloadCatalog(
  state: CatalogPollState,
  version: string | null,
  now: number,
  maxAgeMs = CATALOG_MAX_AGE_MS,
): boolean {
  if (state.loadedAt === 0) return true;
  if (version !== state.version) return true;
  return now - state.loadedAt >= maxAgeMs;
}

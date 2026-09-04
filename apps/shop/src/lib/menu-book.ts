import type { PublicMenuGroup, PublicMenuItem } from '@order/schemas';

/**
 * Logic thuần của quyển menu điện tử (`menu.<domain>`) — chia trang, đo lưới, tìm món.
 *
 * Tách khỏi `MenuBookPage.tsx` vì đây là phần DUY NHẤT trong trang có thể sai một cách âm
 * thầm: lỡ tay làm rơi món cuối của một nhóm thì trang vẫn vẽ đẹp, vẫn lật mượt, và không
 * ai phát hiện cho tới lúc khách hỏi "sao không thấy món X". Ở đây nó test được.
 *
 * Không import React — mọi hàm trong file này là hàm thuần.
 */

/**
 * Một trang trong quyển menu = ĐÚNG MỘT NHÓM MÓN (chủ quán chốt 2026-09-04).
 *
 * Trước đây nhóm dài bị cắt thành nhiều trang và mỗi nhóm còn có thêm một trang bìa ảnh —
 * quán 32 nhóm mà thành 89 trang, lật mãi không hết. Giờ số trang BẰNG số nhóm: bấm chip
 * "Set Lẩu" là tới trang Set Lẩu, không phải trang 1 trong 5 của Set Lẩu.
 *
 * Nhóm dài hơn một màn hình thì TRANG KÉO DÀI XUỐNG và cuộn dọc — giống hệt việc mở một
 * tờ thực đơn gấp. Đổi lại, không còn khái niệm "trang 2/4" trong nhóm nữa.
 */
export type BookPage = {
  group: PublicMenuGroup;
  items: PublicMenuItem[];
};

/** Khổ trang: quyết định cỡ ảnh và cách xếp món, KHÔNG còn quyết định số món mỗi trang. */
export type BookGrid = {
  /**
   * Màn đủ rộng để mở HAI TRANG cạnh nhau như quyển sách thật, gáy ở giữa (chủ quán chốt
   * 2026-09-04). Khi bật, mọi phép đo bên dưới tính trên NỬA bề ngang — mỗi nửa là một
   * trang hoàn chỉnh.
   */
  spread: boolean;
  /**
   * Trang có RỘNG RÃI không (≥560px).
   *
   * Quyết định cỡ ảnh tròn và cỡ chữ của từng dòng món. Điện thoại 390px và một nửa trang
   * đôi 720px là hai thế giới khác nhau, dù cả hai đều "một cột".
   */
  roomy: boolean;
};

/**
 * Ngưỡng mở hai trang: 1024px.
 *
 * Dưới ngưỡng này chia đôi là mỗi trang chưa tới 512px — hẹp hơn cả điện thoại, không còn
 * chỗ cho ảnh tròn lẫn tên món trên cùng một dòng. 1024 cũng đúng bề ngang tablet nằm
 * ngang, thiết bị mỏng nhất mà mở sách còn có nghĩa. Điện thoại (kể cả nằm ngang, 844px)
 * luôn ở chế độ một trang.
 */
const SPREAD_MIN_WIDTH = 1024;

export function shouldSpread(width: number): boolean {
  return width >= SPREAD_MIN_WIDTH;
}

/**
 * Mỗi nhóm thành đúng một trang. Nhóm rỗng bị bỏ — một trang trắng mang tên nhóm còn khó
 * hiểu hơn là không có trang nào (BE đã lọc rồi, đây là lớp chặn thứ hai).
 *
 * KHÔNG còn tham số số-món-mỗi-trang: chiều cao trang do nội dung quyết định, không do
 * phép đo màn hình.
 */
export function paginateGroups(groups: PublicMenuGroup[]): BookPage[] {
  return groups.filter((g) => g.items.length > 0).map((group) => ({ group, items: group.items }));
}

/**
 * Khổ trang theo bề ngang khung đọc.
 *
 * Không còn đo chiều cao: từ 2026-09-04 một nhóm là một trang và trang tự kéo dài xuống,
 * nên chiều cao màn hình không còn quyết định điều gì cả.
 */
export function computeGrid(width: number): BookGrid {
  const spread = shouldSpread(width);
  const pageWidth = spread ? width / 2 : width;
  return { spread, roomy: pageWidth >= 560 };
}

/**
 * Bỏ dấu tiếng Việt + hạ chữ thường, để "bun bo" khớp được "Bún bò".
 *
 * `đ → d` phải làm TAY, không nhờ được `NFD`: trong Unicode "đ" là một CHỮ CÁI riêng của
 * bảng chữ cái tiếng Việt chứ không phải "d + dấu gạch", nên `\p{Diacritic}` không đụng
 * tới nó. Thiếu dòng này thì khách gõ "do uong" không ra "Đồ uống" — đúng cái nhóm mà
 * người ta hay gõ không dấu nhất.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

/**
 * Tìm món theo TÊN MÓN, MÃ MÓN hoặc TÊN NHÓM — cùng luật với ô tìm kiếm của trang đặt
 * hàng (`MenuPage`), để khách quen tay bên kia sang đây không phải học lại.
 *
 * Gõ trúng tên nhóm thì lấy TRỌN nhóm: khách gõ "lẩu" là muốn xem cả mục Lẩu, không phải
 * lọc tiếp trong đó. Quán ~600 món nên đây là đường đi chính, không phải tính năng phụ.
 *
 * Món có thể xuất hiện ở hai nhóm khớp khác nhau (nhóm khớp tên + chính món khớp tên) nên
 * lọc trùng theo `id`, nếu không khách thấy cùng một món hai lần trong kết quả.
 */
export function searchItems(groups: PublicMenuGroup[], query: string): PublicMenuItem[] {
  const q = normalizeForSearch(query);
  if (!q) return [];
  const seen = new Set<string>();
  const out: PublicMenuItem[] = [];
  for (const group of groups) {
    const wholeGroupMatches = normalizeForSearch(group.name).includes(q);
    for (const item of group.items) {
      if (
        !wholeGroupMatches &&
        !normalizeForSearch(item.name).includes(q) &&
        !normalizeForSearch(item.code).includes(q)
      ) {
        continue;
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/**
 * Sau khi xoay máy / bật bàn phím, số món mỗi trang đổi nên số trang cũng đổi. Giữ khách
 * ở NGUYÊN CHỖ CŨ bằng cách tìm lại trang chứa món đầu tiên họ đang nhìn, thay vì nhảy về
 * trang 1 hay đứng lại ở chỉ số trang cũ (giờ đã trỏ tới nhóm khác hẳn).
 *
 * Không tìm thấy (món vừa bị ẩn ở lần tải lại) → 0, tức về đầu quyển: một vị trí đúng và
 * đoán được, hơn là giữ chỉ số cũ nay đã trỏ vào chỗ vô nghĩa.
 */
export function findPageOfItem(pages: BookPage[], itemId: string | null): number {
  if (!itemId) return 0;
  const at = pages.findIndex((page) => page.items.some((item) => item.id === itemId));
  return at < 0 ? 0 : at;
}

/**
 * Định dạng tiền VND. CỐ Ý chép lại một dòng thay vì import `formatVnd` từ `cart-store.ts`.
 *
 * Không phải để tiết kiệm dung lượng (`main.tsx` vẫn nạp module đó cho tên miền đặt hàng)
 * mà để cây import của quyển menu KHÔNG chạm vào module giỏ hàng ở bất kỳ đâu. Nhờ vậy
 * `grep -r cart-store` trên nhánh menu ra rỗng, và người sửa file này sau ba tháng nữa
 * không vô tình gọi thêm một hàm nữa từ đó chỉ vì "đằng nào cũng import rồi".
 */
export function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
}

/**
 * Màu chủ đạo của từng nhóm (chủ quán yêu cầu 2026-09-04: "mỗi thư mục một màu, vẫn giữ
 * theme chung").
 *
 * MỖI NHÓM HAI MÀU, không phải một: bản đá phiến TỐI cho nền trang (`--cat-dark-*`) và bản
 * pastel SÁNG cho chip trên dải nhóm (`--cat-*`). Cùng một sắc, hai độ sáng, dùng ở hai
 * loại nền ngược nhau. Cả hai bộ đều đã nằm sẵn trong `tokens.css` kèm số đo tương phản —
 * không chế bảng màu mới ở đây.
 *
 * Gán theo THỨ TỰ NHÓM chứ không băm từ mã nhóm: thứ tự do chủ quán sắp, nên hai nhóm cạnh
 * nhau chắc chắn khác màu. Băm chuỗi thì hai nhóm liền kề hoàn toàn có thể rơi trúng cùng
 * một màu và dải nhóm trông như lỗi. Quán 32 nhóm nên màu lặp lại sau mỗi 7 — không sao,
 * thứ cần phân biệt là nhóm ĐANG XEM với hai nhóm bên cạnh nó.
 */
const CAT_COLOR_COUNT = 7;

/** Hai màu của một nhóm, dùng ở hai loại nền khác nhau. */
export type GroupColors = {
  /** Nền TRANG — bản đá phiến tối, để ảnh món nổi lên. */
  page: string;
  /** Chip trên dải nhóm và vạch cạnh tên nhóm — bản pastel sáng, đặt trên nền tối.
   *  Đây mới là chỗ khách thật sự NHÌN RA nhóm nào là màu gì: 7 nền tối lệch nhau rất
   *  nhẹ (cố ý, xem tokens.css), còn 7 chip sáng thì tách bạch ngay. */
  accent: string;
};

export function groupAccents(groups: PublicMenuGroup[]): Map<string, GroupColors> {
  const map = new Map<string, GroupColors>();
  groups.forEach((g, i) => {
    const n = (i % CAT_COLOR_COUNT) + 1;
    map.set(g.code, { page: `var(--cat-dark-${n})`, accent: `var(--cat-${n})` });
  });
  return map;
}

/** Trang đầu tiên của một nhóm — dải nhóm ở đầu trang nhảy tới đây. */
export function findFirstPageOfGroup(pages: BookPage[], groupCode: string): number {
  const at = pages.findIndex((page) => page.group.code === groupCode);
  return at < 0 ? 0 : at;
}

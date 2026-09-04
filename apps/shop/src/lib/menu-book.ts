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

/** Một trang trong quyển menu. Trang KHÔNG BAO GIỜ chứa món của hai nhóm khác nhau. */
export type BookPage = {
  group: PublicMenuGroup;
  /**
   * `cover` = trang bìa mở đầu một nhóm: đúng một tấm ảnh lớn tràn viền và tên nhóm, không
   * có món nào. Đây là trang "sang chương" của menu in — thứ chủ quán chỉ vào ảnh mẫu và
   * bảo muốn có. `items` = trang danh sách món bình thường.
   */
  kind: 'cover' | 'items';
  /** Luôn rỗng với trang bìa. */
  items: PublicMenuItem[];
  /** Chỉ có ở trang bìa. */
  coverImage: string | null;
  /**
   * Thứ tự trang trong phạm vi nhóm, đếm từ 1 — hiện ở tiêu đề "Món chính (2/3)".
   * Trang bìa mang số 0 và KHÔNG được tính vào `pagesInGroup`: với khách, "trang 1" là
   * trang món đầu tiên, còn tấm bìa là một tờ ảnh chứ không phải một trang menu.
   */
  pageInGroup: number;
  pagesInGroup: number;
};

export type BookGrid = {
  cols: number;
  rows: number;
  /** = cols × rows. Số món tối đa MỘT TRANG chứa được ở khổ màn hiện tại. */
  perPage: number;
  /** Khoảng cách giữa các ô, px — trang tự dùng lại để không lệch với phép đo ở đây. */
  gap: number;
  /**
   * Màn đủ rộng để mở HAI TRANG cạnh nhau như quyển sách thật, gáy ở giữa (chủ quán chốt
   * 2026-09-04). Khi bật, `cols` đã được tính trên NỬA bề ngang — mỗi nửa là một trang
   * hoàn chỉnh, không phải một cột của cùng một trang.
   */
  spread: boolean;
  /**
   * Ô món có RỘNG RÃI không (≥300px mỗi ô).
   *
   * Số cột KHÔNG nói lên điều đó: 2 cột trên điện thoại 390px cho ô 179px, còn 2 cột trên
   * một nửa trang đôi 720px cho ô 350px — cùng "2 cột" mà một bên phải cắt tên món xuống 3
   * dòng, một bên tên nằm gọn 1 dòng. Ô rộng thì ảnh to hơn, tên chỉ cần 2 dòng, và ô THẤP
   * hơn — nên đây cũng là thứ quyết định một trang chứa được mấy dòng.
   */
  roomy: boolean;
};

/**
 * Ngưỡng mở hai trang: 1024px.
 *
 * Dưới ngưỡng này chia đôi là mỗi trang chưa tới 512px, mà một trang cần ít nhất 2 cột ô
 * món mới ra hình quyển menu — 2 cột trong 500px là vừa đủ, hẹp hơn thì tên món vỡ vụn.
 * 1024 cũng đúng bề ngang tablet nằm ngang, tức là thiết bị mỏng nhất mà mở sách còn có
 * nghĩa. Điện thoại (kể cả nằm ngang, 844px) luôn ở chế độ một trang.
 */
const SPREAD_MIN_WIDTH = 1024;

export function shouldSpread(width: number): boolean {
  return width >= SPREAD_MIN_WIDTH;
}

/**
 * Chia toàn bộ menu thành các trang, MỖI NHÓM BẮT ĐẦU MỘT TRANG MỚI (chủ quán chốt
 * 2026-09-04).
 *
 * Nhóm dài hơn một trang thì tràn sang trang kế và vẫn mang tên nhóm đó — giống hệt menu
 * giấy, không phải "trang 4 không biết đang là mục gì".
 *
 * Nhóm rỗng bị bỏ hẳn: BE đã lọc rồi, nhưng nếu vì lý do nào đó lọt xuống đây thì một
 * trang trắng mang tên nhóm còn khó hiểu hơn là không có trang nào.
 *
 * `perPage < 1` (đo hụt lúc màn chưa vẽ xong) được ép về 1 thay vì trả mảng rỗng — trang
 * rỗng làm khách tưởng quán không còn món nào, chỉ vì một phép đo chạy sớm vài ms.
 */
export function paginateGroups(groups: PublicMenuGroup[], perPage: number): BookPage[] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: BookPage[] = [];
  for (const group of groups) {
    if (group.items.length === 0) continue;
    const cover = pickCoverImage(group);
    if (cover) {
      pages.push({ group, kind: 'cover', items: [], coverImage: cover, pageInGroup: 0, pagesInGroup: 0 });
    }
    const pagesInGroup = Math.ceil(group.items.length / size);
    for (let i = 0; i < pagesInGroup; i += 1) {
      pages.push({
        group,
        kind: 'items',
        items: group.items.slice(i * size, (i + 1) * size),
        coverImage: null,
        pageInGroup: i + 1,
        pagesInGroup,
      });
    }
  }
  return pages;
}

/**
 * Ảnh bìa của một nhóm: ảnh của MÓN ĐẦU TIÊN trong nhóm mà có ảnh.
 *
 * Chủ quán chọn "tự lấy ảnh đẹp nhất trong nhóm" (2026-09-04) — nhưng máy không biết ảnh
 * nào đẹp, nên nó lấy ảnh đầu tiên theo đúng thứ tự chủ quán đã sắp ở màn "Menu xem". Nói
 * cách khác: muốn đổi ảnh bìa thì kéo món có tấm ảnh ưng ý lên đầu nhóm. Đó là một cách
 * điều khiển thật, không phải ngẫu nhiên.
 *
 * Nhóm không món nào có ảnh → `null` → KHÔNG sinh trang bìa. Một trang bìa trống trơn hoặc
 * mang hoạ tiết "chưa có ảnh" phóng to hết màn thì tệ hơn hẳn là không có bìa.
 */
function pickCoverImage(group: PublicMenuGroup): string | null {
  for (const item of group.items) {
    const url = item.images[0];
    if (url) return url;
  }
  return null;
}

/**
 * Đo xem vùng trang chứa được lưới bao nhiêu cột × bao nhiêu dòng.
 *
 * VÌ SAO ĐO CHỨ KHÔNG ĐẶT CỨNG 3×10: chủ quán mô tả trang menu theo màn hình máy tính
 * (3 món/dòng, 10 dòng). Áp đúng con số đó lên iPhone thì mỗi ô rộng ~110px và cao ~66px —
 * ảnh món bằng con tem, tên món cụt. Đo thật rồi tự chọn số dòng cho vừa MỘT màn hình là
 * cách duy nhất giữ được đúng tinh thần "một trang = một màn, lật là hết trang" trên cả
 * điện thoại lẫn màn hình lớn: máy tính đủ cao vẫn ra đúng 3×10, điện thoại tự rút còn
 * 2×N cho chữ đọc được.
 *
 * Trần 10 dòng là con số chủ quán đưa — màn hình rất cao (TV dựng đứng) cũng không nhồi
 * quá mức, vì lúc đó ô sẽ giãn ra chứ không thêm dòng.
 *
 * Sàn 2 dòng: bàn phím ảo bật lên khi khách gõ tìm món có thể nuốt gần hết chiều cao;
 * thà ô bị tràn một chút còn hơn trang chỉ còn một món.
 */
export function computeGrid(width: number, height: number): BookGrid {
  const spread = shouldSpread(width);
  // Mở hai trang thì MỖI TRANG chỉ còn nửa bề ngang — lưới phải đo trên nửa đó, không phải
  // trên cả màn. Đo nhầm trên cả màn là ô món tràn qua gáy sách.
  const pageWidth = spread ? width / 2 : width;
  const cols = pageWidth < 768 ? 2 : 3;
  const roomy = pageWidth / cols >= 300;
  // Chiều cao một ô, phải KHỚP với `BookCard.tsx` — lệch là lưới tràn khỏi trang hoặc chừa
  // một khoảng trống ở chân trang.
  //   ô chật  (~180px): tên món 3 dòng (57) + giá (19) + đệm (16) ≈ 94. Ảnh 48px thấp hơn
  //     khối chữ nên không phải nó quyết định chiều cao.
  //   ô rộng  (≥300px): tên 2 dòng (38) + giá (19) + đệm (16) = 73, nhưng ảnh 64px + đệm
  //     = 80 mới là cái cao hơn → 84.
  const rowHeight = roomy ? 84 : 94;
  const gap = roomy ? 12 : 8;
  const fit = Math.floor((height + gap) / (rowHeight + gap));
  const rows = Math.min(10, Math.max(2, Number.isFinite(fit) ? fit : 2));
  return { cols, rows, perPage: cols * rows, gap, spread, roomy };
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
 * Neo cho TRANG BÌA: bìa không có món nào nên `findPageOfItem` không bám vào đâu được, và
 * khách xoay máy lúc đang xem bìa sẽ bị ném về đầu quyển. Bám theo mã nhóm thay thế.
 */
export function findCoverOfGroup(pages: BookPage[], groupCode: string): number {
  const at = pages.findIndex((page) => page.kind === 'cover' && page.group.code === groupCode);
  return at < 0 ? findFirstPageOfGroup(pages, groupCode) : at;
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
 * KHÔNG chế bảng màu mới. `tokens.css` đã có sẵn `--cat-1..7` — bộ pastel rút từ chính 4
 * tấm ảnh món của quán (ớt, cà rốt, nghệ, rau, tre, gỗ, mâm hồng), và cả 7 đều đã được đo
 * đạt ≥13:1 với `--text-strong`. Dùng lại đúng bộ đó là cách duy nhất vừa cho mỗi nhóm một
 * màu riêng vừa không tự dựng lên một hệ màu thứ hai cãi nhau với trang đặt hàng.
 *
 * Gán theo THỨ TỰ NHÓM chứ không băm từ mã nhóm: thứ tự do chủ quán sắp, nên hai nhóm cạnh
 * nhau chắc chắn khác màu. Băm chuỗi thì hai nhóm liền kề hoàn toàn có thể rơi trúng cùng
 * một màu và dải nhóm trông như lỗi. Quán 32 nhóm nên màu lặp lại sau mỗi 7 — không sao,
 * thứ cần phân biệt là nhóm ĐANG XEM với hai nhóm bên cạnh nó.
 */
const CAT_COLOR_COUNT = 7;

export function groupAccents(groups: PublicMenuGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  groups.forEach((g, i) => {
    map.set(g.code, `var(--cat-${(i % CAT_COLOR_COUNT) + 1})`);
  });
  return map;
}

/** Trang đầu tiên của một nhóm — dải nhóm ở đầu trang nhảy tới đây. */
export function findFirstPageOfGroup(pages: BookPage[], groupCode: string): number {
  const at = pages.findIndex((page) => page.group.code === groupCode);
  return at < 0 ? 0 : at;
}

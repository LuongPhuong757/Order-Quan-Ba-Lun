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
  items: PublicMenuItem[];
  /** Thứ tự trang trong phạm vi nhóm, đếm từ 1 — hiện ở tiêu đề "Món chính (2/3)". */
  pageInGroup: number;
  pagesInGroup: number;
};

export type BookGrid = {
  cols: number;
  rows: number;
  /** = cols × rows. Số món tối đa một trang chứa được ở khổ màn hiện tại. */
  perPage: number;
  /** Khoảng cách giữa các ô, px — trang tự dùng lại để không lệch với phép đo ở đây. */
  gap: number;
};

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
    const pagesInGroup = Math.ceil(group.items.length / size);
    for (let i = 0; i < pagesInGroup; i += 1) {
      pages.push({
        group,
        items: group.items.slice(i * size, (i + 1) * size),
        pageInGroup: i + 1,
        pagesInGroup,
      });
    }
  }
  return pages;
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
  const cols = width < 768 ? 2 : 3;
  // Chiều cao một ô, phải KHỚP với `BookCard.tsx` — lệch là lưới tràn khỏi trang hoặc chừa
  // một khoảng trống ở chân trang.
  //   2 cột (điện thoại): tên món 3 dòng (57) + giá (19) + đệm (16) ≈ 94. Ảnh 48px thấp hơn
  //     khối chữ nên không phải nó quyết định chiều cao.
  //   3 cột (máy tính):   tên 2 dòng (38) + giá (19) + đệm (16) = 73, nhưng ảnh 64px + đệm
  //     = 80 mới là cái cao hơn → 84.
  const rowHeight = cols === 2 ? 94 : 84;
  const gap = cols === 2 ? 8 : 12;
  const fit = Math.floor((height + gap) / (rowHeight + gap));
  const rows = Math.min(10, Math.max(2, Number.isFinite(fit) ? fit : 2));
  return { cols, rows, perPage: cols * rows, gap };
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

/** Trang đầu tiên của một nhóm — dải nhóm ở đầu trang nhảy tới đây. */
export function findFirstPageOfGroup(pages: BookPage[], groupCode: string): number {
  const at = pages.findIndex((page) => page.group.code === groupCode);
  return at < 0 ? 0 : at;
}

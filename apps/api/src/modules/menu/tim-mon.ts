// Dựng điều kiện tìm món theo TỪ, không phải theo chuỗi con.
//
// Lỗi chủ quán báo 2026-09-29: gõ "óc" ra cả "Bia Hơi Cốc", "Chân Gà Luộc", "Coca". Nguyên nhân
// là `LIKE '%óc%'` cộng với collation `utf8mb4_*_ci` của MySQL — nó bỏ dấu trước khi so, nên
// "óc" khớp "oc" nằm GIỮA chữ "Cốc" / "Luộc" / "Coca".
//
// Cách chữa: mỗi từ người dùng gõ phải khớp ĐẦU MỘT TỪ trong tên món.
//   'oc%'   → tên bắt đầu bằng "Ốc"
//   '% oc%' → có một từ bắt đầu bằng "Ốc" ở giữa tên
// Vẫn dùng LIKE chứ không phải REGEXP `\b`: REGEXP của MySQL 8 PHÂN BIỆT DẤU, nên gõ "oc"
// không dấu sẽ không ra "Ốc" — mà gõ không dấu là cách người Việt tìm hằng ngày.
//
// Nhiều từ = VÀ: "bach tuoc" đòi tên có cả từ bắt đầu "bach" lẫn từ bắt đầu "tuoc".

/** Nhiều nhất bấy nhiêu từ được dùng; phần dư bỏ qua để câu SQL không phình vô hạn. */
const MAX_WORDS = 6;

/** `%` và `_` là ký tự đại diện của LIKE. Không thoát thì gõ "%" ra toàn bộ menu. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type SearchClause = { sql: string; params: Record<string, string> };

/**
 * @returns mảng điều kiện, mỗi phần tử ứng với MỘT từ và phải AND lại với nhau.
 *   Mảng rỗng = không lọc gì.
 */
export function buildMenuSearch(raw: string): SearchClause[] {
  const words = raw.trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  return words.map((w, i) => {
    const e = escapeLike(w);
    return {
      // `m.code` vẫn so kiểu chuỗi con: mã món ("SP001026") là một khối liền, người dùng hay
      // gõ vài số cuối.
      sql: `(m.name LIKE :mw${i}a OR m.name LIKE :mw${i}b OR m.code LIKE :mw${i}c)`,
      params: {
        [`mw${i}a`]: `${e}%`,
        [`mw${i}b`]: `% ${e}%`,
        [`mw${i}c`]: `%${e}%`,
      },
    };
  });
}

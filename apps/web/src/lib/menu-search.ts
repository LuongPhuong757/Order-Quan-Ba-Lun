// Tìm món trong menu: gõ đủ tên, gõ không dấu, hoặc gõ viết tắt.
// Vd: 'khoai tây lắc' → gõ được 'khoai tay', 'ktl', 'kt lac', 'khtlac'.
// Dùng ở BulkOrderModal (màn gọi món) và MenuPickerModal.

export type MenuSearchTarget = {
  name: string;
  code: string;
};

/** lowercase + bỏ dấu tiếng Việt → 'Cánh Chiên' và 'canh chien' cùng dạng.
 *  Regex U+0300–U+036F = combining diacritics sau khi NFD tách dấu ra khỏi chữ.
 *  'đ' không tách được bằng NFD nên phải map tay. */
export function normalizeVi(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

/** Token có khớp được thành chuỗi tiền tố của các từ LIÊN TIẾP bắt đầu từ `start`?
 *  'ktl' vs ['khoai','tay','lac'] → k|t|l ✓. 'khtlac' → kh|t|lac ✓.
 *  Có backtracking (thử lấy nhiều ký tự trước, rồi lùi dần) vì lấy tham lam
 *  có thể chết: ['aa','ab'] + 'aab' cần word0 lấy 'a' chứ không phải 'aa'. */
function matchWordPrefixChain(words: string[], start: number, token: string): boolean {
  if (token === '') return true;
  if (start >= words.length) return false;
  const w = words[start];
  let max = 0;
  while (max < w.length && max < token.length && w[max] === token[max]) max++;
  for (let take = max; take >= 1; take--) {
    if (matchWordPrefixChain(words, start + 1, token.slice(take))) return true;
  }
  return false;
}

/** Vị trí từ bắt đầu chuỗi viết tắt khớp, -1 nếu không khớp.
 *  Khớp từ đầu tên (0) được ưu tiên hơn khớp giữa tên. */
function abbrevMatchStart(words: string[], token: string): number {
  if (token.length < 2) return -1; // 1 ký tự đã được lo bởi so khớp tiền tố từ
  for (let i = 0; i < words.length; i++) {
    if (matchWordPrefixChain(words, i, token)) return i;
  }
  return -1;
}

/** Điểm khớp của 1 token, null = không khớp. Số càng cao càng sát ý người gõ. */
function tokenScore(token: string, name: string, words: string[], code: string): number | null {
  if (code === token) return 1000;
  if (code.startsWith(token)) return 900;
  if (name.startsWith(token)) return 800;
  if (words.some((w) => w.startsWith(token))) return 750;
  if (name.includes(token)) return 700;
  if (code.includes(token)) return 650;
  const at = abbrevMatchStart(words, token);
  if (at === 0) return 600;
  if (at > 0) return 500;
  return null;
}

/** Điểm khớp của cả câu tìm kiếm với 1 món, null = không khớp.
 *  Tách token theo khoảng trắng — MỌI token phải khớp (AND), không cần liền nhau.
 *  Vd: 'canh chien' match 'cánh giữa chiên giòn'. */
export function menuSearchScore(item: MenuSearchTarget, query: string): number | null {
  const tokens = normalizeVi(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  const name = normalizeVi(item.name);
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  const code = normalizeVi(item.code);

  let total = 0;
  for (const t of tokens) {
    const s = tokenScore(t, name, words, code);
    if (s === null) return null;
    total += s;
  }
  return total / tokens.length;
}

/** Lọc + xếp theo độ khớp. Query rỗng → giữ nguyên thứ tự gốc của menu. */
export function filterMenuBySearch<T extends MenuSearchTarget>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: menuSearchScore(item, query) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length)
    .map((r) => r.item);
}

/** Món HẾT xuống cuối (chủ quán chốt 2026-11-09) — trước nằm lẫn giữa món còn bán ở màn Gọi
 *  món, liếc nhầm là chạm trượt. Giữ nguyên thứ tự mọi thứ khác (sắp xếp ổn định):
 *  - đang tìm: danh sách đã xếp theo độ khớp, chỉ đẩy món hết xuống cuối cả danh sách;
 *  - không tìm: món hết xuống cuối NHÓM của nó, các nhóm giữ thứ tự xuất hiện. */
export function dayMonHetXuongCuoi<T extends { group: string; is_out_of_stock: boolean }>(
  list: T[],
  dangTim: boolean,
): T[] {
  if (!list.some((it) => it.is_out_of_stock)) return list;
  if (dangTim) {
    return [...list.filter((it) => !it.is_out_of_stock), ...list.filter((it) => it.is_out_of_stock)];
  }
  const thuTuNhom = new Map<string, number>();
  list.forEach((it) => {
    if (!thuTuNhom.has(it.group)) thuTuNhom.set(it.group, thuTuNhom.size);
  });
  return list
    .map((it, i) => ({ it, i }))
    .sort(
      (a, b) =>
        thuTuNhom.get(a.it.group)! - thuTuNhom.get(b.it.group)! ||
        Number(a.it.is_out_of_stock) - Number(b.it.is_out_of_stock) ||
        a.i - b.i,
    )
    .map((x) => x.it);
}

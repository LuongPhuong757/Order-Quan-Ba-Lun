/**
 * Title Case cho tên tiếng Việt — mỗi từ chữ đầu hoa, các chữ sau thường.
 *
 * Ví dụ:
 *   "rau muống xào"       → "Rau Muống Xào"
 *   "RAU MUỐNG XÀO"       → "Rau Muống Xào"
 *   "rAu mUỐng XÀO"       → "Rau Muống Xào"
 *   "  phở   bò  "        → "Phở Bò"        (trim + collapse spaces)
 *   "TÔM HÙM 250g/1 đĩa"  → "Tôm Hùm 250g/1 Đĩa"  (số giữ nguyên)
 *   ""                    → ""
 *
 * JS toLowerCase/toUpperCase đã Unicode-aware → hoạt động tốt với diacritics
 * (phở, ơn, ấ, đ, ...). Không cần thư viện riêng.
 */
export function toTitleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

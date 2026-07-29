// M2.D-67 + C-SEC-01 — allow-list origin dạng danh sách, so khớp CHÍNH XÁC.
//
// Bản cũ (csrf-origin.middleware.ts) dùng `origin.startsWith(allowed)`. Với
// ALLOWED_ORIGIN=https://quanbalun.site thì origin của attacker
// `https://quanbalun.site.evil.com` vẫn lọt, vì không có ranh giới nào sau phần prefix.
// Ở đây so `protocol + '//' + host` bằng ĐÚNG BẰNG.
//
// Module thuần: không import gì từ @nestjs/* hay express, để test được mà không dựng app.

/** Chuẩn hoá một origin về dạng `protocol//host` (host giữ port). Trả null nếu không parse được. */
function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    // Dùng `host` (có port) chứ không phải `hostname` — cần phân biệt
    // http://localhost:5173 (admin) với http://localhost:5174 (shop).
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Đọc `ALLOWED_ORIGIN` dạng danh sách phân tách dấu phẩy (M2.D-67).
 * Bỏ khoảng trắng thừa, phần tử rỗng, và dấu `/` cuối.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim().replace(/\/+$/, ''))
    .filter((part) => part.length > 0);
}

/**
 * Origin (hoặc Referer, vốn mang cả path) có nằm trong allow-list không.
 * Đầu vào không parse được → false, KHÔNG ném lỗi (middleware không phải bọc try/catch).
 */
export function isOriginAllowed(
  originOrReferer: string | undefined,
  allowed: string[],
): boolean {
  if (!originOrReferer) return false;
  const incoming = normalizeOrigin(originOrReferer);
  if (!incoming) return false;
  // Chuẩn hoá cả phía allow-list để 'https://a.com/' và 'https://a.com' khớp nhau.
  return allowed.some((entry) => normalizeOrigin(entry) === incoming);
}

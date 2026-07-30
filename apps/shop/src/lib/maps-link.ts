/**
 * parseMapsLink — trích toạ độ từ link Google Maps do khách dán, 100% CLIENT-SIDE.
 *
 * RÀNG BUỘC BẮT BUỘC: hàm này KHÔNG gọi BE, KHÔNG `fetch`, KHÔNG follow redirect.
 * Link rút gọn (`maps.app.goo.gl`, `goo.gl/maps`) CỐ Ý KHÔNG hỗ trợ (08-RESEARCH.md
 * Assumptions Log A3): resolve redirect server-side với URL do khách dán là một vector
 * SSRF (phải allowlist domain + chặn redirect ra IP nội bộ + timeout ngắn), độ phức tạp
 * cao hơn giá trị mang lại khi khách đã có 2 đường chính là nút "Chia sẻ vị trí" và nhập
 * địa chỉ tay. Ai muốn thêm sau này phải đọc mục Assumptions Log A3 trước.
 */

export type MapsLinkResult = { lat: number; lng: number } | { error: 'SHORT_LINK' | 'NO_COORDS' };

const SHORT_LINK_HOSTS = ['maps.app.goo.gl', 'goo.gl'];

function inRange(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function isShortLink(raw: string): boolean {
  return SHORT_LINK_HOSTS.some((host) => raw.includes(host));
}

export function parseMapsLink(raw: string): MapsLinkResult {
  const trimmed = raw.trim();
  if (!trimmed) return { error: 'NO_COORDS' };

  // Thứ tự ưu tiên (cao → thấp):
  // 1. !3d/!4d — toạ độ chính xác của địa điểm (Google Maps "place" link).
  const placeMatch = trimmed.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (placeMatch) {
    const lat = Number(placeMatch[1]);
    const lng = Number(placeMatch[2]);
    if (inRange(lat, lng)) return { lat, lng };
    return { error: 'NO_COORDS' };
  }

  // 2. @lat,lng — tâm khung nhìn.
  const atMatch = trimmed.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    const lat = Number(atMatch[1]);
    const lng = Number(atMatch[2]);
    if (inRange(lat, lng)) return { lat, lng };
    return { error: 'NO_COORDS' };
  }

  // 3. ?q=lat,lng hoặc &q=lat,lng.
  const qMatch = trimmed.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (qMatch) {
    const lat = Number(qMatch[1]);
    const lng = Number(qMatch[2]);
    if (inRange(lat, lng)) return { lat, lng };
    return { error: 'NO_COORDS' };
  }

  // 4. Khách dán thẳng cặp số "lat, lng".
  const bareMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (bareMatch) {
    const lat = Number(bareMatch[1]);
    const lng = Number(bareMatch[2]);
    if (inRange(lat, lng)) return { lat, lng };
    return { error: 'NO_COORDS' };
  }

  // Không tìm được toạ độ nào ở trên — kiểm xem có phải link rút gọn không, để UI báo
  // đúng nguyên nhân (SHORT_LINK) thay vì lẫn với "không chứa toạ độ" (NO_COORDS).
  if (isShortLink(trimmed)) {
    return { error: 'SHORT_LINK' };
  }

  return { error: 'NO_COORDS' };
}

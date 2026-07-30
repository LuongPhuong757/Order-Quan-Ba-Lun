// M2.D-49/D-50 — pure, không phụ thuộc DB.
// Module thuần: không import gì từ @nestjs/* hay typeorm, để test được mà không dựng app.
const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// M2.D-50: nhân hệ số đường thực tế — distanceFactor LUÔN lấy từ setting `distance_factor`
// (mặc định 1.3 khi đọc DB), KHÔNG hardcode 1.3 trong hàm này.
export function estimatedRoadDistanceKm(straightKm: number, distanceFactor: number): number {
  return Math.round(straightKm * distanceFactor * 100) / 100; // 2 chữ số thập phân, khớp decimal(6,2)
}

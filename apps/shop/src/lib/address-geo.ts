import { VN_PROVINCES, type VnProvince, type VnWard } from '@order/schemas/vn-address';

/**
 * Suy ngược TỈNH + XÃ từ toạ độ khách chia sẻ (2026-08-10).
 *
 * Việc nó giải quyết: khách bấm "Chia sẻ vị trí" xong vẫn phải tự dò tỉnh + xã của chính mình
 * trong 3.321 dòng — máy đã biết họ đứng ở đâu mà vẫn bắt khai lại. Tệ hơn, hai nguồn đó lệch nhau
 * được: ghim ở xã này, ô chọn ghi xã khác, và quán gom tuyến theo cái sai.
 *
 * VÌ SAO KHỚP BẰNG "TÂM GẦN NHẤT" CHỨ KHÔNG PHẢI REVERSE-GEOCODE
 * Reverse-geocode đúng nghĩa cần ranh giới xã (hàng MB GeoJSON — không thể nằm trong luồng đặt
 * đơn) hoặc một API mạng — thứ mà `vn-address.ts` đã cố ý tránh: một lệ thuộc mạng ở giữa chỗ
 * khách dễ bỏ giỏ nhất. Tâm gần nhất chỉ cần dữ liệu đã có sẵn, chạy tức thì, và sai lệch của nó
 * là loại KHÁCH TỰ SỬA ĐƯỢC (nút "Chọn lại" ở `AddressSelect`).
 *
 * HAVERSINE Ở ĐÂY KHÔNG PHẢI KHOẢNG CÁCH GIAO HÀNG. Quy tắc "BE là nơi duy nhất tính Haversine"
 * nói về km tính phí ship và về "ngoài bán kính" — hai thứ quyết định tiền và quyết định nhận/từ
 * chối đơn. Phép tính ở đây chỉ để chọn một dòng trong danh sách xã; nó không đi vào body đơn hàng
 * và không chặn được cái gì.
 */

/**
 * Xa hơn mức này thì KHÔNG đoán xã nữa.
 *
 * Xã Bắc Ninh trung bình ~48 km² → bán kính tương đương ~3,9 km; xã dài thì người ở rìa cách tâm
 * cỡ 8 km. Đó là chặn trên hợp lý cho một cú khớp ĐÚNG. Không có ngưỡng này thì khách ở Hải Dương
 * hay Hưng Yên — nơi chưa geocode xã nào — vẫn bị gán một xã Bắc Ninh nào đó chỉ vì nó là tâm gần
 * nhất trong toàn bộ dữ liệu.
 *
 * ĐO LẠI MỖI KHI THÊM TỈNH VÀO `GEOCODE_PROVINCES`, đừng tin con số này là vĩnh viễn. Điều kiện để
 * 8 km còn đúng là KHÔNG xã nào có "bán kính mù" (nửa khoảng cách tới tâm xã kề gần nhất) vượt nó —
 * với Hà Nội + Bắc Ninh thì lớn nhất là 7,6 km ở Xã Sa Lý, tức vừa sát. Thêm một tỉnh miền núi xã
 * thưa hơn là phải nới lên, bằng không người ở đó chia sẻ vị trí mà không xã nào khớp.
 */
export const WARD_MATCH_MAX_KM = 8;

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export type WardMatch = { ward: VnWard; province: VnProvince; distance_km: number };

/**
 * Xã có tâm gần toạ độ này nhất, `null` khi không có xã nào đủ gần (xem `WARD_MATCH_MAX_KM`).
 *
 * Quét thẳng, không chỉ mục không gian: hiện ~225 xã có toạ độ (Hà Nội + Bắc Ninh), và kể cả khi
 * geocode cả nước thì 3.321 phép nhân lượng giác vẫn dưới một mili-giây. Dựng thêm một quadtree ở
 * đây là thêm một thứ có thể sai để đổi lấy thời gian không ai đo được.
 */
export function nearestWard(
  lat: number,
  lng: number,
  maxKm: number = WARD_MATCH_MAX_KM,
): WardMatch | null {
  let best: WardMatch | null = null;
  for (const province of VN_PROVINCES) {
    for (const ward of province.wards) {
      if (ward.lat === undefined || ward.lng === undefined) continue;
      const distance_km = haversineKm(lat, lng, ward.lat, ward.lng);
      if (distance_km > maxKm) continue;
      if (best === null || distance_km < best.distance_km) best = { ward, province, distance_km };
    }
  }
  return best;
}

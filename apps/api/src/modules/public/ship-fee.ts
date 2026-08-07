// Quy tắc tính phí giao hàng ƯỚC TÍNH (2026-08-06) — pure, không import @nestjs/* hay typeorm.
//
// ĐÂY LÀ NƠI DUY NHẤT trong hệ thống biết "km thì ra bao nhiêu tiền". Ba chỗ đọc nó:
//   1. `POST /api/public/ship-quote` — số khách thấy ở bước checkout,
//   2. `suggested_ship_fee` trong hàng chờ đơn online — số điền sẵn ô phí ship của nhân viên,
//   3. (gián tiếp) câu chữ giải thích ở cả hai màn.
// Ba chỗ đó PHẢI ra cùng một con số cho cùng một đơn: khách đọc "tạm tính 15.000đ" rồi nhân viên
// gọi lại báo 25.000đ là mất lòng tin ngay ở cú điện thoại đầu tiên. Vì vậy đừng nhân bản công
// thức này ở FE — cả hai FE chỉ hiển thị số BE trả về.
//
// Phí KHÔNG BAO GIỜ là con số chốt: quán vẫn gõ đè lúc duyệt (M2.D-62). Mọi câu chữ đi kèm số này
// đều phải nói ra điều đó.

/** Làm tròn LÊN bội số 1.000đ — quán thu tiền mặt, không ai trả 12.347đ. Lên chứ không xuống:
 *  thà quán thu đủ còn hơn hụt, và số hiện cho khách không được thấp hơn số quán sẽ báo. */
const ROUND_TO_VND = 1_000;

export type ShipFeeInput = {
  /** Km đường bộ ước tính (đã nhân `distance_factor`). `null` = chưa đo được. */
  distanceKm: number | null;
  /** Bán kính miễn phí (setting `free_ship_km`). */
  freeShipKm: number;
  /** Giá mỗi km ngoài bán kính miễn phí (setting `ship_fee_per_km`). `0` = chưa cấu hình. */
  perKm: number;
};

/**
 * Phí giao tạm tính, hoặc `null` khi KHÔNG được phép hứa với khách một con số nào.
 *
 * `null` ở đúng 2 trường hợp, và cả hai đều khác hẳn `0`:
 *   - `distanceKm === null` — quán chưa cấu hình toạ độ, hoặc khách không chia sẻ vị trí;
 *   - `perKm <= 0` — chủ quán chưa đặt bảng giá (mặc định của `ship_fee_per_km`).
 * `0` chỉ xuất hiện khi thực sự MIỄN PHÍ (trong bán kính `freeShipKm`) — một lời khẳng định.
 *
 * Phần km vượt được làm tròn LÊN đơn vị km trước khi nhân giá: quán tính tiền theo km chẵn, và
 * "2,1 km vượt" mà thu tiền 2 km là chỗ hụt tiền không ai để ý.
 */
export function computeShipFee({ distanceKm, freeShipKm, perKm }: ShipFeeInput): number | null {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  if (!Number.isFinite(perKm) || perKm <= 0) return null;

  const billableKm = Math.max(0, distanceKm - Math.max(0, freeShipKm));
  if (billableKm <= 0) return 0;

  const raw = Math.ceil(billableKm) * perKm;
  return Math.ceil(raw / ROUND_TO_VND) * ROUND_TO_VND;
}

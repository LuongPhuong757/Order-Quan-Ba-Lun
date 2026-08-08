// Bán kính giao tối đa (`max_delivery_km`, 2026-08-07) — chủ quán yêu cầu: khách ở quá xa thì hệ
// thống TỰ từ chối ngay lúc đặt, đỡ phải gọi lại để huỷ tay từng đơn.
//
// Module thuần: không import gì từ @nestjs/* hay typeorm. Hai nơi gọi nó và CHỈ hai nơi đó —
//   1. `public-ship-quote.controller.ts` — khách vừa chia sẻ vị trí ở checkout → chặn TRƯỚC khi
//      khách mất công điền tên/SĐT.
//   2. `submit-order.ts` — chốt chặn THẬT. Bước 1 chỉ là UI hint (khách có thể tắt JS, gọi API
//      thẳng, hoặc đổi vị trí sau khi đã lấy quote), nên nó không bao giờ được là nơi duy nhất.
//
// Cùng lý lẽ với cặp `otp_required` (UI hint) / kiểm phiên OTP trong `submit-order.ts` (chốt thật).

/**
 * Khách có nằm NGOÀI bán kính giao của quán không.
 *
 * Hai trường hợp trả `false` cần đọc kỹ, vì cả hai đều là quyết định có chủ ý chứ không phải lọt lưới:
 *
 * - `maxKm <= 0` — quán KHÔNG đặt giới hạn (mặc định của hệ thống). Đây là lý do mặc định phải là
 *   0 chứ không phải một con số "hợp lý": mọi quán đang chạy đều chưa có key này trong DB, và một
 *   mặc định khác 0 sẽ âm thầm bắt đầu từ chối đơn thật mà không ai bật gì.
 *
 * - `distanceKm === null` — CHƯA TÍNH ĐƯỢC (quán chưa cấu hình toạ độ, hoặc khách gõ địa chỉ tay
 *   không chia sẻ vị trí). "Không biết khách ở đâu" KHÔNG được thành "khách ở quá xa": làm vậy là
 *   chặn cả những khách ở ngay cạnh quán chỉ vì họ không bấm chia sẻ GPS. Đơn vẫn vào, nhân viên
 *   vẫn nhìn địa chỉ rồi tự quyết như trước — đúng hành vi hiện tại.
 */
export function isBeyondDeliveryRadius(distanceKm: number | null, maxKm: number): boolean {
  if (maxKm <= 0) return false;
  if (distanceKm === null) return false;
  return distanceKm > maxKm;
}

/**
 * Câu từ chối hiện cho khách. Build tại đây (không qua `FRIENDLY_VN` của
 * global-exception.filter.ts) vì nó nội suy km + SĐT quán — cùng luật Pitfall #6 với các mã lỗi
 * public khác.
 *
 * Câu chữ có 3 việc phải làm, theo đúng thứ tự khách cần:
 *  1. Nói rõ LÝ DO là khoảng cách, không phải đơn/món có vấn đề.
 *  2. Đưa con số để khách tự đối chiếu (`X km` vs bán kính `Y km`) — không thì nó là một lời từ
 *     chối không kiểm chứng được.
 *  3. Chừa một đường ra: gọi quán. Quán vẫn có thể nhận nếu họ muốn; setting này chặn đường TỰ
 *     ĐỘNG, không phải cấm hẳn khách đó.
 */
export function buildTooFarMessage(
  distanceKm: number | null,
  maxKm: number,
  storePhone: string,
): string {
  const near = distanceKm === null ? '' : `Vị trí của quý khách cách quán khoảng ${distanceKm} km, `;
  const callPart = storePhone ? ` Nếu cần, quý khách vui lòng gọi ${storePhone} để quán sắp xếp riêng.` : '';
  return `${near}vượt quá bán kính giao hàng ${maxKm} km của quán nên quán chưa giao tới được. Quý khách có thể chọn "Đến lấy tại quán".${callPart}`;
}
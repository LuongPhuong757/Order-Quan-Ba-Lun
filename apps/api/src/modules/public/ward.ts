// Mã xã/phường của đơn — MỘT quy tắc, dùng chung cho cả đặt đơn lẫn sửa đơn.
//
// Module thuần: không import gì từ @nestjs/* hay typeorm, cùng kiểu với `delivery-radius.ts`.
//
// LUẬT DUY NHẤT, VÀ NÓ LÀ MỘT LỜI HỨA CHỨ KHÔNG PHẢI TIỆN TAY:
//
//   Mã xã sai, lạ, hay thiếu → LƯU NULL. KHÔNG BAO GIỜ ném lỗi, KHÔNG BAO GIỜ từ chối đơn.
//
// Vì sao phải viết thành hàm riêng thay vì `?? null` tại chỗ gọi: cái sai ở đây không lộ ra
// ngay. Ai đó thêm `throw new BadRequestException('Mã xã không hợp lệ')` sẽ thấy test xanh và
// luồng bình thường chạy tốt — trang khách chọn từ danh sách nên đường đi thường không bao giờ
// sinh mã sai. Nó chỉ nổ với đúng những người không tự sửa được: khách dùng trình duyệt cũ,
// khách còn giữ mã xã cũ trong localStorage sau một đợt sắp xếp đơn vị hành chính, khách đặt
// lại đơn cũ. Họ sẽ thấy "đặt đơn thất bại" mà không hiểu vì sao, và quán mất đơn mà không
// biết đã mất.
//
// Địa chỉ đầy đủ vốn đã nằm trong `customer_address` (chuỗi khách đọc được, có cả tên xã). Mã xã
// chỉ là bản CÓ CẤU TRÚC của phần đuôi chuỗi đó, để lọc/gom đơn theo khu vực. Mất nó thì quán
// kém tiện một chút; chặn đơn vì nó thì quán mất tiền.
//
// Nó cũng TUYỆT ĐỐI không được tham gia tính phí giao hay quyết định "ngoài bán kính" — toạ độ
// điểm giữa xã lệch chỗ ở thật của khách vài km (xem `vn-address.ts`). Chỉ toạ độ do khách
// tự ghim mới làm việc đó, ở `delivery-radius.ts`.
import { isValidWardCode } from '@order/schemas';

/**
 * Chuẩn hoá mã xã trước khi ghi DB.
 *
 * Trả `null` khi: đơn PICKUP (không giao thì không có xã), mã vắng mặt, hoặc mã không có trong
 * danh mục hành chính hiện hành.
 */
export function sanitizeWardCode(
  code: string | null | undefined,
  fulfillmentType: 'PICKUP' | 'DELIVERY',
): string | null {
  if (fulfillmentType !== 'DELIVERY') return null;
  return isValidWardCode(code) ? (code as string) : null;
}

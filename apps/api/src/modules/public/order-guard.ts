// Thứ tự kiểm tra HIỆN TẠI — 4 lớp chống lạm dụng:
//   phone not blacklisted → rate limit → no open order for phone → món còn hàng
// Đổi thứ tự trong hàm này là đổi hành vi nghiệp vụ — phải sửa test tương ứng (order-guard.test.ts).
//
// ── D-11 (chốt 2026-07-31) — công tắc nhận đơn KHÔNG CÒN CHẶN GÌ ──
//
// Trước phase 9, hàm này mở đầu bằng một nhánh đọc trạng thái công tắc và trả về 2 mã lỗi riêng
// cho "quán tắt nhận đơn" và "ngoài giờ mở cửa". Nhánh đó đã bị GỠ HẲN. Công tắc nay chỉ còn 2
// trạng thái Mở / Đóng cửa, và **cả hai đều nhận đơn bình thường** — Đóng cửa chỉ đổi CÂU CHỮ hiện
// cho khách (`closed_banner_text`, `closed_submit_confirm_text`). D-11 ghi đè **M2.D-26 và
// M2.D-27**; chuỗi kiểm tra 6 bước ở spec §7 dòng 461-463 nay là **STALE** — 2 bước đầu không còn.
// Vết ghi đè: `OVERRIDE-DEBT.md` **OD-13**.
//
// (Tên 2 mã lỗi đã chết cố ý KHÔNG viết ra trong file này, để lệnh kiểm "guard không còn tham chiếu
// mã lỗi công tắc" giữ được ý nghĩa — xem `order-guard.test.ts` § hồi quy ngược, nơi 2 tên đó được
// khẳng định tường minh là không bao giờ xuất hiện nữa.)
//
// ── 2026-08-16 — OD-13 ĐÃ BỊ ĐẢO NGƯỢC, nhưng KHÔNG phải ở file này ──
// Chủ dự án quyết định chặn lại việc TẠO đơn khi quán đóng (khách thấy đếm ngược tới giờ mở).
// Nhánh chặn mới sống ở `submit-order.ts` (cạnh luật pickup/delivery_enabled), KHÔNG quay về đây:
// module này giữ nguyên bề mặt 4 cờ boolean như test đang khoá. Hai mã lỗi công tắc vì vậy có
// người phát ra trở lại — từ submit-order, không bao giờ từ guard.
//
// ⚠ **D-18 — 4 lớp còn lại ĐỘC LẬP với công tắc, KHÔNG được gỡ theo.** Chúng là toàn bộ hàng rào
// chống bom đơn của phase 8. Gỡ công tắc mà gỡ nhầm một trong 4 lớp này là mở toang cửa cho lạm
// dụng (T-09-65, severity HIGH) — và triệu chứng sẽ không lộ ra cho tới khi có người khai thác thật.
//
// Module thuần: hàm chỉ nhận boolean/array ĐÃ FETCH SẴN, không tự query DB, không import
// bất kỳ thứ gì từ Nest hay ORM. Service gọi hàm này sau khi tự fetch 4 giá trị.

export type OrderGuardInput = {
  isBlacklisted: boolean;
  isRateLimited: boolean;
  hasOpenOrder: boolean;
  unavailableItemCodes: string[]; // rỗng nếu tất cả còn hàng
};

// Union này từng có 6 thành viên; 2 mã của công tắc ĐÃ BỊ BỎ theo D-11.
// TypeScript KHÔNG báo lỗi khi để lại một thành viên union không ai phát ra nữa — nên việc xoá
// phải làm bằng tay và chỉ review mới bắt được. Hai mã đó vẫn còn trong
// `packages/schemas/src/errors.ts` (hợp đồng lỗi lịch sử, và 09-CONTEXT § Deferred để ngỏ khả năng
// thêm lại trạng thái "TẮT HẲN" sau này) — nhưng **không đường nào phát ra chúng nữa**.
export type GuardErrorCode =
  | 'PHONE_BLACKLISTED'
  | 'TOO_MANY_REQUESTS'
  | 'ORDER_ALREADY_OPEN_FOR_PHONE'
  | 'MENU_ITEM_UNAVAILABLE';

export function checkOrderGuard(input: OrderGuardInput): GuardErrorCode | null {
  if (input.isBlacklisted) return 'PHONE_BLACKLISTED';
  if (input.isRateLimited) return 'TOO_MANY_REQUESTS';
  if (input.hasOpenOrder) return 'ORDER_ALREADY_OPEN_FOR_PHONE';
  if (input.unavailableItemCodes.length > 0) return 'MENU_ITEM_UNAVAILABLE';
  return null;
}
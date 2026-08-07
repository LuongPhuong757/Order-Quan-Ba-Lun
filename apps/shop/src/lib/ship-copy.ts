/**
 * Câu đi kèm MỌI con số phí ship tạm tính trên trang khách.
 *
 * Nằm ở `lib/` chứ không phải trong một page (2026-08-07): con số tạm tính xuất hiện ở ÍT NHẤT 3
 * màn — tóm tắt giỏ ở bước đặt hàng, popup xác nhận trước khi gửi, và trang theo dõi đơn
 * `/o/:token`. Mỗi màn tự viết lại câu này là cách chắc chắn để một hôm nào đó có màn quên mất
 * chữ "tạm tính".
 *
 * Vì sao câu này BẮT BUỘC: phí chốt thật là số nhân viên gõ lúc duyệt đơn (M2.D-62). Một con số
 * không kèm chữ "tạm tính" là lời hứa ta không giữ được — khách chuẩn bị đúng số tiền đó rồi
 * shipper tới đòi khác, và shipper là người chịu trận.
 */
export const SHIP_ESTIMATE_HINT = 'Phí tạm tính theo khoảng cách — quán xác nhận lại khi gọi.';

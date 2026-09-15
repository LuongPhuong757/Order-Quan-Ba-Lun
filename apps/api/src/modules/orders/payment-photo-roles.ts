// Danh sách role được chạm vào ảnh bill chuyển khoản (2026-09-15).
//
// Tách thành hằng số RIÊNG chứ không viết thẳng vào `@UseGuards(RequireRoles(...))` vì đây là
// chỗ đã sinh ra một bug trên quán thật: `POST /orders/:id/checkout` không gác role nào cả, nên
// BẾP thu tiền được — nhưng ba endpoint ảnh bill lại gác `('admin','order')` và bỏ quên bếp.
// Người thu đi hết luồng, tới bước chụp bill thì ăn 403 "Bạn không có quyền xem mục này".
//
// Ở đây thì `payment-photo-roles.test.ts` kiểm được bất biến "ai thu được tiền thì phải chụp
// được bill", mà không phải dựng cả Nest test module để bấm qua guard.
//
// ⚠ ĐÂY KHÔNG PHẢI CHỐT QUYỀN THẬT. Chốt thật là công tắc `can_collect_transfer` theo từng người
// (xem `assertCanCollectTransfer`) — ảnh bill mang tên và số tài khoản của khách, nên mở cho
// role nào cũng vẫn phải được chủ quán bật cho đúng người ấy. Danh sách này chỉ là lớp thô.

/** GHI (chụp / xoá ảnh). Đúng bằng tập role thu được tiền: `checkout` không gác role, và role
 *  chỉ-đọc `report` đã bị `JwtAuthGuard` chặn ở mọi phương thức ghi. */
export const PAYMENT_PHOTO_WRITE_ROLES = ['admin', 'order', 'kitchen'] as const;

/** ĐỌC (xem lại ảnh ở màn Lịch sử). Thêm `report`: nó không thu tiền nhưng có việc đối soát —
 *  và vẫn phải qua công tắc `can_collect_transfer` như mọi role khác. */
export const PAYMENT_PHOTO_READ_ROLES = ['admin', 'order', 'kitchen', 'report'] as const;

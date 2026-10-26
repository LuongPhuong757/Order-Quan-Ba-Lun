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
// Ngoại lệ duy nhất: `report` XEM không cần công tắc — xem `xemAnhBillKhongCanCongTac`.

/** GHI (chụp / xoá ảnh). Đúng bằng tập role thu được tiền: `checkout` không gác role, và role
 *  chỉ-đọc `report` đã bị `JwtAuthGuard` chặn ở mọi phương thức ghi. */
export const PAYMENT_PHOTO_WRITE_ROLES = ['admin', 'order', 'kitchen'] as const;

/** ĐỌC (xem lại ảnh ở màn Lịch sử). Thêm `report`: nó không thu tiền nhưng có việc đối soát. */
export const PAYMENT_PHOTO_READ_ROLES = ['admin', 'order', 'kitchen', 'report'] as const;

/** Role XEM ảnh bill mà không cần công tắc `can_collect_transfer` (hotfix 2026-10-26, chủ quán
 *  chốt — đảo lại quyết định 2026-09-14 "report cũng phải được bật theo từng người").
 *
 *  Vì sao: công tắc kia mang tên "Thu chuyển khoản", mà `report` là role chỉ đọc, KHÔNG bao giờ thu
 *  được tiền. Thẻ Báo cáo mặc định tắt, chẳng ai nghĩ phải bật "thu tiền" cho người làm sổ sách
 *  → mở rộng đơn ở Lịch sử là ăn dòng đỏ "Không tải được ảnh bill". Việc của role này chính là
 *  đối soát, nên xem bill là quyền mặc định của nó.
 *
 *  Chỉ miễn cho ĐỌC: chụp/xoá ảnh vẫn qua công tắc, và `report` đằng nào cũng bị chặn mọi phương
 *  thức ghi ở `read-only-role.ts`. */
const XEM_ANH_BILL_KHONG_CAN_CONG_TAC = new Set<string>(['report']);

export function xemAnhBillKhongCanCongTac(role: string | null | undefined): boolean {
  return !!role && XEM_ANH_BILL_KHONG_CAN_CONG_TAC.has(role);
}

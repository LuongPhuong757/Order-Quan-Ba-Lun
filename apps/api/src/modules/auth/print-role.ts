// Luật chặn của role `print` — tài khoản dành riêng cho MÁY IN ở quầy.
//
// Vì sao phải CẤM MẶC ĐỊNH thay vì rải `RequireRoles` lên từng endpoint:
//
// `OrdersController` chỉ gắn `JwtAuthGuard` ở cấp lớp, và chỉ 6 trên 23 endpoint của nó có
// kiểm role. `POST /orders/:id/checkout` nằm trong số KHÔNG kiểm — nghĩa là mọi tài khoản đăng
// nhập được đều thanh toán được. Thêm một role theo cách thông thường là chiếc máy POS đặt ở
// quầy, máy mà ai đi ngang cũng chạm được, tự nhiên có quyền thanh toán và sửa món.
//
// Danh sách CHO PHÉP ngắn và đứng một chỗ thì đọc hết trong mười giây và không thể quên một
// endpoint nào — endpoint mới mặc định bị chặn, đúng chiều an toàn. Danh sách CẤM thì ngược
// lại: mỗi endpoint mới là một lần phải nhớ.
//
// Cùng khuôn `read-only-role.ts` và cắm vào CÙNG một chỗ (`JwtAuthGuard`), vì đó là điểm duy
// nhất mọi request đã đăng nhập đều đi qua.

export const PRINT_ROLE = 'print';

/**
 * Tiền tố được phép. Cố ý chỉ có hai nhóm:
 *  - `/print`  : việc của cầu in (`/print/next`, `/print/jobs/…`, `/print-pair`).
 *  - `/auth/`  : đăng xuất và đọc phiên hiện tại — thiếu thì không thoát ra được.
 */
const ALLOWED_PREFIXES = ['/print', '/auth/'] as const;

/**
 * `true` = chặn request này.
 *
 * So khớp không phân biệt hoa thường, vì Express định tuyến không phân biệt hoa thường: nếu
 * đây phân biệt thì `POST /Orders/123/checkout` lọt qua trong khi vẫn tới đúng controller —
 * đúng cái bẫy `pathRequiresCheck()` của CSRF đã dặn.
 */
export function isBlockedForPrintRole(role: string | null | undefined, rawPath: string): boolean {
  if (role !== PRINT_ROLE) return false;
  const path = rawPath.toLowerCase();
  return !ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p));
}

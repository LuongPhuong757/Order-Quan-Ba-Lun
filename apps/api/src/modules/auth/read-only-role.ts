// Chốt chặn GHI cho role chỉ-đọc (`report` — quyền xem báo cáo thống kê toàn quán).
//
// Vì sao chặn theo METHOD chứ không gate từng endpoint: chỉ đạo của chủ quán là role này
// "tuyệt đối không thao tác ghi gì vào DB". Gate từng endpoint là danh sách ĐEN — repo có
// hơn 60 route ghi, thêm route mới mà quên gate là thủng ngay và không có lỗi nào nổ ra để
// biết. Chặn theo method là danh sách TRẮNG: mặc định cấm, muốn mở phải khai tên rõ ràng ở
// `WRITE_ALLOWLIST` bên dưới. Route ghi mới thêm sau này tự động bị chặn.
//
// Đây là hàng rào THẬT (gõ thẳng URL, sửa request bằng DevTools, gọi curl đều chết), khác
// với việc ẩn nút ở web — ẩn nút chỉ để đỡ khó chịu, không phải bảo mật.

/** Role không được ghi bất cứ thứ gì. Thêm role chỉ-đọc mới thì khai ở đây. */
export const READ_ONLY_ROLES = new Set(['report']);

/** HTTP method không đổi dữ liệu. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Ngoại lệ DUY NHẤT: ghi nhưng không phải nghiệp vụ quán, mà là việc của chính tài khoản
 * đó — đăng xuất (thu hồi token của mình) và tự đổi mật khẩu của mình. Không có 2 cái này
 * thì role `report` đăng nhập vào rồi không thoát ra được. */
const WRITE_ALLOWLIST = new Set(['POST /auth/logout', 'POST /auth/change-password']);

/** Ngoại lệ thứ hai (chủ quán chốt 2026-10-23): role Báo cáo được lập PHIẾU NHẬP NHÁP.
 *
 * Người cầm hàng từ NCC về không phải lúc nào cũng là admin, nhưng chủ quán vẫn không muốn ai
 * ngoài admin đẩy được con số vào kho và công nợ. Nên mở đúng đường "nháp": phiếu role này tạo
 * ra luôn nằm ở CHỜ DUYỆT — chưa cộng kho, chưa cộng nợ — cho tới khi admin bấm Duyệt.
 *
 * Mở ở đây CHỈ là cho request đi qua cổng. Ba luật còn lại nằm ở `DeliveriesService` và mới là
 * hàng rào thật: phiếu tạo ra bị ép về chờ duyệt, chỉ đụng được phiếu nháp CỦA CHÍNH MÌNH, và
 * không được tạo mặt hàng mới. Cố ý KHÔNG có `/confirm` trong danh sách — duyệt là việc của admin.
 *
 * Viết thành regex chứ không phải chuỗi vì có `:id` ở giữa đường dẫn; mỗi mẫu neo `^…$` để
 * `/supplier-deliveries/x/confirm` không lọt qua mẫu của `/supplier-deliveries/:id`. */
const DRAFT_WRITE_PATTERNS: RegExp[] = [
  /^POST \/supplier-deliveries$/,
  /^PUT \/supplier-deliveries\/[^/]+$/,
  /^POST \/supplier-deliveries\/[^/]+\/(cancel|photos)$/,
  /^DELETE \/supplier-deliveries\/photos\/[^/]+$/,
];

/** Bỏ query string và dấu `/` thừa ở cuối để so khớp allowlist cho ổn định.
 * `/auth/logout/?x=1` và `/auth/logout` phải ra cùng một chuỗi. */
function normalizePath(path: string): string {
  const noQuery = path.split('?')[0]!.split('#')[0]!;
  const trimmed = noQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** `true` = phải chặn (403). Dùng ở `JwtAuthGuard` — chốt chặn duy nhất mà MỌI request đã
 * đăng nhập đều đi qua, kể cả route chỉ gắn `AdminGuard` (guard đó tự gọi JwtAuthGuard). */
export function isBlockedWrite(
  role: string | null | undefined,
  method: string,
  path: string,
): boolean {
  if (!role || !READ_ONLY_ROLES.has(role)) return false;
  const verb = method.toUpperCase();
  if (SAFE_METHODS.has(verb)) return false;
  const route = `${verb} ${normalizePath(path)}`;
  if (WRITE_ALLOWLIST.has(route)) return false;
  return !DRAFT_WRITE_PATTERNS.some((p) => p.test(route));
}

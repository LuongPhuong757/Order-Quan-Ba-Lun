// T-08-32 (HIGH) — pathRequiresCheck() tách khỏi csrf-origin.middleware.ts thành module thuần
// để test được không cần dựng app (theo khuôn origin-allowlist.ts).
//
// Đọc kỹ 3 điều trước khi sửa hàm này:
//
// 1) Hàm này CHỈ trả lời "path này có cần kiểm Origin không". Việc lọc theo method
//    (chỉ POST/PUT/PATCH/DELETE) do `CsrfOriginGuard.use()` làm TRƯỚC khi gọi hàm này —
//    vì vậy `GET /api/public/menu` không bao giờ chạm tới đây, dù hàm trả `true` cho
//    path đó (xem test "không phân biệt method").
//
// 2) TRƯỚC phase 8, hàm này chỉ phủ `/admin/*` và `/auth/*` — KHÔNG phủ `/api/public/*`.
//    Nghĩa là `POST /api/public/orders` (endpoint submit đơn, plan 08-10) từng sống mà
//    không có lớp phòng thủ Origin nào: bất kỳ site nào trên internet cũng auto-submit
//    form tới nó mà không bị chặn — phòng thủ tụt từ 2 lớp (Origin + rate-limit/blacklist)
//    xuống còn 1 lớp. Đây là lỗ hổng severity HIGH có sẵn trong repo (không do phase 8 tạo
//    ra), xem `08-RESEARCH.md` Pitfall #1. Nhánh `startsWith('/api/public/')` dưới đây tồn
//    tại để đóng lỗ hổng đó TRƯỚC khi endpoint submit ra đời.
//
// 3) `apps/shop` gọi API cùng-origin (`order.<domain>`) nên request thật từ trình duyệt
//    luôn kèm header `Origin` hợp lệ trên mọi mutation — không lo chặn nhầm khách thật.
export function pathRequiresCheck(rawPath: string): boolean {
  // SEC — Express route KHÔNG phân biệt hoa/thường (mặc định `case sensitive routing` = off),
  // nên `POST /API/public/orders` vẫn tới đúng controller. Nếu so khớp ở đây phân biệt
  // hoa/thường thì viết hoa 1 chữ là né được toàn bộ Origin check. Hạ về chữ thường trước.
  const path = rawPath.toLowerCase();
  // Mutations on /admin/* and /auth/* (except login, which needs to work pre-auth)
  if (path.startsWith('/admin/')) return true;
  if (path.startsWith('/auth/')) {
    // /auth/login is public + rate-limited; CSRF not applicable (no cookie yet at login).
    // `/auth/recover` từng là ngoại lệ thứ hai — đã bỏ endpoint 2026-11-09 nên bỏ luôn ngoại lệ:
    // để lại là một đường /auth/* POST không bị kiểm Origin mà không ai dùng.
    if (path === '/auth/login') return false;
    return true;
  }
  // T-08-32 — mutations tới /api/public/* (vd POST /api/public/orders) phải bị kiểm Origin
  // giống hệt /admin/* /auth/*. Dấu '/' sau 'public' bắt buộc để không khớp oan path lỏng
  // kiểu '/api/publicfoo'.
  if (path.startsWith('/api/public/')) return true;
  return false;
}

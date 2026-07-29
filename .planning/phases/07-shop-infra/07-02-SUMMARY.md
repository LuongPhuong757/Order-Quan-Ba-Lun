---
phase: 07-shop-infra
plan: 02
status: complete
completed: 2026-07-29
requirements: [REQ-Q]
files_modified:
  - apps/api/src/common/origin-allowlist.ts
  - apps/api/src/common/origin-allowlist.test.ts
---

# Plan 07-02 — Harness test + origin allow-list (TDD)

## Kết quả

2/2 task xong. `apps/api` từ **0 test → 18 test**, chạy zero-config, không thêm file config nào.

## Bằng chứng TDD

Test viết trước, xác nhận đỏ:

```
$ pnpm test
FAIL  src/common/origin-allowlist.test.ts
Error: Failed to load url ./origin-allowlist.js (resolved id: ./origin-allowlist.js) — Does the file exist?
Test Files  1 failed (1)
     Tests  no tests
```

Sau khi viết implementation:

```
$ pnpm test
✓ src/common/origin-allowlist.test.ts (18 tests) 6ms
Test Files  1 passed (1)
     Tests  18 passed (18)

$ pnpm typecheck        → pass
```

## Nội dung test (18 case, 5 nhóm)

| Nhóm | Case chính |
|---|---|
| `parseAllowedOrigins` | 1 origin · 2 origin · trim khoảng trắng · bỏ `/` cuối · bỏ phần tử rỗng · rỗng/undefined |
| Chặn prefix-spoofing | `quanbalun.site.evil.com` · `quanbalun.sitex.com` · `evil.quanbalun.site` — **cả 3 phải false** |
| Cho qua đúng origin | apex · `order.` (mục đích M2.D-67) · Referer mang path+query |
| Protocol/port | khác protocol chặn · khác port chặn · cả 2 port trong list thì qua |
| Đầu vào rác | `not-a-url` không throw · rỗng/undefined · list rỗng chặn tất |

## Quyết định triển khai

- Dùng `url.host` (**có** port) chứ không phải `url.hostname` — cần phân biệt `localhost:5173` (admin) với `localhost:5174` (shop). Nếu dùng `hostname` thì 2 app local coi như cùng origin, test "khác port" sẽ đỏ.
- Chuẩn hoá **cả hai phía** qua cùng `normalizeOrigin()`, nên `'https://a.com/'` trong biến môi trường vẫn khớp `'https://a.com'` từ header.
- `new URL()` bọc `try/catch` trả `null` → middleware không cần bọc try/catch (D-09).
- Module thuần: không import `@nestjs/*` hay `express`. Đây là lý do test chạy 6ms mà không cần dựng app.

## Chưa làm (đúng phạm vi)

Harness integration MySQL thật cho M2.D-06 (row lock) và M2.D-01 (đếm doanh thu) là **phase 9** — mock không chứng minh được row lock. Phase 7 chỉ dựng phần thuần (D-20).

## Ảnh hưởng tới phase sau

Đây là **test API đầu tiên của repo**, nên nó là pattern mẫu: file `.test.ts` cạnh source, import đuôi `.js`, `describe`/`it` tiếng Việt, không config. Phase 8/9 thêm test thì theo đúng kiểu này.

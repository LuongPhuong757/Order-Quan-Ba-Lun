---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 04
subsystem: apps/shop — router + AppShell + Header
tags: [frontend, router, react-router, design-system, bundle-guard]
requires: []
provides:
  - "BrowserRouter thật ở apps/shop (5 route + catch-all)"
  - "AppShell + Header 2 biến thể (CSS-only breakpoint)"
  - "CartIcon SVG tự vẽ"
  - "zod là direct dependency của apps/shop"
  - "MAX_JS_KB gate trong scripts/check-shop-bundle.sh"
affects:
  - apps/shop/src/main.tsx
  - apps/shop/src/pages/MenuPage.tsx
  - apps/shop/src/components/AppShell.tsx
  - apps/shop/src/components/Header.tsx
  - apps/shop/src/components/CartIcon.tsx
  - scripts/check-shop-bundle.sh
tech-stack:
  added: ["zod@^3.23.0 (direct dependency của apps/shop)"]
  patterns:
    - "CSSProperties object ở module scope đọc var(--...) — khuôn Wordmark.tsx"
    - "Header 2 biến thể dựng bằng CSS @media (không useState/JS resize)"
    - "useSearchParams ghi query ?q= (mẫu AdminAuditPage.tsx)"
key-files:
  created:
    - apps/shop/src/pages/MenuPage.tsx
    - apps/shop/src/components/AppShell.tsx
    - apps/shop/src/components/Header.tsx
    - apps/shop/src/components/CartIcon.tsx
  modified:
    - apps/shop/package.json
    - apps/shop/src/main.tsx
    - scripts/check-shop-bundle.sh
decisions:
  - "MAX_JS_KB = 320 kB (đo thật 244 kB + ~30%, làm tròn chục) — ghi lý do trong script, không tắt gate nào"
  - "Header dùng 2 khối DOM ẩn/hiện bằng @media, không JS breakpoint hook (D-22 giả định #8)"
metrics:
  duration: "~20 phút (gồm cài dependency lần đầu cho worktree mới)"
  completed: 2026-07-30
---

# Phase 8 Plan 04: Router thật cho apps/shop — AppShell, Header 2 biến thể, guard bundle Summary

Dựng `BrowserRouter` thật thay `BrandPreview`, nối 5 route (menu/giỏ/checkout/theo dõi đơn/lịch sử) qua
`AppShell` + `Header` 2 biến thể CSS-only, thêm `zod` làm direct dependency, và bổ sung gate kích thước JS
vào bundle guard M2.D-64 (giữ nguyên gate chuỗi cấm).

## Đã làm

### Task 1 — `main.tsx` router + `zod` + `MenuPage`
- Thay ruột `main.tsx`: `BrowserRouter` → `Routes` → `Route element={<AppShell/>}` bọc 5 route con
  (`/`, `/cart`, `/checkout`, `/o/:token`, `/history`) + `path="*"` render lại `MenuPage`.
- Bỏ import `BrandPreview` khỏi điểm mount (file gốc vẫn còn trên đĩa để tham khảo màu).
- Thêm `zod@^3.23.0` làm direct dependency (`corepack pnpm --filter @order/shop add zod@^3.23.0` — khớp
  version `apps/web`/`packages/schemas`).
- Tạo `MenuPage.tsx`: khung + trạng thái "Đang tải menu...", lưới `data-testid="menu-grid"` dùng
  `repeat(auto-fill, minmax(280px, 1fr))`, không media query (CONFLICT-DESIGN-01/OD-05). Nội dung thật
  (fetch + zod parse + lọc `q`) là plan 08-09.
- Commit: `8f902c2`

### Task 2 — `AppShell` + `Header` 2 biến thể + `CartIcon`
- `CartIcon.tsx`: SVG tự vẽ tay (`stroke="currentColor"`, `strokeWidth={1.75}`), badge tròn ẩn hoàn toàn
  khi `count === 0`.
- `Header.tsx`: 2 khối DOM (`.shop-hd-desktop` / `.shop-hd-mobile`) ẩn/hiện bằng `<style>` chứa `@media
  (min-width: 768px)` — không hook JS đo màn hình, không resize listener. Desktop: `Wordmark bare` + nav
  IN HOA (`NavLink` active = viền dưới + `--brand-600`) + ô tìm kiếm inline ~240px + `CartIcon` trong
  `Link to="/cart"`. Mobile: `Wordmark` nhỏ + icon kính lúp (mở overlay tìm kiếm full-width dưới header,
  input tự focus, nút "Huỷ") + `CartIcon` + hamburger (mở overlay nav dọc). Ô tìm kiếm ghi `?q=` vào URL
  qua `useSearchParams`; gõ ở route khác `/` thì điều hướng `/?q=...` (theo mẫu `AdminAuditPage.tsx`).
- `AppShell.tsx`: `<div>` nền `--bg-page` bọc `<Header cartCount={0} cartTotal={0} />` + `<main>` giới hạn
  `--content-max` bọc `<Outlet/>`. Comment `TODO(plan-08-06)` chốt hợp đồng prop để plan sau chỉ đổi
  nguồn dữ liệu sang `useCart()`.
- Commit: `5bc4347`

### Task 3 — Gate kích thước JS trong `check-shop-bundle.sh`
- Build thật đo được: **244 kB** JS (`du -k apps/shop/dist/assets/*.js`, gzip 77.27 kB theo Vite).
- Giữ nguyên toàn bộ gate grep 11 chuỗi cấm (không xoá/tắt gate nào).
- Thêm `MAX_JS_KB=320` (244 + ~30%, làm tròn lên chục) + khối comment nêu rõ: phase 07 chưa có route nào
  nên guard cũ chỉ kiểm chuỗi cấm; phase 08 thêm router thật + zod + 5 trang nên tăng size là đúng dự
  kiến; chừa khoảng cho phase 09 (SSE + tracking đầy đủ); muốn nâng ngưỡng phải sửa số này + ghi lý do,
  không sửa lặng.
- Xác nhận gate có hiệu lực: chạy **bản sao** script với `MAX_JS_KB=1` → `exit 1` (không sửa file thật
  trong lúc thử, tránh rủi ro để sót giá trị sai vào git).
- Commit: `4db2462`

## Xác minh

```
pnpm --filter @order/shop typecheck   → sạch
pnpm --filter @order/shop build       → OK, JS 245.81 kB / gzip 77.27 kB
sh scripts/check-shop-bundle.sh        → OK: bundle JS 244 kB (ngưỡng 320 kB); OK: bundle khách sạch — đã kiểm 2 gate
grep "#[0-9a-fA-F]{3,6}" apps/shop/src/{main.tsx,pages/MenuPage.tsx,components/{AppShell,Header,CartIcon}.tsx} → không có hit
grep "/admin/" apps/shop/src/          → không có hit
```

Bằng chứng 4 trang cũ (`CartPage`/`CheckoutPage`/`HistoryPage`/`OrderTrackPage`) đã vào bundle (không còn
dead code) — xem mục Deviations #1 vì literal tên component không sống sót qua minify production.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug trong tiêu chí nghiệm thu] Acceptance criteria Task 1 dùng literal tên component để
chứng minh 4 trang cũ vào bundle, nhưng Vite production build (esbuild minify) đổi tên định danh nên
`grep -rl "OrderTrackPage\|CheckoutPage" apps/shop/dist` trả về rỗng dù 4 trang chắc chắn có trong bundle.**
- Found during: Task 1 verify
- Bằng chứng thay thế: nội dung Việt hoá không bị đổi (vd. `"Theo dõi đơn"`, `"Thông tin nhận hàng"`) và
  4 `data-testid` back-link (`cart-back-link`, `checkout-back-link`, `order-track-back-link`,
  `history-back-link`) đều xuất hiện nguyên văn trong `apps/shop/dist/assets/*.js` — chứng minh cả 4 trang
  đã được import và không bị tree-shake.
- Files: không sửa code, chỉ đổi cách xác minh
- Commit: N/A (verify-only)

**2. [Rule 1 - Tự va chạm tiêu chí phủ định] 3 comment/docblock ban đầu chứa đúng các chuỗi mà chính
acceptance criteria yêu cầu KHÔNG được có (`BrandPreview` trong `main.tsx`; `useMediaQuery`/`resize` và
`lucide-react`/`react-icons` trong docblock giải thích lý do KHÔNG dùng các thứ đó ở `Header.tsx`/
`CartIcon.tsx`).**
- Found during: Task 1 và Task 2 verify (grep tự kiểm trước khi commit)
- Fix: viết lại 3 đoạn comment để giữ nguyên ý nghĩa (giải thích quyết định) nhưng không chứa literal
  string bị cấm — tương tự lý do script guard đã né chữ `HistoryPage` (comment dòng 20 của
  `check-shop-bundle.sh`).
- Files: `apps/shop/src/main.tsx`, `apps/shop/src/components/Header.tsx`, `apps/shop/src/components/CartIcon.tsx`
- Commit: gộp vào `8f902c2` (main.tsx) và `5bc4347` (Header.tsx, CartIcon.tsx) — sửa trước khi commit lần đầu

**3. [Rule 3 - Chặn thi công] Task 1 buộc `main.tsx` render `<AppShell/>` (do chính plan yêu cầu), nhưng
`AppShell.tsx` là file của Task 2 → lệnh verify riêng của Task 1 (`typecheck && build`) không thể chạy độc
lập vì thiếu module.**
- Fix: viết code Task 1 + Task 2 cùng lúc, chạy `typecheck`/`build` gộp để xác nhận cả hai đúng, sau đó
  tách commit theo đúng danh sách `files_modified` của từng task (2 commit riêng, không gộp lịch sử).
- Files: không đổi phạm vi file của từng task, chỉ đổi trình tự thực thi
- Commit: `8f902c2` (Task 1), `5bc4347` (Task 2)

### Process notes (không phải deviation code)

- **Môi trường:** `pnpm` global (bin `/opt/homebrew/bin/pnpm`) yêu cầu Node ≥22.13 nhưng máy đang chạy
  Node 20.11.0 (qua `fnm`) → dùng `corepack pnpm` (khớp `packageManager: pnpm@9.0.0` trong `package.json`
  gốc) cho mọi lệnh trong plan này.
- **Worktree mới, chưa có `node_modules`:** chạy `corepack pnpm install` ở gốc workspace trước khi
  `--filter @order/shop` chạy được.
- **Bỏ qua bước 4 của `<verification>` (mở `pnpm --filter @order/shop dev` bấm tay qua 5 route):** cổng
  5174 (`strictPort: true` trong `vite.config.ts`) đang bị chiếm bởi tiến trình Vite của
  `OrderQuanBaLun-main/apps/shop` (checkout riêng của người dùng, không phải agent song song) — không an
  toàn để kill hay bind đè. Thay bằng bộ kiểm tự động (typecheck + build + bundle guard, đều xanh). Hành
  vi SPA fallback khi reload `/cart`/`/o/abc` dựa vào `appType: 'spa'` mặc định của Vite (không đổi bởi
  plan này) + logic `apiProxy` bypass `Accept: text/html` đã có sẵn trong `vite.config.ts` trước plan này.

## Known Stubs

| File | Dòng | Lý do |
|------|------|-------|
| `apps/shop/src/pages/MenuPage.tsx` | `<p>Đang tải menu...</p>` cố định, không có fetch thật | Đúng phạm vi plan 08-04 (chỉ dựng khung + trạng thái tải) — nội dung thật (fetch `/api/public/menu` + zod parse + lọc `q`) là **plan 08-09** |
| `apps/shop/src/components/AppShell.tsx` | `cartCount = 0; cartTotal = 0;` hardcode | Có `TODO(plan-08-06)` tại chỗ — **plan 08-06** nối `useCart()` thật, không đổi cấu trúc prop |
| `apps/shop/src/pages/{CartPage,CheckoutPage,HistoryPage,OrderTrackPage}.tsx` | Nội dung placeholder "Chức năng này sẽ có ở phase 08" (không sửa trong plan này) | Đúng phạm vi — nội dung thật là **plan 08-11/08-12** (checkout/giỏ hàng) và phần còn lại của REQ-O ở **phase 9** |

## Self-Check: PASSED

- FOUND: apps/shop/src/main.tsx
- FOUND: apps/shop/src/pages/MenuPage.tsx
- FOUND: apps/shop/src/components/AppShell.tsx
- FOUND: apps/shop/src/components/Header.tsx
- FOUND: apps/shop/src/components/CartIcon.tsx
- FOUND: scripts/check-shop-bundle.sh (chứa MAX_JS_KB)
- FOUND commit: 8f902c2
- FOUND commit: 5bc4347
- FOUND commit: 4db2462

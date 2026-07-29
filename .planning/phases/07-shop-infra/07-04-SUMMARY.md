---
phase: 07-shop-infra
plan: 04
status: complete
completed: 2026-07-29
requirements: [REQ-Q]
files_modified:
  - scripts/check-shop-bundle.sh
  - Caddyfile
  - .planning/phases/07-shop-infra/07-UAT.md
unplanned_findings:
  - "4 trang placeholder của apps/shop CHƯA được gắn vào router — main.tsx còn TODO(task-10), chúng là dead code"
  - "Guard bundle hiện gần như vô nghĩa vì bundle shop chưa chứa route nào"
---

# Plan 07-04 — Bundle guard + Caddy site block

## Kết quả

3/3 task xong. Nhưng có một phát hiện làm giảm giá trị của criterion M2.D-64 ở thời điểm này — xem phần dưới.

## Task 1 — `scripts/check-shop-bundle.sh`

Guard kiểm 11 chuỗi chỉ có ở trang quản lý: `/dashboard`, `/kitchen`, `/admin/`, `DashboardPage`, `KitchenPage`, `TablesManagementPage`, `MenuManagementPage`, `AdminAuditPage`, `AdminUsersPage`, `SetupPage`, `RecoverPage`.

`HistoryPage` **cố tình không** đưa vào danh sách — `apps/shop` cũng có page tên đó, sẽ báo giả.

```
$ pnpm --filter @order/shop build && sh scripts/check-shop-bundle.sh
OK: bundle khách sạch (đã kiểm 11 chuỗi trong apps/shop/dist)
exit=0
```

### Thử ngược — và lần đầu THẤT BẠI

Plan yêu cầu chứng minh guard bắt được rò thật. Hai lần đầu **không bắt được**, và đó là thông tin quan trọng:

**Lần 1** — thêm `export const __leakTest = "/dashboard";` vào `CartPage.tsx`:
```
build → index-CWCvEb38.js  194.87 kB   ← hash Y NGUYÊN
guard → OK, exit=0
```
Vite tree-shake export không ai dùng. Không phải rò thật.

**Lần 2** — sửa thành `<Link to="/dashboard">` trong JSX của `CartPage.tsx`:
```
build → index-CWCvEb38.js  194.87 kB   ← vẫn Y NGUYÊN
guard → OK, exit=0
```
Hash không đổi sau khi sửa source là dấu hiệu file đó **không nằm trong bundle**.

**Lần 3** — sửa chuỗi trong `main.tsx` (code thật sự reachable):
```
build → index-CjZPFfsM.js  194.89 kB   ← hash ĐỔI
guard → LEAK: '/dashboard' xuất hiện trong bundle khách: apps/shop/dist/assets/index-CjZPFfsM.js
        LEAK: '/kitchen' xuất hiện trong bundle khách: apps/shop/dist/assets/index-CjZPFfsM.js
        M2.D-64 bị vi phạm: trang khách đang tải được code quản lý.
exit=1
```

Hoàn nguyên `main.tsx` → hash về `index-CWCvEb38.js`, guard `OK`, `git status apps/shop` sạch.

**Guard hoạt động đúng.** Nhưng hành trình để chứng minh nó lại lộ ra vấn đề sau.

## Phát hiện ngoài kế hoạch: 4 trang placeholder chưa được gắn router

`apps/shop/src/main.tsx` render một `<main>` tĩnh với chữ *"Trang khách đang được dựng — phase 07"* và còn nguyên:

```
// TODO(task-10): thay bằng BrowserRouter + App shell (AppShell + AppHeader 2 biến thể).
// Task 01 chỉ cần một điểm mount chạy được để package build xanh từ wave 1.
```

Nghĩa là `CartPage`, `CheckoutPage`, `HistoryPage`, `OrderTrackPage` **tồn tại như file nhưng không được import ở đâu** — dead code, bị tree-shake, không vào bundle. `react-router-dom` là dependency nhưng chưa được dùng.

Điều này **mâu thuẫn với intel đã ingest**: `.planning/intel/requirements.md` § REQ-Q ghi *"`apps/shop` — Vite + React mới, dùng chung `packages/schemas` — **DONE** (verified in codebase: `apps/shop/src/pages/{Cart,Checkout,History,OrderTrack}Page.tsx`)"*. Lần verify đó kiểm **file có tồn tại**, không kiểm **file có được dùng**.

**Hệ quả:**
1. Tiến độ thật của phase 07 còn ít hơn con số "~1/3" đã ghi. Task 10 của kế hoạch VGFlow cũ (gắn router) chưa từng làm.
2. Criterion M2.D-64 ("bundle khách không chứa route quản lý") hiện **pass một cách gần như vô nghĩa** — bundle shop chưa có route nào cả. Guard chỉ thật sự có giá trị từ phase 8, khi shop có router + trang thật.

**Em không tự gắn router.** Phase boundary trong `07-CONTEXT.md` ghi rõ *"4 trang giữ nguyên dạng placeholder, mọi UI thật là phase 8/9"*, và dựng `BrowserRouter` + AppShell là việc UI có ảnh hưởng thiết kế (2 biến thể header) — thuộc phase 8, nên làm sau khi chốt logo/màu và giải quyết CONFLICT-DESIGN-01. Đã ghi thành việc phải làm đầu phase 8.

## Task 2 — Caddy site block `order.<domain>`

Thêm block mới **bên dưới** block apex, không gộp hostname.

```
$ grep -n 'geolocation' Caddyfile
23:  Permissions-Policy "geolocation=(), camera=(self), microphone=()"      ← apex, KHÔNG đổi
55:  Permissions-Policy "geolocation=(self), camera=(), microphone=()"      ← order.

$ grep -n 'Referrer-Policy' Caddyfile
22:  Referrer-Policy "strict-origin-when-cross-origin"                     ← apex
53:  Referrer-Policy "no-referrer"                                         ← order. (C-INFRA-03)

$ grep -c '^order.{$DOMAIN} {' Caddyfile   → 1
$ grep -c 'www.order' Caddyfile            → 0
```

`Referrer-Policy: no-referrer` ở block `order.` là phần **spec không nói** — lấy từ C-INFRA-03: `order_token` là bearer credential nằm ngay trong URL `/o/<token>`, thiếu header này thì token rò sang site ngoài qua `Referer`. Nếu làm đúng chữ spec thì mất.

## Chưa verify được

**Cú pháp Caddyfile chưa validate.** Máy dev không có `caddy` CLI, cũng không có Docker → không chạy được `caddy validate`. Chỉ kiểm được bằng grep như trên. Đã đưa vào `07-UAT.md` test 7 với cảnh báo: phải validate **trước** khi reload Caddy production, vì cú pháp sai làm Caddy không khởi động lại được → cả apex lẫn `order.` cùng down.

## Task 3 — `07-UAT.md`

7 hạng mục (5 theo kế hoạch + 2 phát sinh: `docker build`, `caddy validate`), mỗi hạng mục có lệnh kiểm cụ thể trên production, phương án thay thế đã chạy ở local, và thứ tự thực hiện bắt buộc.

## Không chạm production

Không deploy, không ssh, không `docker compose up`, không reload Caddy, không sửa DNS. `Caddyfile` chỉ là text trong repo.

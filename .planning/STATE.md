---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Milestone 2 — Đặt hàng online
status: executing
stopped_at: Phase 09 plan 10 xong (code+test) — CÒN 3 kịch bản trình duyệt chưa chạy, xem 09-10-SUMMARY
last_updated: "2026-08-01T18:20:00.000Z"
last_activity: 2026-08-01 -- plan 09-10 complete-with-gap (tiếp 09-11)
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 30
  completed_plans: 21
  percent: 70
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-29)

**Core value:** Khách đặt được món từ xa mà quán không bao giờ bỏ lọt đơn, và đơn chưa duyệt không bao giờ lẫn vào bếp / sơ đồ bàn / doanh thu.
**Current focus:** Phase 09 — duy-t-n-th-ng-b-o-theo-d-i-n

*Progress đếm theo Milestone 2 (4 phase). Milestone 1 (phases 1–6) đã ship dưới VGFlow.*

## Current Position

Phase: 09 (duy-t-n-th-ng-b-o-theo-d-i-n) — EXECUTING
Plan: 10 of 13 xong (hết wave 5). Tiếp theo: 09-11 (wave 6) — trang khách /o/:token
Status: Executing Phase 09
Last activity: 2026-08-01 -- plan 09-10 complete-with-gap

Progress Phase 09: [████████░░] 77% (10/13 plan)

> ⚠ VIỆC CHƯA LÀM của 09-10: 3 kịch bản nghiệm thu trên trình duyệt (3 role vào được · chuông có
> tiếng thật · SSE đứt 10s hiện banner rồi tự nối lại). Code + test + build đã xanh, nhưng chưa ai
> mở trang bằng mắt. Chi tiết cách kiểm ở `09-10-SUMMARY.md` § "3 kịch bản trên trình duyệt".

> Lưu ý khi đọc `gsd-tools query roadmap.analyze`: nó báo `progress_percent` cao vọt vì chỉ tính
> trên phase ĐÃ CÓ plan. Con số đúng cho Milestone 2 là 2/4 phase + phase 09 đang dở.

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Full log ở PROJECT.md § Key Decisions. Quyết định ảnh hưởng việc đang làm:

- [Ingest]: Milestone 2 **LOCAL ONLY** — 5 criteria production → deferred UAT, không phải blocker trong phase
- [Ingest]: Mở rộng M2.D-67 sang so khớp host chính xác bằng `new URL()` (C-SEC-01) — thuộc phạm vi Phase 7
- [Ingest]: Test = tách hàm thuần (zero-config vitest, Phase 7) + harness integration MySQL thật (Phase 9)
- [Ingest]: Poller outbox dùng `@nestjs/schedule` in-process, hồi sinh luôn 2 cron đang chết (Phase 9)
- [Ingest]: Success criteria Phase 7 là bản dựng lại — `.vg/ROADMAP.md` **chưa bao giờ** có Phase 07 (chỉ 6 phase từ `f5f9e4a` tới `07cad95`)
- [Ingest]: M2.D-60 ghi đè M2.D-36 — auto-OFF `1800s`. Pseudo-code spec:469 còn ghi `300s` là **stale, không implement**
- [Phase 08-13]: OVERRIDE-DEBT.md OD-06..OD-10 (3 đã biết + 2 phát sinh sau wave 6); 08-UAT.md 5 hạng mục, test 1 (sharp/Docker) là gate bắt buộc trước deploy production — Đóng threat T-08-73 (override im lặng) cho toàn phase 8, không chỉ 3 lệch đã biết trước
- [Phase 08-13]: Checkpoint 08-13 Task 3 approved 2026-07-31 — chủ dự án tự kiểm đủ 15 bước, không báo bước nào sai — 08-VALIDATION.md § Approval: approved; phạm vi CHỈ áp cho luồng local, 5 hạng mục 08-UAT.md (gate sharp/Docker) vẫn deferred

### Pending Todos

- Lưu 5 file PNG design ref vào `docs/design-refs/lotteria/` (đặc tả đã rút xong nên không block)
- Tạo `OVERRIDE-DEBT.md` mà spec §28/§134 yêu cầu — chuỗi override M2.D-59/60 hiện chỉ ghi ở `.planning/intel/decisions.md`
- `deploy.sh` vẫn untracked (cố ý — đọc secret từ `.env.deploy` đang gitignore)
- Sửa spec §7 dòng 469 (`300s` → `1800s`) hoặc để nguyên và tin vào cảnh báo C-FLOW-01

### Blockers/Concerns

- **VIỆC ĐẦU PHASE 8 — `apps/shop` chưa có router.** `main.tsx` render một `<main>` tĩnh, còn nguyên `TODO(task-10)`. 4 trang `CartPage`/`CheckoutPage`/`HistoryPage`/`OrderTrackPage` tồn tại nhưng **không được import ở đâu** → dead code, bị tree-shake, không vào bundle. Intel ingest ghi "DONE" là do chỉ verify file tồn tại, không verify file được dùng. Kéo theo: criterion M2.D-64 hiện pass gần như vô nghĩa (bundle shop chưa có route nào), guard chỉ có giá trị thật từ phase 8.
- **Bug production đã sửa ở phase 7, cần biết khi review:** `apiPrefixes` thiếu `/api` làm mọi `GET /api/*` trả `index.html` ở production (Nest mount router trong `app.init()`, sau `app.use()`). Có từ Milestone 1, chưa ai gặp vì `/api/public/health` là endpoint `/api/*` đầu tiên.
- **`.env.production` thật trên VPS phải có `ALLOWED_ORIGIN`** — `docker-compose.prod.yml:62` đã truyền biến này nhưng file mẫu trước đây không khai báo; để trống → admin bị 403 toàn bộ mutation.
- **Tên miền chưa nhất quán:** `.env.production.example` dùng `quanbalun.com`, spec M2 + `.planning/` dùng `quanbalun.site`. Chốt một cái trước khi deploy.
- **Máy dev không có Docker lẫn `caddy` CLI** → `docker build` và `caddy validate` chưa từng chạy. Đã đưa vào `07-UAT.md` test 6 và 7.

- **Phase 8 gate — MÀU: ĐÃ CHỐT 2026-07-30.** Bảng màu rút từ 4 ảnh món ăn thật của quán, chủ quán duyệt. `tokens.css` + `DESIGN.md` đã đổi, ghi ở `OVERRIDE-DEBT.md` OD-04. Xem trực quan: `pnpm --filter @order/shop dev` → http://localhost:5174/
- **Phase 8 gate — LOGO: ĐÃ CHỐT 2026-07-30.** Dùng **wordmark chữ** (`apps/shop/src/components/Wordmark.tsx`, 2 biến thể `plaque`/`bare`) dựng theo biển phấn trong ảnh lẩu hải sản, + `apps/shop/public/favicon.svg` riêng. **KHÔNG** dùng `apps/web/public/logo.jpg` — file đó là ảnh chân dung cá nhân, không phải logo quán. Đổi sang logo ảnh thật sau: chỉ thay ruột `Wordmark.tsx`.
- **FONT: ĐÃ XONG 2026-07-30.** Self-host 12 file `.woff2` trong `apps/shop/public/fonts/` (Baloo 2 700/800 + Be Vietnam Pro 400/600 × latin/latin-ext/vietnamese), `apps/shop/src/styles/fonts.css` sinh tự động, `main.tsx` import trước `tokens.css`. Tổng 229 kB nhưng khách Việt chỉ tải ~74 kB nhờ `unicode-range`. Không gọi CDN. Đổi weight thì sửa `scratchpad/fetch-fonts.cjs` rồi chạy lại, đừng sửa `fonts.css` tay.
- **CONFLICT-DESIGN-01: ĐÃ CHỐT 2026-07-30 — 1 CỘT mobile** theo ảnh ref Lotteria (**lệch spec §8-bis** vốn ghi 2 cột → ghi ở `OVERRIDE-DEBT.md` OD-05). Thi công bằng `repeat(auto-fill, minmax(280px, 1fr))`, không media query: ~360px→1 cột, ~768px→2, ~1200px→4. Card rộng nên giữ được mô tả thành phần, giá + nút `+` cùng dòng. Chi tiết ở `docs/design-refs/lotteria/README.md`.
- **C-TEST-01**: repo có đúng 1 file test. 4 criteria đã LOCKED bắt buộc test tự động → harness là **việc phải làm**, không phải giả định.
- **C-INFRA-01**: SSE là transport mới trên codebase chỉ biết poll; pool MySQL 50 connection đang được size cho 2s poller. Thiết kế SSE đừng giữ connection mỗi subscriber.
- **C-SCHEMA-07**: `synchronize: true`, không migration. Thêm cột an toàn, nhưng **rename** cột mới sau này là mất dữ liệu im lặng.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| UAT | DNS A record `order.quanbalun.site` → IP VPS (M2.D-65) | Deferred | 2026-07-29 |
| UAT | TLS cert Caddy cho site block `order.` (M2.D-65) | Deferred | 2026-07-29 |
| UAT | `Permissions-Policy: geolocation=(self)` serve thật qua Caddy (M2.D-69) | Deferred | 2026-07-29 |
| UAT | Cookie host-only quan sát qua 2 hostname thật (M2.D-68) | Deferred | 2026-07-29 |
| UAT | `order.` trả `shop-dist` vs apex trả `web-dist` xuyên Caddy (M2.D-66) | Deferred | 2026-07-29 |
| v2 | Web Push (VAPID), Telegram bot, voice call L5 | Deferred | 2026-07-29 |
| v2 | Thanh toán online VietQR/chuyển khoản (M2.D-58 chốt COD) | Deferred | 2026-07-29 |
| **Hiệu năng** | **Quyết định bundle `apps/shop` — bàn lại SAU khi xong milestone 2** (chủ dự án chốt 2026-08-01, OD-12). Số liệu để quyết: raw 352 kB / gzip 103 kB / **1 chunk, chưa tách route lần nào**. 3 việc phải tách bạch: (a) nâng VPS **không** giúp gì — đây là chi phí trên máy khách, không phải trên server; (b) tách route bằng `React.lazy` là đòn chưa dùng; (c) cách đo hiện tại cộng tổng mọi chunk nên **không thấy được** hiệu quả của việc tách route — phải đổi sang đo chunk vào-đầu. Gate kích thước hiện chỉ `WARN`; gate 11 chuỗi cấm (bảo mật) **vẫn chặn**. | Deferred | 2026-08-01 |

## Session Continuity

Last session: 2026-07-31T05:29:51.575Z
Stopped at: Phase 9 planned — 13 plan / 8 wave, plan-checker APPROVED 0 blocker
Resume file: .planning/phases/09-duy-t-n-th-ng-b-o-theo-d-i-n/09-01-PLAN.md

## Bàn giao sang máy khác (viết 2026-07-30)

**Nhánh:** `feat/online-ordering`. Đã push tới commit `88bc067`.

### Dựng lại môi trường trên máy mới

1. `git clone` + `git checkout feat/online-ordering`
2. **Cài lại GSD** — harness KHÔNG nằm trong repo:
   ```
   npx -y @opengsd/gsd-core@latest --claude --local
   ```
   `.claude/gsd-core/` và `.claude/agents/` bị gitignore có chủ ý. Quan trọng hơn: các file
   `.claude/commands/gsd-*.md` chứa **đường dẫn tuyệt đối của máy cũ**
   (`@C:/Users/Admin/Desktop/QuanBaLun/...`) nên copy sang máy khác là hỏng — bắt buộc chạy
   installer để nó sinh lại theo đường dẫn máy mới.

3. `pnpm install` — **rồi `pnpm --filter @order/utils build`**. Thiếu bước build này thì
   `apps/api` không typecheck được (`Cannot find module '@order/utils'`).

4. `cp .env.example .env` rồi điền MySQL. Cần MySQL chạy sẵn (máy cũ dùng native cổng 3306;
   `docker-compose.yml` có mysql cổng 3307 nếu dùng Docker).

5. Kiểm tra nhanh: `pnpm -r typecheck` (5 project phải sạch) · `cd apps/api && pnpm test`
   (18/18 xanh) · `sh scripts/check-shop-bundle.sh` (in `OK`).

6. Xem trang khách: `pnpm --filter @order/shop dev` → http://localhost:5174/

### Tên command

GSD bản này cài command dạng phẳng: `/gsd-ui-phase`, `/gsd-plan-phase` (**gạch ngang**), không
phải `/gsd:...`. Nếu báo `Unknown command` thì reload cửa sổ VSCode.

### Hai thứ phase 8 phải làm TRƯỚC khi có trang menu thật

1. **`apps/shop` chưa có router.** `main.tsx` đang render `BrandPreview` (trang xem màu tạm).
   4 trang trong `src/pages/` là dead code, chưa import ở đâu. Phải dựng `BrowserRouter` +
   AppShell rồi xoá `BrandPreview.tsx`.

2. **`/api/public/menu` chưa tồn tại.** Chỉ có `/api/public/health`. Không có endpoint này thì
   trang menu không có gì để hiển thị.

### Nợ kỹ thuật đã biết, đừng phát hiện lại

- `docker build` và `caddy validate` **chưa từng chạy** — máy cũ không có Docker lẫn `caddy` CLI.
  Xem `07-UAT.md` test 6 và 7.

- `.claude/commands/` hiện untracked trên máy cũ (đã gỡ khỏi gitignore để loại nghi vấn slash
  command không được quét). Đừng commit nó — xem lý do đường dẫn tuyệt đối ở trên.

- Thư mục phase đặt tay là `07-shop-infra` vì slug tự sinh từ tên tiếng Việt bị băm thành
  `07-h-t-ng-trang-kh-ch`. GSD nhận theo tiền tố `07-` nên không sao. Phase 8 làm tương tự:
  tự tạo `.planning/phases/08-<tên-ascii>/`.

- Đọc `OVERRIDE-DEBT.md` trước khi sửa gì thuộc §8-bis hoặc CSRF — có 5 override đã ghi.

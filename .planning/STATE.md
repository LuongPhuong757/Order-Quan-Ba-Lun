---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-29)

**Core value:** Khách đặt được món từ xa mà quán không bao giờ bỏ lọt đơn, và đơn chưa duyệt không bao giờ lẫn vào bếp / sơ đồ bàn / doanh thu.
**Current focus:** Phase 7 — Hạ tầng trang khách (`apps/shop` + subdomain `order.`)

*Progress đếm theo Milestone 2 (4 phase). Milestone 1 (phases 1–6) đã ship dưới VGFlow.*

## Current Position

Phase: 7 of 10 (Hạ tầng trang khách) — phase 1 of 4 trong Milestone 2
Plan: 4 of 4 — tất cả complete (commit `886d797`)
Status: Executed — chờ `/gsd-verify-work 7`
Last activity: 2026-07-29 — execute phase 7 xong. 5 project typecheck sạch, 18/18 test xanh, bundle guard OK. 7 hạng mục deferred UAT ghi ở `07-UAT.md`

Progress: [██░░░░░░░░] 25% (1/4 phase Milestone 2)

Progress: [░░░░░░░░░░] 0%

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
- **CONFLICT-DESIGN-01: ĐÃ CHỐT 2026-07-30 — 2 CỘT mobile** theo spec §8-bis (không theo ref Lotteria 1 cột). Không lệch spec nên không cần ghi OVERRIDE-DEBT. Hệ quả khi code: card hẹp ~160px → tên 2 dòng ellipsis, mô tả ẩn dưới 768px, giá và nút `+` xếp 2 dòng. Chi tiết ở `docs/design-refs/lotteria/README.md`.
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

## Session Continuity

Last session: 2026-07-29
Stopped at: `/gsd-plan-phase 7` hoàn tất — `07-CONTEXT.md` + 4 PLAN.md trong `.planning/phases/07-shop-infra/`
Resume file: None — bước tiếp là `/gsd-execute-phase 7`

**Lưu ý về tên command:** GSD bản này cài command dạng phẳng nên là `/gsd-plan-phase` (gạch ngang), **không** phải `/gsd:plan-phase`. Thư mục phase đặt tay là `07-shop-infra` vì slug tự sinh từ tên tiếng Việt bị băm thành `07-h-t-ng-trang-kh-ch`; GSD nhận theo tiền tố `07-` nên không sao.

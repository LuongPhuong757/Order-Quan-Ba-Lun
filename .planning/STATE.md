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
Plan: chưa có plan nào — chờ `/gsd:plan-phase 7`
Status: Ready to plan
Last activity: 2026-07-29 — `/gsd:ingest-docs` chạy xong; 6 warning đã được chủ dự án quyết; PROJECT/REQUIREMENTS/ROADMAP/STATE sinh xong

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

- **Phase 8 có gate**: chốt logo + màu thương hiệu quán (thay `#E4453A` của Lotteria). Ảnh mobile đã có 2026-07-29.
- **CONFLICT-DESIGN-01**: lưới món mobile — ref thật của Lotteria là **1 cột**, spec §8-bis LOCKED ghi **2 cột**. Quyết ở `/gsd:ui-phase 8`; nếu lệch spec phải ghi `OVERRIDE-DEBT.md`.
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
Stopped at: `/gsd:ingest-docs` hoàn tất — 4 file planning đã sinh, 6 warning đã đóng, design ref mobile đã ghi nhận
Resume file: None — bước tiếp là `/gsd:plan-phase 7`

# Phase 07 — tiến độ thi công (cập nhật 2026-07-29)

**Nhánh:** `feat/online-ordering` — 9 commit ở local, **chưa bao giờ push**.
**Cách làm:** đọc `PLAN/task-NN.md` → viết code → chạy đúng lệnh verify task đó ghi → commit.
**KHÔNG chạy lệnh `/vg:*` nữa** (harness ngốn thời gian, 5 bug; xem `.vg/OVERRIDE-DEBT.md`).
**KHÔNG deploy, không push, không chạm VPS** — chủ quán chốt, mọi thứ test ở local.

## Đã xong

| Task | Nội dung | Commit |
|---|---|---|
| 01 | `apps/shop` thành workspace `@order/shop` (Vite 6 + React 19 + TS, port 5174) | `e132879` |
| 02 | `packages/utils` + `apiOk()` — package mới DUY NHẤT của M2 (P08.D-59 bỏ `packages/ui`) | `e132879` |
| 03 | `apps/api` khai `@order/utils` + `express@^4.21.0`, lockfile regen | `e132879` |
| 04 | `GET /api/public/health` dùng `apiOk` từ `@order/utils` | `37063cb` |
| 05 | 4 trang placeholder `/cart` `/checkout` `/o/:token` `/history` | commit sau 37063cb |

**Số đo đã kiểm:** bundle `@order/shop` = **61.11 kB gzip** (ngân sách 150 kB) ·
`grep /dashboard|/kitchen` trong bundle shop = **0** · typecheck `apps/api` + `apps/shop` xanh.

## Tiếp theo

1. **Task 07** — HomePage + `lib/api.ts` + `ShareLocationButton` (nút thử vị trí tạm, chỉ để
   verify quyền geolocation trên HTTPS thật). Đang dở: đã đọc header task, chưa viết code.
2. **Task 06 — ĐANG HOÃN** (chủ quán chốt): sửa Dockerfile 3 stage + `shop-dist`, kèm
   `docker build` local. **Phải làm trước Task 08** vì Task 08 cần `shop-dist` có trong image.
3. **Task 08 — RỦI RO CAO NHẤT.** Xoá `app.useStaticAssets(webDist)` trong `apps/api/src/main.ts`
   và viết lại middleware static theo `Host` + cho `/api/*` đi qua TRƯỚC nhánh `wantsHtml`.
   Chạm mọi page load của POS. **Câu hỏi chưa có trả lời: chủ quán có muốn xem diff trước khi
   commit không** (lần hỏi trước chọn "Other" nhưng nội dung về trống → HỎI LẠI).
4. Task 09 CSRF exact-origin + phủ `/api/admin/` · Task 10 router shell ·
   Task 11 Caddy site block · Task 12–13 harness verify local · Task 14 runbook DNS (chỉ VIẾT,
   không thực thi).

## Lưu ý môi trường (đã kiểm)

- Port **3001 bị process node khác chiếm** (PID 99500, không phải của project này) —
  **đừng kill**. Chạy API test bằng `API_PORT=3099`.
- MySQL local: container `order_quan_balun_mysql`, host port **3307** (xem `.env`).
- `pnpm` global đòi Node ≥22.13 nhưng runtime là v20.11.0 → **luôn dùng `corepack pnpm`**.
- Lệnh chạy API dev: `cd apps/api && API_PORT=3099 node --import @swc-node/register/esm-register src/main.ts`

## Phát hiện về Milestone 1 (ngoài phạm vi phase 07, chờ quyết riêng)

1. `cron-audit-retention` + `cron-jti-cleanup` **không chạy được trên production** (script cần
   `src/` + `@swc-node/register`, runtime image chỉ có `dist` + `--prod`) → retention 90 ngày của
   audit log (REQ-G) chưa bao giờ thực thi.
2. CSRF dùng `origin.startsWith(allowed)` — `'https://quanbalun.site.evil.com'` qua được.
   Task 09 sửa.
3. **REQ-A "nhóm hàng 3 cấp" chưa được đáp ứng** — `menu_group` không có `parent_id`.
4. **Repo có 0 file test** dù `apps/api/package.json` khai `"test": "vitest run"`.
5. Nhánh `db:'down'`/`degraded` trong `health.controller.ts` là **code chết** —
   `TypeOrmModule.forRoot` chặn bootstrap, hết 10 retry thì process chết nên endpoint không bao
   giờ trả `degraded`. Chi tiết trong `PLAN/task-04.md`.

## Việc của chủ quán (chưa xong, chặn phase 08)

- **Ảnh design lưới món trên mobile** — xem `.vg/design-refs/lotteria/README.md`. Đã có 4 ảnh
  (category desktop, cart desktop, cart mobile, item detail mobile), thiếu đúng lưới món mobile.
- **Màu thương hiệu** — `logo.jpg` hiện là ảnh chân dung, màu chủ đạo `#895852`/`#BC7D85` độ rực
  quá thấp để làm màu nhấn. Đang tạm dùng đỏ coral `#e4453a` của Lotteria.
- **DNS A record** `order.quanbalun.site` → IP VPS (Task 14, khi nào chịu deploy).

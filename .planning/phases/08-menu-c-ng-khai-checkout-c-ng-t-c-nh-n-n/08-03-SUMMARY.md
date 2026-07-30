---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 03
subsystem: api
tags: [sharp, image-processing, upload, webp, docker, pnpm]

# Dependency graph
requires:
  - phase: 08-02
    provides: baseline apps/api module structure phase 8 đang dùng
provides:
  - "sharp@0.35.3 là dependency native của apps/api, resize + nén webp lúc admin upload ảnh món"
  - "pnpm.supportedArchitectures khoá lockfile cho biến thể linux-musl (Docker alpine)"
  - "engines.node >=20.9.0 khớp yêu cầu thật của sharp"
affects: [08-13-deploy-uat, apps/shop-menu-image-loading]

# Tech tracking
tech-stack:
  added: ["sharp@^0.35.3"]
  patterns:
    - "memoryStorage() + xử lý buffer trong RAM trước khi ghi file (ASVS V12) thay vì diskStorage ghi file gốc chưa kiểm"
    - "Tên file luôn sinh 100% ở server (randomBytes) — không lấy ký tự nào từ input người dùng, kể cả phần mở rộng"

key-files:
  created: []
  modified:
    - package.json
    - apps/api/package.json
    - pnpm-lock.yaml
    - apps/api/src/modules/menu/menu.controller.ts

key-decisions:
  - "engines.node sửa từ >=20 thành >=20.9.0 — đúng yêu cầu thật của sharp, tránh cài 'thành công' trên Node cũ rồi lỗi runtime khó hiểu"
  - "pnpm.supportedArchitectures đặt ở root package.json (không phải .npmrc) — đây là vị trí pnpm tài liệu hoá, .npmrc supportedArchitectures[]= là cú pháp npm"
  - "Docker build với sharp CHƯA verify được trên máy dev (không có Docker) — deferred UAT bắt buộc trước deploy production"

patterns-established:
  - "Bước resize ảnh luôn xảy ra ở BE ngay trước khi ghi file, dùng memoryStorage — không tin canvas-resize phía client"

requirements-completed: [REQ-I]

# Metrics
duration: ~20min
completed: 2026-07-30
---

# Phase 08 Plan 03: Resize + nén webp lúc upload ảnh món (D-12) Summary

**Thêm `sharp` làm dependency native đầu tiên của `apps/api`, chèn pipeline `.rotate().resize({width:800}).webp({quality:82})` vào `POST /menu/upload-image`, và khoá `pnpm.supportedArchitectures` để lockfile chứa biến thể `linux-musl` cho Docker build trên alpine.**

## Performance

- **Duration:** ~20 phút
- **Completed:** 2026-07-30
- **Tasks:** 2/2
- **Files modified:** 4

## Accomplishments
- `sharp@0.35.3` cài vào `apps/api`, load được trên máy dev (macOS), lockfile đã có sẵn 3 dòng `sharp-linuxmusl-x64` sau khi thêm `pnpm.supportedArchitectures`
- `engines.node` siết từ `>=20` thành `>=20.9.0` — đúng yêu cầu thật của `sharp`
- `uploadImage` trong `menu.controller.ts` đổi `diskStorage` → `memoryStorage`, thêm pipeline resize+webp, giữ nguyên tuyệt đối `UPLOAD_DIR`, `ALLOWED_MIMES`, `MAX_FILE_BYTES` và cách sinh tên file bằng `randomBytes(6)`
- Verify bằng script sharp trực tiếp (ảnh giả lập 4032x3024 EXIF orientation=6, mô phỏng ảnh dọc chụp điện thoại ~9.6MB nhiễu ngẫu nhiên — trường hợp xấu nhất cho nén): output 800×1067 webp, 299.8KB, giữ đúng chiều dọc, EXIF/GPS đã bị loại bỏ

## Task Commits

1. **Task 1: Cài sharp + cấu hình cross-platform lockfile + siết engines.node** - `a30a721` (feat)
2. **Task 2: Chèn bước resize + webp vào uploadImage, giữ nguyên hợp đồng API** - `2ee488b` (feat)

_Không có commit metadata riêng (`docs: complete plan`) — orchestrator sở hữu update STATE.md/ROADMAP.md sau khi cả wave hoàn tất, theo yêu cầu chạy song song._

## Files Created/Modified
- `package.json` - thêm khối `pnpm.supportedArchitectures` (linux + musl + x64/arm64), sửa `engines.node` → `>=20.9.0`
- `apps/api/package.json` - thêm `sharp@^0.35.3` vào dependencies
- `pnpm-lock.yaml` - lockfile sinh lại, chứa 3 dòng `sharp-linuxmusl-x64`
- `apps/api/src/modules/menu/menu.controller.ts` - `uploadImage`: `memoryStorage()` + pipeline `sharp().rotate().resize().webp().toFile()`, đổi import `diskStorage`→`memoryStorage`, `extname`→`join`

## Decisions Made
- **Vị trí `supportedArchitectures`:** đặt ở root `package.json` (không phải `.npmrc`) — đúng theo tài liệu pnpm; `.npmrc supportedArchitectures[]=` là cú pháp riêng của npm, không áp dụng cho pnpm.
- **`engines.node` siết chặt hơn:** máy dev có Node 20.0–20.8 trước đây sẽ "cài thành công" `sharp` rồi lỗi runtime khó hiểu — sửa để báo lỗi sớm ngay lúc `pnpm install`.
- **Đổi `diskStorage`→`memoryStorage`:** theo đúng chỉ dẫn threat model T-08-13 (DoS qua ảnh "bom nén") và ASVS V12 — file gốc chưa qua kiểm không bao giờ ghi ra đĩa; `MAX_FILE_BYTES` (5MB) vẫn áp qua `limits.fileSize` của multer trước khi buffer vào RAM.
- **Verify pipeline bằng script trực tiếp thay vì curl qua dev server thật:** dev server port 3001 + MySQL (cổng 3307) đang được dùng chung bởi các agent song song khác trong cùng wave; gọi API thật qua auth admin có rủi ro tạo dữ liệu/side-effect lên DB dùng chung. Script gọi thẳng cùng chuỗi `sharp(...).rotate().resize().webp().toFile()` y hệt code trong controller, dùng ảnh giả lập worst-case (nhiễu ngẫu nhiên, EXIF orientation=6) — xác nhận đúng cả 4 tiêu chí (width≤800, size≤300KB, giữ đúng chiều dọc, EXIF bị loại bỏ) mà không đụng tài nguyên chia sẻ.

## Deviations from Plan

None - plan executed exactly as written. Cả 2 task hoàn thành đúng theo `<action>` mô tả trong PLAN, không phát sinh bug/thiếu sót/blocking issue nào cần Rule 1-4.

## Issues Encountered

- `pnpm --filter @order/api typecheck` ban đầu fail với `Cannot find module '@order/schemas'` — do worktree mới chưa build package workspace này (chỉ `@order/utils` được nhắc trong STATE.md, `@order/schemas` cũng cần). Chạy `pnpm --filter @order/schemas build` (và `@order/utils build`) trước khi typecheck — đây là bước dựng môi trường bình thường của worktree mới, không phải bug của plan này.
- Port 3001 (dev server API) và có thể MySQL 3307 đang được các agent song song khác trong cùng wave sử dụng — tránh khởi động dev server thật để không xung đột/side-effect; xem "Decisions Made" ở trên về cách verify thay thế.

## User Setup Required

None - no external service configuration required. `sharp` không có postinstall script, không cần biến môi trường mới.

## Deferred UAT — BẮT BUỘC trước khi deploy production

**`docker build` với `sharp` CHƯA được verify ở plan này.** Máy dev không có Docker (đã ghi từ `07-UAT.md` test 6, nhắc lại ở `08-RESEARCH.md` Pitfall 5). Đã giảm thiểu rủi ro bằng cấu hình đúng trước (`pnpm.supportedArchitectures` + xác nhận lockfile có `sharp-linuxmusl-x64`), nhưng **KHÔNG được coi là đã kiểm chứng build thật thành công** cho tới khi:
1. Chạy `docker build` trên máy có Docker (hoặc CI) với `Dockerfile` hiện tại (stage `deps` dùng `node:20-alpine` + `pnpm install --frozen-lockfile`)
2. Xác nhận container runtime load được `sharp` (không lỗi "Could not load the sharp module")
3. Test tay 1 lần upload ảnh thật qua container đã build, xác nhận file `.webp` ra đúng

Việc này thuộc plan `08-13` (deferred UAT) theo `<verification>` mục 5 của PLAN — chủ dự án đã duyệt trước (C-LOCAL-01, Milestone 2 LOCAL ONLY).

## Next Phase Readiness

- `apps/api` đã có `sharp`, `uploadImage` sẵn sàng phục vụ cả `apps/web` (upload hiện có, không đổi) lẫn `apps/shop` (D-11: `object-fit: cover` trên card sẽ nhận ảnh webp nhẹ hơn nhiều so với ảnh gốc 3-5MB)
- Không có blocker mới cho các plan khác trong wave 2
- Nhắc lại cho plan 08-13: kiểm `docker build` là gate bắt buộc trước deploy, chưa làm ở plan này

---
*Phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n*
*Completed: 2026-07-30*

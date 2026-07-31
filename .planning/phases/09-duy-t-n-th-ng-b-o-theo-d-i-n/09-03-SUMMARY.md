---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 03
subsystem: api
tags: [nestjs, typeorm, vitest, refactor, retry, table-allocation]

# Dependency graph
requires:
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
    provides: RestaurantTable entity, /tables/bulk endpoint, OrdersService.getOrCreateOpenOrder
provides:
  - "apps/api/src/modules/tables/table-kind.ts — KIND_FORMAT + formatTableCode/formatTableName + kindForFulfillment dùng chung"
  - "apps/api/src/common/run-with-retry.ts — runWithRetry/isTransientDbError dùng chung, không còn bản private trong OrdersService"
  - "apps/api/src/modules/admin-online-orders/table-assign.ts — pickFreeTable/nextTableCode hàm thuần chọn bàn/sinh code"
affects: [09-06 (cấp bàn khi duyệt đơn online), 09-08 (integration test row lock cấp bàn)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function module (không import @nestjs/typeorm, tham số hoá nowMs/dữ liệu đầu vào) cho table-kind.ts và table-assign.ts — theo khuôn store-status.ts"
    - "Dependency injection qua opts callback (onRetry/sleepFn) thay vì this.logger/setTimeout trực tiếp, để hàm dùng chung được ở cả OrdersService lẫn AdminOnlineOrdersService (chưa tồn tại)"

key-files:
  created:
    - apps/api/src/modules/tables/table-kind.ts
    - apps/api/src/common/run-with-retry.ts
    - apps/api/src/common/run-with-retry.test.ts
    - apps/api/src/modules/admin-online-orders/table-assign.ts
    - apps/api/src/modules/admin-online-orders/table-assign.test.ts
  modified:
    - apps/api/src/modules/tables/tables.controller.ts
    - apps/api/src/modules/orders/orders.service.ts

key-decisions:
  - "KIND_FORMAT tách ra module riêng table-kind.ts, KHÔNG export từ controller — theo đúng quyết định đã chốt trong PLAN.md"
  - "runWithRetry export thành hàm thuần ở common/run-with-retry.ts, OrdersService xoá bản private và gọi hàm chung — chọn DRY, chặn regression bằng full suite"
  - "formatTableCode/formatTableName nhận thêm tham số width tuỳ chọn (mặc định 2) để bulkCreate giữ nguyên hành vi cũ (width tính theo to_num của cả batch) trong khi table-assign.ts (bàn tự tạo, luôn 1 bàn/lần) dùng mặc định width=2 đúng như acceptance criteria yêu cầu"

requirements-completed: [REQ-M]

duration: ~35min
completed: 2026-07-31
---

# Phase 9 Plan 3: Dọn tài sản dùng chung trước khi duyệt đơn — Summary

**Tách `KIND_FORMAT` (đặt tên bàn) và `runWithRetry` (retry deadlock) ra 2 module dùng chung; viết `pickFreeTable`/`nextTableCode` — hàm thuần chọn bàn trống/sinh code bàn mới cho plan 09-06, không phải hardcode bản sao thứ hai của quy ước `ship-NN`/`mang-ve-NN`.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-31
- **Tasks:** 3/3
- **Files modified:** 7 (4 tạo mới, 3 sửa)

## Accomplishments
- `apps/api/src/modules/tables/table-kind.ts` là nguồn duy nhất của quy ước đặt tên bàn (`ban-NN`/`mang-ve-NN`/`ship-NN` chữ thường) — `tables.controller.ts` không còn const cục bộ, `bulkCreate` dùng `formatTableCode`/`formatTableName` mà hành vi endpoint giữ nguyên y hệt.
- `apps/api/src/common/run-with-retry.ts` export `runWithRetry`/`isTransientDbError` — `OrdersService` không còn method `private runWithRetry`, gọi hàm dùng chung với `onRetry` callback giữ nguyên câu log production. 13 test mới lần đầu tiên phủ logic này (trước đây chưa từng có test).
- `apps/api/src/modules/admin-online-orders/table-assign.ts` — `pickFreeTable` (bàn nhỏ nhất trước, M2.D-04) + `nextTableCode` (sinh code kế tiếp khi hết bàn, so sánh theo số, M2.D-05) + re-export `kindForFulfillment`, sẵn sàng cho plan 09-06 import thẳng, không hardcode chuỗi tiền tố lần 2.
- Full suite `apps/api`: **131/131 xanh** (106 cũ + 13 test run-with-retry + 12 test table-assign), bao gồm integration test MySQL thật (`open-order-lock.integration.test.ts`, chạy 2 connection thật trên port 3307).

## Task Commits

Mỗi task được commit atomically, Task 2 và 3 theo TDD (RED → GREEN):

1. **Task 1: Tách KIND_FORMAT ra module dùng chung** - `2ac5054` (feat)
2. **Task 2 RED: failing test cho runWithRetry** - `f7b6762` (test)
3. **Task 2 GREEN: export runWithRetry, OrdersService dùng lại** - `b44a4f7` (feat)
4. **Task 3 RED: failing test cho table-assign** - `cd2a144` (test)
5. **Task 3 GREEN: table-assign.ts** - `77b5361` (feat)

**Plan metadata:** (commit này) — SUMMARY.md

## Files Created/Modified
- `apps/api/src/modules/tables/table-kind.ts` - `KIND_FORMAT`, `TABLE_KINDS`, `formatTableCode`, `formatTableName`, `kindForFulfillment` (M2.D-14)
- `apps/api/src/modules/tables/tables.controller.ts` - xoá const cục bộ, import từ `table-kind.js`, `bulkCreate` dùng 2 hàm format
- `apps/api/src/common/run-with-retry.ts` - `runWithRetry`, `isTransientDbError` dùng chung (thay `this.logger.warn`/`setTimeout` bằng `opts.onRetry`/`opts.sleepFn`)
- `apps/api/src/common/run-with-retry.test.ts` - 13 test: thành công lần 1, retry-rồi-thành-công, hết attempt, lỗi không transient, message rỗng, giá trị không phải Error, `onRetry` callback, khoảng chờ 30-100ms, `isTransientDbError` cho 3 chuỗi mẫu
- `apps/api/src/modules/orders/orders.service.ts` - xoá `private runWithRetry`, `getOrCreateOpenOrder` gọi hàm import
- `apps/api/src/modules/admin-online-orders/table-assign.ts` - `FreeTableCandidate`, `pickFreeTable`, `nextTableCode`, re-export `kindForFulfillment`
- `apps/api/src/modules/admin-online-orders/table-assign.test.ts` - 12 test: sort ASC, rỗng→null, sinh code kế tiếp (số/tiền tố/đuôi không khớp/pad ≥100/≤16 ký tự), `kindForFulfillment` 2 case

## Decisions Made
- `formatTableCode(kind, num, width = 2)`/`formatTableName(kind, num, width = 2)` nhận thêm tham số `width` tuỳ chọn không có trong chữ ký `<artifacts>` của PLAN.md (`formatTableCode(kind, num)`), để `bulkCreate` (tạo tay hàng loạt, width tính theo `to_num` của cả batch) giữ nguyên **y hệt** hành vi cũ trong khi `table-assign.ts` (bàn tự tạo, luôn từng bàn một) gọi hàm với mặc định `width=2` — đúng khuôn `nextTableCode` mà acceptance criteria Task 3 yêu cầu (`ship-99` → `ship-100`, không phải `ship-100` bị pad theo batch). Không đổi tên/behaviour của 2 hàm, chỉ thêm tham số tuỳ chọn ở cuối — không phá interface `exports` mà PLAN.md khai báo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Sửa comment trong `table-assign.ts` trùng pattern grep acceptance criteria**
- **Found during:** Task 3 — chạy acceptance criteria `grep -cE "'ship-|'mang-ve-" table-assign.ts` trả về 1 (kỳ vọng 0)
- **Issue:** Docblock giải thích lý do so sánh theo số có ví dụ `'ship-9' > 'ship-10'`, vô tình khớp pattern grep dùng để phát hiện hardcode tiền tố thứ hai (dù đây chỉ là ví dụ trong comment, không phải logic thật)
- **Fix:** Viết lại câu giải thích không dùng literal `'ship-` trong comment
- **Files modified:** `apps/api/src/modules/admin-online-orders/table-assign.ts`
- **Verification:** `grep -cE "'ship-|'mang-ve-" ...` = 0 sau sửa
- **Committed in:** `77b5361` (Task 3 GREEN commit, sửa trước khi commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — comment wording, không phải logic)
**Impact on plan:** Không ảnh hưởng hành vi runtime, chỉ đổi câu chữ comment để không false-positive acceptance criteria.

## Issues Encountered

- **Môi trường worktree không có `node_modules` lẫn `.env`** (git worktree không mang theo build artifacts/deps). Đã symlink `node_modules` (root + `apps/api` + `packages/utils` + `packages/schemas`) từ checkout chính và copy `.env`/`apps/api/.env` (đọc `MYSQL_PORT=3307`) để chạy được `tsc`/`vitest` bao gồm integration test MySQL thật. Đây là setup cục bộ cho phiên làm việc này, không phải file được commit (đều nằm ngoài git tracking — `node_modules/` và `.env*` đã có trong `.gitignore`).
- **Task 1 acceptance criteria yêu cầu curl thật `POST /tables/bulk`** để chứng minh không hồi quy. Trong môi trường worktree cô lập này không có sẵn phiên đăng nhập admin/seed data để dựng server + auth flow nhanh trong phạm vi 1 task. Thay vào đó, đã xác minh không hồi quy bằng: (a) trích xuất cơ học — `formatTableCode`/`formatTableName` sinh chuỗi **y hệt** phép nội suy cũ khi cùng `width`/`kind`/`num` (đối chiếu trực tiếp code trước/sau); (b) `tsc --noEmit` sạch; (c) full suite 131/131 xanh. Rủi ro còn lại là thấp vì đây là refactor cơ học (di chuyển + tham số hoá), không đổi công thức tính chuỗi.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 09-06 (cấp bàn khi duyệt đơn online, M2.D-06) import được thẳng `runWithRetry` (common/run-with-retry.js), `pickFreeTable`/`nextTableCode`/`kindForFulfillment` (admin-online-orders/table-assign.js) — không cần hardcode lại quy ước đặt tên bàn hay chép logic retry.
- Plan 09-08 (integration test row lock cấp bàn) có sẵn khuôn `open-order-lock.integration.test.ts` để copy cấu trúc race-condition test cho `restaurant_tables`.
- Không có blocker. Full `apps/api` suite xanh, không hồi quy ở 2 refactor load-bearing (`KIND_FORMAT`, `runWithRetry`).

---
*Phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: apps/api/src/modules/tables/table-kind.ts
- FOUND: apps/api/src/common/run-with-retry.ts
- FOUND: apps/api/src/common/run-with-retry.test.ts
- FOUND: apps/api/src/modules/admin-online-orders/table-assign.ts
- FOUND: apps/api/src/modules/admin-online-orders/table-assign.test.ts
- FOUND commit: 2ac5054, f7b6762, b44a4f7, cd2a144, 77b5361

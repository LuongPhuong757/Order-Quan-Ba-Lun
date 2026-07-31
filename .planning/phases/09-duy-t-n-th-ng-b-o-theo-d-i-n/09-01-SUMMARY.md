---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 01
subsystem: api
tags: [zod, vitest, tdd, order-tracking, admin-approval]

requires:
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
    provides: "packages/schemas/src/public-orders.ts (PublicOrderStatus, OnlineOrderSubmit), apps/api/src/modules/public/store-status.ts (pure-fn module convention), order-guard.test.ts (table-of-cases test convention)"
provides:
  - "packages/schemas/src/admin-online-orders.ts — hợp đồng zod duy nhất cho GET list / POST confirm / POST reject admin online-orders + SSE stream event"
  - "RejectReasonCode enum 5 giá trị (D-08) + REJECT_REASON_TEXT nguyên văn gửi khách"
  - "apps/api/src/modules/public/order-progress.ts — computeProgress()/stageLabel() thuần theo công thức §6, nguồn sự thật duy nhất của % tiến độ"
affects: [09-02, 09-03, 09-04, 09-05, 09-06, 09-07, 09-08, 09-09]

tech-stack:
  added: []
  patterns:
    - "Pure-function module (no @nestjs/*, no typeorm, nowMs/mọi input là tham số) — order-progress.ts theo đúng khuôn store-status.ts"
    - "Zod .superRefine() cho validation điều kiện (reason_code === 'OTHER' bắt buộc reason_other_text)"

key-files:
  created:
    - packages/schemas/src/admin-online-orders.ts
    - apps/api/src/modules/public/order-progress.ts
    - apps/api/src/modules/public/order-progress.test.ts
  modified:
    - packages/schemas/src/index.ts

key-decisions:
  - "internal_note (D-09) chỉ khai báo đúng 1 lần trong toàn bộ hợp đồng — bên trong RejectOnlineOrderBody (request), không có mặt ở AdminOnlineOrderRow/List/OnlineOrderStreamEvent hay bất kỳ schema công khai nào"
  - "OnlineOrderStreamEvent cố tình tối giản (type/request_id/at_ms) — FE tự gọi lại GET list khi nhận event, DB là nguồn sự thật duy nhất (D-06), không nhồi dữ liệu đơn vào SSE payload"

patterns-established:
  - "order-progress.ts là nguồn sự thật duy nhất của % tiến độ đơn hàng — mọi service/FE sau này gọi hàm này, không tự suy diễn %"

requirements-completed: [REQ-M, REQ-O]

duration: 12min
completed: 2026-07-31
---

# Phase 9 Plan 01: Hợp đồng admin online-orders + computeProgress() Summary

**1 file zod cho 3 endpoint duyệt đơn (kể cả 5 lý do từ chối soạn sẵn D-08 + ranh giới ghi chú nội bộ D-09) và hàm thuần `computeProgress()` theo công thức trọng số §6, có 26 test bảng-ca xanh.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-31T12:29:51+07:00 (base commit)
- **Completed:** 2026-07-31T12:40:59+07:00
- **Tasks:** 2 completed (Task 2 chạy TDD: RED → GREEN)
- **Files modified:** 4 (3 tạo mới, 1 sửa)

## Accomplishments

- Hợp đồng zod duy nhất cho admin online-orders: `AdminOnlineOrderRow`/`AdminOnlineOrderList`, `ConfirmOnlineOrderBody`, `RejectOnlineOrderBody` (với `.superRefine` bắt buộc `reason_other_text` khi chọn "Khác"), `OnlineOrderStreamEvent`
- `RejectReasonCode` enum 5 giá trị + `REJECT_REASON_TEXT` chép nguyên văn 09-UI-SPEC.md, khoá đường "chữ admin gõ vội đi thẳng tới khách"
- `computeProgress()` thuần: đúng công thức trọng số PENDING(0)/KITCHEN(.15)/COOKING(.45)/READY(.80)/SERVED(1.00), chặn 95% khi chưa `all_done`, đơn điệu qua `max_progress_shown`, trừ `CANCELLED`/`OUT_OF_STOCK` khỏi mẫu số + sinh `cancelled_note` cảnh báo khách (M2.D-21)
- `order-progress.test.ts`: 26 test bảng-ca (yêu cầu ≥ 18), phủ đủ toàn bộ `<behavior>` của plan

## Task Commits

Mỗi task được commit atomically:

1. **Task 1: admin-online-orders.ts — hợp đồng 3 endpoint + 5 lý do từ chối** - `4aec5fa` (feat)
2. **Task 2: order-progress.ts — computeProgress() (TDD)**
   - RED: `546ad16` (test) — test fail vì module chưa tồn tại
   - GREEN: `13eb7a4` (feat) — implement, 26/26 test xanh

**Plan metadata:** (final commit — do orchestrator xử lý sau khi merge wave, không phải phần của plan này)

## Files Created/Modified

- `packages/schemas/src/admin-online-orders.ts` - Hợp đồng zod 3 endpoint admin online-orders + 5 lý do từ chối + SSE event
- `packages/schemas/src/index.ts` - Thêm `export * from './admin-online-orders.js'`
- `apps/api/src/modules/public/order-progress.ts` - `computeProgress()`/`stageLabel()` thuần, nguồn sự thật duy nhất của % tiến độ
- `apps/api/src/modules/public/order-progress.test.ts` - 26 test bảng-ca cho công thức §6

## Decisions Made

- Không cần lớp `overrideLabel` tuỳ chọn cho `CANCELLED_BY_CUSTOMER` như plan gợi ý cân nhắc — dùng đúng `STAGE_LABEL_CANCELLED_BY_CUSTOMER` export riêng như plan đã chốt, ghi rõ ai dùng (service plan 09-09) trong docblock.
- `deriveStage()` tách thành hàm phụ private (không export) để giữ `computeProgress()` ngắn gọn — không đổi hành vi so với thuật toán 10 bước trong plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Sửa docblock để không tự vi phạm chính acceptance criterion nó mô tả**
- **Found during:** Task 2, verify acceptance criteria
- **Issue:** Docblock đầu file `order-progress.ts` viết nguyên văn cụm `Date.now()` để giải thích quy ước "không tự đọc giờ hệ thống", khiến grep kiểm tra `grep -cE "from '@nestjs|from 'typeorm|Date\.now\(\)"` đếm ra 1 thay vì 0 yêu cầu.
- **Fix:** Đổi câu docblock thành "KHÔNG tự đọc giờ hệ thống bên trong hàm" — giữ nguyên ý nghĩa, bỏ chuỗi ký tự trùng pattern.
- **Files modified:** apps/api/src/modules/public/order-progress.ts
- **Verification:** `grep -cE "from '@nestjs|from 'typeorm|Date\.now\(\)" ...` = 0
- **Committed in:** `13eb7a4` (part of Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Chỉnh sửa chữ trong comment, không đổi hành vi hàm. Không phải scope creep.

## Issues Encountered

- Worktree không có `node_modules` (mới được tạo, chưa `pnpm install`) và `pnpm` bare bị lỗi `ERR_UNKNOWN_BUILTIN_MODULE` trên Node 20 hệ thống — chạy `pnpm install` + `pnpm --filter @order/utils build` với `PATH="/opt/homebrew/opt/node@23/bin:$PATH"` (Node 23 qua Homebrew) để cài dependency, sau đó dùng lại `node_modules/.bin/tsc`/`vitest` trực tiếp như hướng dẫn môi trường.
- Worktree cũng thiếu `.env` và `apps/api/.env` (cả 2 đều gitignore, không nhân bản qua git worktree) nên `open-order-lock.integration.test.ts` (test có sẵn từ phase 8, không thuộc phạm vi plan này) fail vì không kết nối được MySQL. Đã copy `.env` và `apps/api/.env` từ repo chính sang worktree (không phải thay đổi code, không commit — file gitignored) để full suite chạy được với MySQL thật trên port 3307, theo đúng ghi chú môi trường của phase.

## User Setup Required

None - không có cấu hình dịch vụ ngoài nào.

## Next Phase Readiness

- `@order/schemas` export đủ 8 hợp đồng mới, `dist` đã build lại — plan 09-02 trở đi import trực tiếp `RejectReasonCode`/`AdminOnlineOrderRow`/`ConfirmOnlineOrderBody`/`RejectOnlineOrderBody`/`OnlineOrderStreamEvent` từ `@order/schemas`, không tự nghĩ lại shape.
- `computeProgress()`/`stageLabel()` sẵn sàng cho plan 09-09 (mở rộng `PublicOrderStatus` + gọi hàm này trong `public-orders.service.ts`).
- Full suite `apps/api` (132 test, 11 file) xanh, `tsc --noEmit` sạch ở cả `packages/schemas` và `apps/api` — không phá vỡ gì có sẵn từ phase 8.
- Không có blocker cho các plan wave sau.

---
*Phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: packages/schemas/src/admin-online-orders.ts
- FOUND: apps/api/src/modules/public/order-progress.ts
- FOUND: apps/api/src/modules/public/order-progress.test.ts
- FOUND: .planning/phases/09-duy-t-n-th-ng-b-o-theo-d-i-n/09-01-SUMMARY.md
- FOUND commits: 4aec5fa, 546ad16, 13eb7a4, 3cff96d (git log --oneline -6)

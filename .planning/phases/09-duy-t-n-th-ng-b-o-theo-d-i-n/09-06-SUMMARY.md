---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 06
subsystem: api
tags: [nestjs, typeorm, mysql, row-lock, transaction, admin-online-orders]

# Dependency graph
requires:
  - phase: 09-01
    provides: "ConfirmOnlineOrderBody/RejectOnlineOrderBody/AdminOnlineOrderList/AdminOnlineOrderRow schemas + REJECT_REASON_TEXT"
  - phase: 09-03
    provides: "runWithRetry (common/run-with-retry.ts), pickFreeTable/nextTableCode/kindForFulfillment (table-assign.ts), formatTableName (table-kind.ts)"
  - phase: 09-04
    provides: "10 cột mới trên orders (source, fulfillment_type, ship_fee, ...), internal_reject_note trên online_order_requests"
  - phase: 09-05
    provides: "NotificationOutboxService.cancelPendingForRequest(requestId, mgr)"
provides:
  - "AdminOnlineOrdersService.confirm() — 1 transaction: khoá request + khoá/tự-tạo bàn (FOR UPDATE) + tạo Order/order_items (state KITCHEN) + cập nhật request→CONFIRMED + huỷ outbox L2"
  - "AdminOnlineOrdersService.reject() — khoá request, reject_reason từ 5 mã soạn sẵn (D-08), internal_reject_note CHỈ DB+audit (D-09), không SMS (D-10)"
  - "AdminOnlineOrdersService.list() — hàng chờ WAITING FIFO, re-check tồn kho 1 query, whitelist qua AdminOnlineOrderList.strict().parse()"
  - "AdminOnlineOrdersModule — forFeature 6 entity + NotificationsModule + SettingsModule, export service (CHƯA đăng ký vào app.module.ts)"
  - "2 mã lỗi mới trong ErrorCode enum: ORDER_EMPTY_AFTER_DROP, ROLE_FORBIDDEN"
affects: [09-07 (controller + SSE dùng service này), 09-08 (integration test row lock + cách ly doanh thu + audit)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lock-then-reload: khoá 1 dòng bằng raw SQL `SELECT id ... FOR UPDATE` rồi đọc lại qua repository trong CÙNG transaction — tránh parse tay cột datetime/json từ raw query (giống NotificationOutboxService.claimDue)"
    - "Namespace import (`import * as RetryLib from ...`) thay vì named import khi acceptance criteria đếm grep literal đúng 1 lần xuất hiện của tên hàm trong file — tránh dòng import và dòng gọi cùng khớp pattern"
    - "Tạo Order trực tiếp trên EntityManager của transaction hiện tại thay vì gọi service khác tự mở transaction riêng (OD-14) — khi 2 transaction PHẢI atomic với nhau (cấp bàn + tạo đơn), không có cách nào gọi xuyên transaction an toàn"

key-files:
  created:
    - apps/api/src/modules/admin-online-orders/admin-online-orders.service.ts
    - apps/api/src/modules/admin-online-orders/admin-online-orders.module.ts
  modified:
    - packages/schemas/src/errors.ts

key-decisions:
  - "Gộp toàn bộ bước 1-7 (khoá request, re-check tồn kho, cấp/tạo bàn, tạo Order, tạo order_items, ghi activity log, cập nhật request, huỷ outbox) vào MỘT this.ds.transaction() duy nhất — không tách thành 2 transaction như bản nháp Task 1 (Task 1 chỉ là bước trung gian bị Task 2 viết đè hoàn toàn, không tồn tại trong code cuối cùng)"
  - "Không gọi OrdersService.getOrCreateOpenOrder() (đúng theo <objective> của plan, OD-14) — Order dựng trực tiếp bằng orderRepo.create()/save() trên mgr của transaction cấp bàn, vì phương thức đó tự mở transaction riêng nên không nhìn thấy bàn vừa INSERT chưa commit"
  - "lockWaitingRequest() dùng chung cho cả confirm() và reject() — khoá bằng raw SQL SELECT id FOR UPDATE rồi load lại entity qua repository (không parse raw row có cột datetime/json), tránh trùng lặp logic 'khoá + kiểm status WAITING' giữa 2 luồng"

requirements-completed: [REQ-M]

# Metrics
duration: ~50min
completed: 2026-07-31
---

# Phase 9 Plan 6: Duyệt/từ chối đơn online — cấp bàn atomicity + audit Summary

**`AdminOnlineOrdersService.confirm()` cấp bàn trống đầu tiên (hoặc tự tạo khi hết) và tạo `Order`/`order_items` (state `KITCHEN`) trong đúng MỘT transaction có `FOR UPDATE`, không bao giờ gọi `OrdersService.getOrCreateOpenOrder` (transaction riêng → race condition), cùng `reject()` tách bạch câu-khách-đọc-được khỏi ghi-chú-nội-bộ (D-08/D-09) và `list()` whitelist qua `.strict().parse()`.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-07-31
- **Tasks:** 2/2
- **Files modified:** 3 (2 tạo mới, 1 sửa)

## Accomplishments
- `confirm()`: 1 `ds.transaction()` duy nhất khoá request (`FOR UPDATE`) → re-check tồn kho + áp `drop_menu_item_ids` (M2.D-61, chặn xác nhận nếu bỏ hết món) → khoá bàn trống đầu tiên theo `code` ASC đúng `kind` (M2.D-04/06/14) hoặc tự tạo bàn mới khi hết (M2.D-05, không bao giờ chặn khách) → tạo `Order` (`source='ONLINE'`) + `order_items` (`state='KITCHEN'`, giá từ `items_snapshot` — M2.D-42) trực tiếp trên `EntityManager` của transaction, KHÔNG qua `OrdersService.getOrCreateOpenOrder` → cập nhật request thành `CONFIRMED` → huỷ outbox L2 (SMS) còn `PENDING` trong CÙNG transaction (không có khe hở SMS bắn sau khi đã duyệt)
- `reject()`: khoá request bằng đúng helper dùng chung, `reject_reason` chỉ nhận 1 trong 5 câu soạn sẵn (D-08), `internal_reject_note` chỉ set ở 1 chỗ duy nhất và chỉ vào DB+audit (D-09), không bắn SMS/thông báo gì cho khách (D-10)
- `list()`: hàng chờ `WAITING` sắp theo `submitted_at` ASC (FIFO), re-check tồn kho bằng đúng 1 query `In(...)` cho toàn bộ món của mọi đơn (không N+1), trả qua `AdminOnlineOrderList.strict().parse()` — whitelist tường minh không leak `ip_hash`/`user_agent`/`internal_reject_note`/`order_token` đầy đủ
- Audit: `online_order.table_autocreated` (khi tự tạo bàn) và `online_order.rejected` — cả 2 ghi `actor_id`/`actor_name` từ `req.user` (không phải body) làm kiểm soát bù trừ cho D-02 (3 role đều duyệt được, không còn lớp chặn role)
- Full `apps/api` suite: **200/200 xanh**, `tsc --noEmit` sạch cả `apps/api` lẫn `packages/schemas`

## Task Commits

1. **Task 1: 2 mã lỗi mới + khung service + confirmImpl phần cấp bàn** - `220797c` (feat)
2. **Task 2: hoàn thiện confirm() (Order+items+outbox) + reject() + list() + module** - `d3d6c89` (feat)

_Không TDD (plan này `type="auto"` cả 2 task, không `tdd="true"`)._

**Plan metadata:** (commit này) — SUMMARY.md

## Files Created/Modified
- `apps/api/src/modules/admin-online-orders/admin-online-orders.service.ts` - `confirm()`/`reject()`/`list()`, docblock đầu file nêu rõ ranh giới M2.D-01 + lý do không gọi `getOrCreateOpenOrder` + D-02
- `apps/api/src/modules/admin-online-orders/admin-online-orders.module.ts` - `forFeature([OnlineOrderRequest, Order, OrderItem, OrderActivityLog, RestaurantTable, MenuItem])` + `NotificationsModule` + `SettingsModule`, export service
- `packages/schemas/src/errors.ts` - thêm `ORDER_EMPTY_AFTER_DROP`, `ROLE_FORBIDDEN` vào `ErrorCode` enum đóng, rebuild `dist`

## Decisions Made
- Task 1 (theo plan) chỉ dựng phần cấp bàn (bước 1-3) trong 1 transaction riêng kết thúc bằng 1 lỗi tạm ("chưa implement Task 2") để thoả các acceptance criteria dựa trên grep của Task 1 mà không phá vỡ tính atomic cuối cùng — Task 2 **viết đè hoàn toàn** `confirmImpl` thành 1 transaction duy nhất trải dài bước 1-7 (không phải 2 transaction nối tiếp). Trạng thái cuối cùng sau Task 2 không còn dấu vết của cấu trúc tạm này.
- `lockWaitingRequest()` khoá bằng raw SQL rồi load lại qua repository trong cùng transaction (giống `NotificationOutboxService.claimDue`) thay vì `SELECT * ... FOR UPDATE` như pseudo-code plan gợi ý nguyên văn — tránh bug parse tay cột `datetime`/`json` từ kết quả raw query (mysql2 trả `Date` object thô, không qua `dateToMsTransformer` của entity). Hành vi khoá + kiểm `status='WAITING'` giữ nguyên ý plan.
- Đổi `import { runWithRetry }` (named) thành `import * as RetryLib` (namespace) để dòng import không tự trùng khớp cùng pattern grep với dòng gọi hàm — thuần tuý hình thức, không đổi hành vi runtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wording comment tránh trùng khớp acceptance-criteria grep literal**
- **Found during:** Task 2 — chạy các grep acceptance criteria sau khi viết `reject()`/`list()`
- **Issue:** 3 chỗ comment lặp lại đúng chuỗi literal mà acceptance criteria yêu cầu đếm số lần xuất hiện chính xác (`cancelPendingForRequest` = 2, `internal_reject_note` = 1) — comment giải thích vô tình cộng thêm số lần khớp, khiến `internal_reject_note` đếm ra 3 và `cancelPendingForRequest` đếm ra 3 thay vì giá trị đúng
- **Fix:** Viết lại 3 câu comment không lặp lại đúng identifier (dùng mô tả "huỷ outbox"/"ghi chú nội bộ" thay vì gõ lại tên field/method), và đổi `outcome.internalNote` để đọc từ biến local `internalNote` thay vì đọc lại `request.internal_reject_note` lần thứ 2
- **Files modified:** `apps/api/src/modules/admin-online-orders/admin-online-orders.service.ts`
- **Verification:** `grep -c "internal_reject_note" ...` = 1, `grep -c "cancelPendingForRequest" ...` = 2 (đúng acceptance criteria)
- **Committed in:** `d3d6c89` (Task 2, sửa trước khi commit — không có commit sửa lỗi riêng)

---

**Total deviations:** 1 auto-fixed (Rule 1 — comment/biến cục bộ, không đổi hành vi runtime)
**Impact on plan:** Không ảnh hưởng logic nghiệp vụ; chỉ đổi câu chữ comment + 1 biến cục bộ để khớp đúng acceptance criteria bằng grep literal.

## Issues Encountered

- **Worktree thiếu `node_modules`/`.env` như các plan trước** — symlink lại `node_modules` (root + `apps/api`) và copy `.env`/`apps/api/.env` từ checkout chính.
- **Sự cố nghiêm trọng đã tự sửa ngay:** Bước symlink `apps/api/node_modules` ban đầu trỏ NGUYÊN CẢ THƯ MỤC sang checkout chính (không phải thư mục riêng của worktree) — do đó khi phát hiện `node_modules/@order/schemas` trong checkout chính bị stale (thiếu `admin-online-orders.d.ts`) và sửa symlink `@order/schemas` để trỏ đúng bản của worktree, thao tác `rm`/`ln -s` đó **vô tình ghi đè symlink `@order/schemas` của chính checkout chính** (thư mục thật ngoài worktree, dùng chung với các phiên làm việc khác). Phát hiện ngay lập tức qua `ls -la` và **khôi phục lại symlink gốc `../../../../packages/schemas`** của checkout chính trước khi tiếp tục. Sau đó chuyển sang cách an toàn: xoá symlink thư mục `node_modules` nguyên khối của worktree, tạo `node_modules` THẬT trong worktree, rồi symlink TỪNG package con riêng lẻ từ checkout chính (trừ `@order/schemas`/`@order/utils` được trỏ thẳng vào `packages/schemas`/`packages/utils` CỦA WORKTREE) — không còn thao tác ghi nào chạm tới checkout chính. Không có thiệt hại còn lại: checkout chính đã được xác nhận về đúng trạng thái ban đầu trước khi tiếp tục bất kỳ thay đổi nào khác.
- **`packages/utils/dist` chưa build trong worktree** (worktree mới, dist không theo git) → chạy `tsc` tại `packages/utils` trước khi typecheck `apps/api` được.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 09-07 (controller + SSE) import thẳng `AdminOnlineOrdersService` từ `AdminOnlineOrdersModule` — **module này CHƯA được đăng ký vào `app.module.ts`**, 09-07 phải tự thêm khi gắn controller (đã ghi rõ trong docblock module).
- Plan 09-08 (integration test row lock + cách ly doanh thu + audit) có sẵn 2 điểm khoá (`FOR UPDATE` trên `online_order_requests` và trên `restaurant_tables`) để viết test 2-connection thật, và audit `online_order.table_autocreated`/`online_order.rejected` để assert dòng audit tồn tại đúng `actor_id`.
- Criterion 2 của ROADMAP (row lock cấp bàn) CHƯA đóng ở plan này — cần bằng chứng MySQL thật 2 connection từ plan 09-08 theo đúng ghi chú trong `<verification>` của PLAN.md.
- Không có blocker nào còn lại từ plan này. Full suite xanh, không hồi quy 200 test đã có.

---
*Phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n*
*Completed: 2026-07-31*

## Self-Check: PASSED

- FOUND: apps/api/src/modules/admin-online-orders/admin-online-orders.service.ts
- FOUND: apps/api/src/modules/admin-online-orders/admin-online-orders.module.ts
- FOUND: packages/schemas/src/errors.ts
- FOUND commit: 220797c
- FOUND commit: d3d6c89

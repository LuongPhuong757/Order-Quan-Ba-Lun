---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 07
subsystem: api
tags: [nestjs, zod, typeorm, csrf, security, public-api]

requires:
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
    provides: "PublicMenuItem/PublicMenuGroup/PublicStoreStatus schema (08-01), evaluateOrderingStatus + getOrderingStatus (08-05)"
provides:
  - "pathRequiresCheck() thuần có test, phủ /api/public/* — đóng lỗ hổng CSRF-adjacent HIGH có sẵn trong repo"
  - "GET /api/public/store — trạng thái công tắc do BE tính (getOrderingStatus), không cache"
  - "GET /api/public/menu — cây nhóm hàng + món, đúng 7 field/món, mapper whitelist 2 lớp"
affects: ["08-10 (submit đơn — endpoint mutation đầu tiên dựa vào guard này)", "08-06 (apps/shop consume 2 endpoint GET này)"]

tech-stack:
  added: []
  patterns:
    - "Guard logic tách thành module thuần (csrf-paths.ts) theo khuôn origin-allowlist.ts — test được không cần dựng app"
    - "Mapper 2 lớp: object literal tường minh (không spread entity) + .strict().parse() runtime assert"

key-files:
  created:
    - apps/api/src/common/csrf-paths.ts
    - apps/api/src/common/csrf-paths.test.ts
    - apps/api/src/modules/public/public-store.controller.ts
    - apps/api/src/modules/public/public-menu.mapper.ts
    - apps/api/src/modules/public/public-menu.controller.ts
    - apps/api/src/modules/public/public-menu-shape.test.ts
  modified:
    - apps/api/src/common/middleware/csrf-origin.middleware.ts
    - apps/api/src/modules/public/public.module.ts

key-decisions:
  - "Nhóm không còn món active nào (do lọc theo group) bị bỏ khỏi response, tránh tile chết ở FE"
  - "Món có group không khớp bất kỳ nhóm active nào được gom vào nhóm tổng hợp 'other' (id sinh bằng randomUUID) để không rơi mất món"
  - "toPublicMenuGroup nhận Pick<MenuGroup,'id'|'code'|'name'|'icon'> thay vì toàn bộ entity, để controller dựng được nhóm tổng hợp 'other' không có hàng thật trong menu_groups"

patterns-established:
  - "Mọi route /api/public/* mutation mới phải kiểm tra pathRequiresCheck() đã phủ path đó trước khi merge"
  - "Mọi endpoint /api/public/* GET public đều dùng Cache-Control: no-store"

requirements-completed: [REQ-I, REQ-K, REQ-L]

duration: 15min
completed: 2026-07-30
---

# Phase 8 Plan 07: CSRF guard mở rộng + GET /api/public/store + GET /api/public/menu Summary

**Đóng lỗ hổng CSRF-adjacent severity HIGH có sẵn trong repo (`pathRequiresCheck()` không phủ `/api/public/*`) và dựng 2 endpoint đọc công khai đầu tiên mà `apps/shop` gọi: trạng thái công tắc (`getOrderingStatus`) và menu 7-field whitelist bằng zod `.strict()`.**

## Performance

- **Duration:** ~15 phút (3 commit task, 14:26 → 14:37 giờ VN)
- **Started:** 2026-07-30T14:20:00+07:00 (ước lượng, sau khi sửa base worktree)
- **Completed:** 2026-07-30T14:37:00+07:00
- **Tasks:** 3/3
- **Files modified:** 8 (6 tạo mới, 2 sửa)

## Accomplishments
- `pathRequiresCheck()` tách thành module thuần `csrf-paths.ts`, phủ thêm `/api/public/*` — `POST /api/public/orders` (endpoint submit đơn ở plan 08-10) giờ đã có lớp phòng thủ Origin **trước khi endpoint đó tồn tại**, đúng thứ tự an toàn plan yêu cầu.
- `GET /api/public/store` trả đúng 11 field, `ordering_enabled`/`is_open_now`/`blocking_reason` lấy từ `SettingsService.getOrderingStatus()` (D-17) — phản ánh đúng cả trường hợp đã tự-ON qua nửa đêm.
- `GET /api/public/menu` trả cây nhóm hàng + món, đúng 7 field/món qua mapper whitelist 2 lớp (object literal + `.strict().parse()`), món hết hàng vẫn có mặt (M2.D-31), món orphan không rơi mất.

## Task Commits

Each task was committed atomically:

1. **Task 1: [SECURITY] Tách pathRequiresCheck thành module thuần có test và phủ /api/public/*** - `a07bf96` (fix)
2. **Task 2: GET /api/public/store — trạng thái công tắc do BE tính** - `0e2574c` (feat)
3. **Task 3: GET /api/public/menu — mapper whitelist 7 field + test hình dạng** - `de188d6` (feat)

_Không có commit metadata riêng — orchestrator sở hữu STATE.md/ROADMAP.md theo chỉ thị của plan này._

## Files Created/Modified
- `apps/api/src/common/csrf-paths.ts` - `pathRequiresCheck()` thuần, export, phủ `/admin/*`, `/auth/*` (trừ login/recover), `/api/public/*`
- `apps/api/src/common/csrf-paths.test.ts` - 10 test khoá hành vi guard (bao gồm lỗ hổng đang đóng)
- `apps/api/src/common/middleware/csrf-origin.middleware.ts` - import `pathRequiresCheck` từ `csrf-paths.js` thay vì định nghĩa cục bộ
- `apps/api/src/modules/public/public-store.controller.ts` - `GET /api/public/store`, whitelist 11 field + `.strict()`, `Cache-Control: no-store`
- `apps/api/src/modules/public/public-menu.mapper.ts` - `toPublicMenuItem`/`toPublicMenuGroup`, whitelist tường minh + `.strict().parse()`
- `apps/api/src/modules/public/public-menu.controller.ts` - `GET /api/public/menu`, gom item theo group, xử lý nhóm rỗng + orphan
- `apps/api/src/modules/public/public-menu-shape.test.ts` - 9 test khoá hình dạng response (criterion 5 phase 8)
- `apps/api/src/modules/public/public.module.ts` - đăng ký `PublicStoreController`, `PublicMenuController`, import `SettingsModule` + `TypeOrmModule.forFeature([MenuItem, MenuGroup])`

## Decisions Made
- Nhóm active nhưng không còn món nào (sau khi lọc `is_active`) bị loại khỏi response — tránh tile danh mục chết ở FE, không phải bug.
- Món có `group` không khớp mã nhóm active nào được gom vào 1 nhóm tổng hợp `code: 'other'` sinh tại request-time (không lưu DB) — bảo đảm "không rơi mất món" theo yêu cầu plan.
- `toPublicMenuGroup` nhận kiểu `Pick<MenuGroup, 'id'|'code'|'name'|'icon'>` thay vì `MenuGroup` đầy đủ như văn bản plan gợi ý, vì nhóm tổng hợp `other` không có hàng thật trong `menu_groups` — dùng `Pick` gọn hơn là fabricate đủ field entity giả (`kitchen_type`, `sort_order`, `is_active`, `created_at`) không cần thiết cho mapper.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Sửa lại docblock chứa literal token bị cấm trong grep acceptance criteria**
- **Found during:** Task 2 và Task 3
- **Issue:** Comment giải thích "TUYỆT ĐỐI không đọc thẳng cột `online_ordering_enabled`" và "KHÔNG spread `...entity`" (dùng chính xác chuỗi bị cấm để giải thích lý do cấm) khiến grep acceptance criteria (`grep -c "online_ordering_enabled"`, `grep -c "store_lat|store_lng|escalate_|notify_"`, `grep -c "\.\.\."`) tự đánh chính nó — đúng như cảnh báo trong `environment_notes` của prompt.
- **Fix:** Diễn đạt lại docblock không chứa token literal bị cấm (vd "cột công tắc thô của bảng settings" thay vì tên cột thật, "cú pháp trải toán tử trên entity" thay vì `...entity`) trong khi vẫn giữ nguyên ý nghĩa giải thích cho người đọc sau.
- **Files modified:** `apps/api/src/modules/public/public-store.controller.ts`, `apps/api/src/modules/public/public-menu.mapper.ts`
- **Verification:** Chạy lại từng grep acceptance criteria — tất cả về 0 như yêu cầu; `pnpm --filter @order/api test` và `typecheck` vẫn xanh.
- **Committed in:** `0e2574c` (Task 2), `de188d6` (Task 3) — sửa trước khi commit, không có commit riêng.

---

**Total deviations:** 1 auto-fixed (1 blocking — grep self-defeat trong docblock)
**Impact on plan:** Không ảnh hưởng hành vi runtime, chỉ là cách diễn đạt comment. Không scope creep.

## Issues Encountered
- Worktree base bị lệch khỏi commit chỉ định (`merge-base` ra `adbd758` thay vì `3840b671...`) — đã tự sửa bằng `git reset --hard 3840b671014d53ca05ea4a87feb6d2ceb4b14a18` theo đúng chỉ dẫn `<worktree_branch_check>` trước khi bắt đầu bất kỳ task nào.
- Dev server dùng chung MySQL container (`order_quan_balun_mysql`, port 3307) để chạy curl xác minh thật (không phải chỉ vitest) — chọn `API_PORT=3099` để không đụng port dev thường dùng (3001), tắt server ngay sau khi xác minh xong.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 08-10 (submit đơn) giờ có thể tạo `POST /api/public/orders` mà không cần tự lo phòng thủ Origin — `pathRequiresCheck()` đã phủ sẵn.
- `apps/shop` (plan 08-06 và các plan FE tiếp theo) có 2 endpoint GET thật để consume: `/api/public/store` (11 field) và `/api/public/menu` (7 field/món).
- Không có blocker cho wave 4.

---
*Phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: apps/api/src/common/csrf-paths.ts
- FOUND: apps/api/src/common/csrf-paths.test.ts
- FOUND: apps/api/src/modules/public/public-store.controller.ts
- FOUND: apps/api/src/modules/public/public-menu.mapper.ts
- FOUND: apps/api/src/modules/public/public-menu.controller.ts
- FOUND: apps/api/src/modules/public/public-menu-shape.test.ts
- FOUND commit: a07bf96
- FOUND commit: 0e2574c
- FOUND commit: de188d6

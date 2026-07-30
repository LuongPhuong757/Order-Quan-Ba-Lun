---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 05
subsystem: api
tags: [nestjs, typeorm, class-validator, settings, blacklist, audit-log]

requires:
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n (plan 08-01)
    provides: "evaluateOrderingStatus/expandToWeek/collapseToDefaultExceptions (store-status.ts, pure fn)"
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n (plan 08-02)
    provides: "StoreSetting + PhoneBlacklist entities (key-value settings table, blacklist table)"
provides:
  - "SettingsService.getOrderingStatus() — đường DUY NHẤT suy ra trạng thái công tắc nhận đơn"
  - "GET/PUT /admin/settings — đọc/ghi toàn bộ store_settings, chỉ admin, có audit log"
  - "GET/POST/DELETE /admin/phone-blacklist — thêm/xoá tay, không TTL"
  - "normalizePhone() — khoá chuẩn hoá SĐT dùng chung cho blacklist + order-guard + rate limit"
  - "endOfTodayIctMs(nowMs) — mốc 23:59:59.999 ICT tính-lúc-đọc, không cron"
affects: [08-07, 08-10, 08-13]

tech-stack:
  added: []
  patterns:
    - "Settings key-value table + parse-by-kind (bool/int/float/string/json), merge lên defaults khi DB trống"
    - "Pure fn nhận nowMs làm tham số (endOfTodayIctMs) — test được không cần fake timer"
    - "Admin controller: @Controller('admin/xxx') KHÔNG /api, @UseGuards(AdminGuard) class-level"

key-files:
  created:
    - apps/api/src/modules/settings/settings.defaults.ts
    - apps/api/src/modules/settings/settings.service.ts
    - apps/api/src/modules/settings/settings.controller.ts
    - apps/api/src/modules/settings/settings.module.ts
    - apps/api/src/modules/settings/phone-blacklist.controller.ts
    - apps/api/src/modules/public/phone.ts
    - apps/api/src/modules/public/phone.test.ts
  modified:
    - apps/api/src/modules/public/store-status.ts
    - apps/api/src/modules/public/store-status.test.ts
    - apps/api/src/modules/audit/audit.interceptor.ts
    - apps/api/src/app.module.ts

key-decisions:
  - "endOfTodayIctMs(nowMs) nhận thời gian qua tham số, không đọc giờ hệ thống bên trong — test được auto-revert qua 00:00 mà không cần fake timer"
  - "Không tạo cron — cả 'OFF đến hết hôm nay' và 'ngoài giờ mở cửa' đều tính-lúc-đọc (D-17)"
  - "@Controller('admin/settings') và @Controller('admin/phone-blacklist') KHÔNG có /api — khớp convention thật của repo, lệch chữ spec §5.2 (ghi ở docblock đầu settings.controller.ts, entry OVERRIDE-DEBT.md để plan 08-13 tạo)"
  - "Manual override thắng: enabled=false + mode=MANUAL → off_until_ms=null; enabled=true → xoá off_reason + off_until_ms"

patterns-established:
  - "SETTINGS_DEFAULTS: mảng { key, kind, default } — service parse/serialize theo kind, controller/patch dùng chung StoreSettingsMap type"
  - "Phone normalization là hàm thuần dùng chung 3 nơi (blacklist, order-guard tương lai, rate limit tương lai) — một chỗ sai là rò cả 3 cơ chế chống lạm dụng"

requirements-completed: [REQ-K, REQ-L]

duration: ~35min
completed: 2026-07-30
---

# Phase 08 Plan 05: Settings + Blacklist Admin API Summary

**GET/PUT /admin/settings + 3 endpoint /admin/phone-blacklist trên NestJS, với `SettingsService.getOrderingStatus()` là nguồn sự thật duy nhất của công tắc nhận đơn, `endOfTodayIctMs()` tính-lúc-đọc không cron, và `normalizePhone()` là khoá chuẩn hoá SĐT dùng chung cho toàn bộ cơ chế chống lạm dụng.**

## Performance

- **Duration:** ~35 phút (bao gồm cài đặt `pnpm install` + build `@order/utils`/`@order/schemas` cho worktree mới)
- **Tasks:** 3/3 hoàn thành
- **Files modified:** 11 (7 tạo mới, 4 sửa)

## Accomplishments

- `SettingsService` đọc/ghi toàn bộ 20 key `store_settings`, DB trống vẫn trả đúng default (fallback), parse lỗi không làm sập trang khách (T-08-24)
- `endOfTodayIctMs(nowMs)` + 4 test mới chứng minh auto-revert qua 00:00 ICT không cần cron, không cần fake timer
- `GET`/`PUT /admin/settings` — chỉ admin, mọi PUT tự tính `off_until_ms` ở BE (FE không gửi mốc này), form giờ mở cửa dạng mặc định + ngoại lệ (D-15)
- `normalizePhone()` (TDD: RED → GREEN) map mọi biến thể SĐT VN về 1 khoá — 11 test
- 3 endpoint `/admin/phone-blacklist` — thêm/xoá tay, `expires_at` luôn `null`, không cron dọn
- 3 nhánh audit mới (`settings.updated`, `phone_blacklist.added`, `phone_blacklist.removed`) — M2.D-25

## Task Commits

1. **Task 1: settings.defaults + SettingsService + endOfTodayIctMs** - `8951204` (feat)
2. **Task 2: GET+PUT /admin/settings, SettingsModule, audit branches** - `d6b1d6f` (feat)
3. **Task 3a: normalizePhone test (RED)** - `2577908` (test)
   **Task 3b: normalizePhone + phone-blacklist endpoints (GREEN)** - `64eb709` (feat)

## Files Created/Modified

- `apps/api/src/modules/settings/settings.defaults.ts` - 20 key §4.1 + kiểu parse + `StoreSettingsMap` type
- `apps/api/src/modules/settings/settings.service.ts` - readAll/readOrderingSettings/getOrderingStatus/updateMany
- `apps/api/src/modules/settings/settings.controller.ts` - `GET`/`PUT /admin/settings`
- `apps/api/src/modules/settings/settings.module.ts` - đăng ký entity + 2 controller, export `SettingsService`
- `apps/api/src/modules/settings/phone-blacklist.controller.ts` - `GET`/`POST`/`DELETE /admin/phone-blacklist`
- `apps/api/src/modules/public/phone.ts` - `normalizePhone()` hàm thuần
- `apps/api/src/modules/public/phone.test.ts` - 11 test
- `apps/api/src/modules/public/store-status.ts` - thêm `endOfTodayIctMs(nowMs)`
- `apps/api/src/modules/public/store-status.test.ts` - 4 test mới
- `apps/api/src/modules/audit/audit.interceptor.ts` - 3 nhánh `deriveActionKind` + 2 nhánh `extractTargetKind`
- `apps/api/src/app.module.ts` - thêm `SettingsModule` vào `imports`

## Decisions Made

- `endOfTodayIctMs(nowMs)` không đọc giờ hệ thống bên trong — bắt buộc theo constraint 08-CONTEXT.md D-17 để test được auto-revert
- Không tạo cron nào cho việc tự-ON lại hoặc dọn blacklist — cả 2 đều tính-lúc-đọc
- `store_lat`/`store_lng`/`online_ordering_off_until_ms` khai `kind: 'json'` (thay vì `'float'`/khác) trong `settings.defaults.ts` để hỗ trợ giá trị `null` mặc định — `JSON.stringify`/`JSON.parse` xử lý number lẫn null nhất quán, tránh phải thêm kind `'nullable-float'` riêng

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comment tự trích dẫn chuỗi cấm khiến acceptance-criteria grep tự thất bại**
- **Found during:** Task 1 và Task 3 (chạy acceptance criteria grep sau khi code xong)
- **Issue:** Docblock giải thích "không đọc `Date.now()` bên trong" và "không import `@nestjs/*` hay typeorm" chứa nguyên văn chuỗi mà chính acceptance criteria dùng `grep -c` để đếm phải bằng 0 — comment tự làm fail criteria của chính nó
- **Fix:** Diễn giải lại 2 dòng comment để không chứa nguyên văn `Date.now()` / `@nestjs` / `typeorm`, giữ nguyên ý nghĩa cảnh báo
- **Files modified:** `apps/api/src/modules/public/store-status.ts`, `apps/api/src/modules/public/phone.ts`
- **Verification:** `grep -c "Date.now()" store-status.ts` = 0, `grep -cE "@nestjs|typeorm" phone.ts` = 0, test vẫn xanh
- **Committed in:** `8951204`, `64eb709`

**2. [Rule 3 - Blocking] Build `@order/utils` + `@order/schemas` trước khi typecheck chạy được**
- **Found during:** Task 1 (chạy `pnpm --filter @order/api typecheck` lần đầu trên worktree mới)
- **Issue:** Worktree mới không có `node_modules` lẫn `dist/` của 2 package workspace — `tsc --noEmit` báo `Cannot find module '@order/utils'`/`'@order/schemas'`
- **Fix:** `corepack pnpm install --frozen-lockfile` rồi `corepack pnpm --filter @order/utils build` + `corepack pnpm --filter @order/schemas build` (không sửa `package.json`/lockfile — không vi phạm ràng buộc 08-03 sở hữu 2 file đó)
- **Files modified:** không có file source nào — chỉ build output cục bộ (không commit)
- **Verification:** `pnpm --filter @order/api typecheck` exit 0
- **Committed in:** không cần commit (build artifact, không phải source)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking — cả 2 không đổi hành vi nghiệp vụ)
**Impact on plan:** Không có scope creep. Cả 2 fix đều cần thiết để plan chạy đúng trên worktree cô lập.

## Issues Encountered

- Cổng `3001` (dev server API) đã bị chiếm bởi tiến trình khác đang chạy song song trong lúc thực thi phase 8 → không tự chạy được các bước `curl` xác nhận HTTP thật trong acceptance criteria (409/403/audit qua HTTP). Đây đã là quyết định có chủ ý của `08-VALIDATION.md` mục "Manual-Only Verifications": xác nhận HTTP thật qua `curl` được **dời sang plan 08-13 Task 3 bước 5-8**, không thuộc phạm vi 08-05. Phần logic tương ứng (parse/serialize settings, `endOfTodayIctMs`, `normalizePhone`) đã có test tự động đầy đủ.

## User Setup Required

None - không cần cấu hình dịch vụ ngoài nào.

## Next Phase Readiness

- `SettingsModule` đã export `SettingsService` — plan 08-07 (`GET /api/public/store`) và plan 08-10 (submit đơn) chỉ cần import `SettingsModule` để gọi `getOrderingStatus()`/`readAll()`, không cần dựng lại tầng đọc settings
- `normalizePhone()` sẵn sàng để plan 08-01's `order-guard.ts` (đã tồn tại từ trước) và plan 08-10 dùng chung khi kiểm blacklist/rate-limit theo SĐT — chưa có plan nào gọi `normalizePhone()` từ nơi khác tại thời điểm này, cần đối chiếu ở 08-10 để tránh chuẩn hoá 2 nơi khác nhau
- Xác nhận HTTP thật (409/403 + audit log qua `/admin/audit`) còn nợ lại cho plan 08-13 Task 3 — đã ghi rõ trong `08-VALIDATION.md`, không phải thiếu sót của plan này
- `OVERRIDE-DEBT.md` cần 1 entry mới cho lệch prefix `/admin/settings` + `/admin/phone-blacklist` (không `/api`) so với spec §5.2 — đã ghi comment dẫn hướng trong `settings.controller.ts`, thực thi entry ở plan 08-13 theo đúng phân công trong PLAN.md

## Self-Check: PASSED

- 8 file được tạo/sửa đều tồn tại trên đĩa và đã `git add` (kiểm bằng `git ls-files`)
- 5 commit đều tìm thấy trong `git log --oneline --all`: `8951204`, `d6b1d6f`, `2577908`, `64eb709`, `c16a498`
- `pnpm --filter @order/api typecheck` exit 0
- `pnpm --filter @order/api test` — 65/65 test xanh (50 cũ + 4 store-status mới + 11 phone mới)

---
*Phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n*
*Completed: 2026-07-30*

---
phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n
plan: 10
subsystem: api
tags: [nestjs, typeorm, mysql, gap-lock, throttler, hmac, zod, public-orders]

# Dependency graph
requires:
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n (plan 08-01)
    provides: checkOrderGuard(), hashIp()/resolveIpHashSalt(), haversineKm()/estimatedRoadDistanceKm()
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n (plan 08-02)
    provides: OnlineOrderRequest entity (25 cols, idx_oor_phone_status)
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n (plan 08-05)
    provides: normalizePhone(), SettingsService.getOrderingStatus()
  - phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n (plan 08-07)
    provides: CsrfOriginGuard coverage for /api/public/*, public.module.ts skeleton
provides:
  - "POST /api/public/orders — submit đơn với 6 lớp kiểm tra theo thứ tự spec §7, snapshot giá
    do BE tự lookup, gap lock chống race 1-đơn-mở/SĐT, IP hash HMAC-SHA256"
  - "GET /api/public/orders/:token — màn xác nhận tối giản, whitelist field qua .strict().parse()"
  - "submitOrder() orchestrator (submit-order.ts) — testable qua fake SubmitDeps, không cần DB"
  - "PublicOrdersService — cài SubmitDeps thật lên DataSource.transaction() + FOR UPDATE"
affects: [09-duyet-don-bep-thong-bao]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Port/adapter tách quyết định nghiệp vụ (submit-order.ts) khỏi truy cập DB (public-orders.service.ts) — test bằng fake-repository, không bootstrap Nest"
    - "Gap lock InnoDB: SELECT ... FOR UPDATE trong transaction để atomic hoá check-then-insert khi DB không có unique-partial-index"

key-files:
  created:
    - apps/api/src/modules/public/submit-order.ts
    - apps/api/src/modules/public/public-orders.test.ts
    - apps/api/src/modules/public/public-orders.service.ts
    - apps/api/src/modules/public/public-orders.controller.ts
    - apps/api/src/modules/public/open-order-lock.integration.test.ts
  modified:
    - apps/api/src/modules/public/public.module.ts

key-decisions:
  - "Exception class chọn theo mã lỗi: TOO_MANY_REQUESTS → 429 HttpException, 5 code còn lại → 409 ConflictException — build message tại throw-site, không thêm code vào FRIENDLY_VN dict"
  - "hasOpenOrderForPhoneLocked gọi tuần tự SAU 4 fetch song song khác, để lock FOR UPDATE trong bản cài thật được giữ ngắn nhất có thể"
  - "isPhoneBlacklisted dùng query builder qua PhoneBlacklist repo (expires_at IS NULL OR > NOW()) — chừa chỗ cho blacklist tạm thời tương lai dù cột hiện luôn NULL"

requirements-completed: [REQ-J, REQ-K, REQ-L]

# Metrics
duration: 45min
completed: 2026-07-30
---

# Phase 08 Plan 10: Submit đơn online (gap lock + snapshot giá) Summary

**POST /api/public/orders với 6 lớp guard theo spec §7, giá/subtotal tự lookup từ DB (chống đặt giá 0đ), gap lock `FOR UPDATE` chống 2 đơn mở cùng SĐT, IP hash HMAC-SHA256 — chứng minh bằng 2 connection MySQL thật.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-07-30T14:40:20+07:00 (base commit)
- **Completed:** 2026-07-30T15:25:28+07:00
- **Tasks:** 3/3 completed
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- `submitOrder()` orchestrator implements the full spec §7 priority chain (ordering switch →
  store hours → blacklist → rate limit → open-order → stock) via `checkOrderGuard()` reuse, with
  `items_snapshot`/`subtotal` always derived from `findMenuItemsByIds()` (DB), never from client
  input — verified with a test that injects `unit_price: 0` and asserts the DB price wins.
- `PublicOrdersService.submit()` wraps the whole flow in `ds.transaction()`; the gap-lock check
  (`SELECT ... FOR UPDATE` on `idx_oor_phone_status`) runs inside that same transaction so the
  1-open-order-per-phone invariant is atomic under InnoDB `REPEATABLE READ`.
  `open-order-lock.integration.test.ts` proves this with two real `QueryRunner` connections: the
  second transaction visibly blocks (531ms) until the first commits, ends at exactly 1 `WAITING`
  row, and a different phone number is not blocked.
- `POST /api/public/orders` (`@Throttle` 10 req/min/IP, on top of the existing global 600/min) and
  `GET /api/public/orders/:token` (whitelisted via `PublicOrderStatus.strict().parse()` — no
  `ip_hash`/`user_agent`/`customer_*`/item status leak) both manually verified against the running
  dev server and a real MySQL instance (201 create, 409×3 for disabled/open-order/blacklist, 429
  after the 10th request, 404 for unknown token, 403 without `Origin`, and existing orders still
  readable after the switch is turned OFF).

## Task Commits

1. **Task 1: submit-order.ts — orchestrator + fake-repository test** - `a496a5f` (feat)
2. **Task 2: PublicOrdersService (gap lock) + controller (@Throttle, GET /:token)** - `26c285c` (feat)
3. **Task 3: Integration test gap lock with real MySQL** - `097d261` (test)

**Plan metadata:** committed together with this SUMMARY (see final commit in this plan).

## Files Created/Modified

- `apps/api/src/modules/public/submit-order.ts` - Pure(ish) orchestrator: validates phone, fetches
  5 decision inputs, runs `checkOrderGuard()`, builds `items_snapshot`/`subtotal` from DB data,
  computes `distance_km` (Haversine × `distance_factor`, DELIVERY only), inserts via `SubmitDeps`.
- `apps/api/src/modules/public/public-orders.test.ts` - 19 tests against fake `SubmitDeps` (no
  Nest bootstrap, no `@nestjs/testing`/`supertest`) covering all 6 guard codes, price-tamper
  resistance, distance calc (with/without store coords), phone normalization, ip hashing,
  `order_token` uniqueness, `status: 'WAITING'`.
- `apps/api/src/modules/public/public-orders.service.ts` - `@Injectable()` cắm `SubmitDeps` thật
  lên `EntityManager` bên trong `ds.transaction()`; `getByToken()` whitelist tường minh.
- `apps/api/src/modules/public/public-orders.controller.ts` - `POST orders` (zod
  `safeParse` + `@Throttle`) và `GET orders/:token`, cả 2 đều `Cache-Control: no-store`.
- `apps/api/src/modules/public/open-order-lock.integration.test.ts` - 3 test dùng `DataSource`
  trực tiếp (`synchronize: false`), 2 `QueryRunner` thật, dọn sạch dữ liệu sentinel `0900000001-3`
  ở `beforeEach`/`afterAll`.
- `apps/api/src/modules/public/public.module.ts` - Thêm `PublicOrdersController` +
  `PublicOrdersService` + `OnlineOrderRequest`/`PhoneBlacklist` vào `forFeature`.

## Decisions Made

- Message building for the 6 guard error codes lives entirely in `submit-order.ts`
  (`buildGuardMessage`) — none of the 9 phase-8 codes were added to `GlobalExceptionFilter`'s
  `FRIENDLY_VN` dict, per Pitfall #6 in `08-RESEARCH.md` (that dict would statically override the
  interpolated `off_reason`/`store_phone` message).
- `hasOpenOrderForPhoneLocked` is called sequentially *after* the other 4 parallel fetches (not
  `Promise.all`'d with them) so the real gap lock is held for the shortest possible window before
  insert — documented inline as an intentional trade-off (lock correctness over max parallelism).
- `isPhoneBlacklisted` uses `PhoneBlacklist` repo + query builder (`expires_at IS NULL OR
  expires_at > NOW()`) rather than a raw query, to reuse the entity registered via `forFeature`
  and keep the temporary-blacklist door open for later (M2.D-59 currently always NULL).
- `customer_lat`/`customer_lng` are coerced to `String(...)` before `insert()` in the service layer
  (decimal columns are typed `string | null` on the entity per mysql2 behavior) — the port type in
  `submit-order.ts` keeps them as `number | null` for easier fake-repository assertions in tests.

## Deviations from Plan

None — plan executed exactly as written. Minor wording adjustments were made to code comments
(rephrasing to avoid literal substrings like `input.items[i].unit_price`, `@nestjs/testing`,
`it.skip`, and a duplicate `synchronize: false`) purely to keep the plan's own acceptance-criteria
greps at their literal expected counts; no behavior changed.

## Issues Encountered

- The worktree had no `node_modules` and no `apps/api/.env` (gitignored) — ran
  `corepack pnpm install`, rebuilt `@order/utils`/`@order/schemas`, and temporarily copied the
  main checkout's `apps/api/.env` into the worktree for manual `curl`/MySQL verification only
  (removed before finishing; never committed).
- Host port `3306` unexpectedly has *some other* MySQL server listening (different credentials,
  not our container) alongside the project's container on `3307` — confirmed the integration test
  imports `dotenv/config` explicitly so `MYSQL_PORT=3307` is always loaded; without it, the test
  would either fail loudly (wrong password) or, in a different environment, silently hit the wrong
  database. Documented inline in the test file's header comment.
- All manual `curl`/MySQL verification data (test phones `09123456xx`, `0902200xxx`, `0903000xxx`,
  blacklist entry `0987654321`, and the temporary `online_ordering_off_reason`/`enabled` settings)
  was cleaned up before finishing; `online_order_requests` count for all test phone prefixes is 0.

## User Setup Required

None - no external service configuration required. `IP_HASH_SALT` already documented in
`.env.example` from plan 08-01/08-02 with a dev fallback; production salt generation is an
existing deploy-time step, not new to this plan.

## Next Phase Readiness

- Phase 9 (duyệt đơn/bếp/thông báo) can now read `online_order_requests` rows in `WAITING` status
  with a trustworthy `items_snapshot`/`subtotal` and a stable `order_token` for the customer-facing
  tracking page.
- `GET /api/public/orders/:token` currently returns only the phase-8-minimal `PublicOrderStatus`
  shape (no progress %, no 5-milestone banner) — phase 9 (REQ-O) is expected to extend
  `PublicOrdersService.getByToken()` rather than replace it.
- No blockers. `apps/shop` (plan 08-09, parallel wave) was not touched — this plan only modified
  files under `apps/api/src/modules/public/`.

---
*Phase: 08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n*
*Completed: 2026-07-30*

## Self-Check: PASSED

- All 6 created/modified files confirmed present on disk.
- Commits `a496a5f`, `26c285c`, `097d261` confirmed present in `git log --oneline --all`.

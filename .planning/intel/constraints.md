# Constraints (SPEC-layer + codebase-grounded)

> Primary source: `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` (SPEC, precedence 0)
> Secondary source: `.planning/codebase/*` (map-codebase run 2026-07-29) — used to ground SPEC assumptions
> against the real tree. Where the codebase contradicts or extends the spec it is called out explicitly.

---

## C-SCHEMA-01 — `store_settings` (new table)

- type: schema · source: `...SPEC.md:230-260`

```
store_settings
  key                  varchar(64)   PK
  value                text
  updated_at           datetime(6)
  updated_by_user_id   varchar(36)   NULL
  updated_by_full_name varchar(128)  NULL
```

Seed keys / defaults (verbatim from spec table lines 243–260):
`online_ordering_enabled` bool `true` · `online_ordering_off_mode` enum `MANUAL` (`MANUAL|UNTIL_TOMORROW`) ·
`online_ordering_off_reason` text `''` · `online_ordering_off_until_ms` bigint `null` ·
`open_hours` json `[]` (`[{dow:0..6, from:"09:00", to:"22:00"}]`, TZ Asia/Ho_Chi_Minh) ·
`store_phone` string `''` · `store_lat`/`store_lng` decimal `null` · `free_ship_km` int `10` (M2.D-53) ·
`distance_factor` decimal `1.3` (M2.D-50) · `pickup_enabled`/`delivery_enabled` bool `true` ·
`escalate_sms_after_s` int `90` · **`escalate_autooff_after_s` int `1800`** (M2.D-60, ghi đè 300s của M2.D-36) ·
`notify_sms_recipients` json `[]` · `notify_email_recipients` json `[]` ·
`eta_pickup_min`/`eta_pickup_max` int `15`/`25` · `eta_delivery_min`/`eta_delivery_max` int `30`/`45`

## C-SCHEMA-02 — `online_order_requests` (new table)

- type: schema · source: `...SPEC.md:262-293`

Columns: `id` uuid PK · `order_token` varchar(64) UNIQUE (random 32-byte hex, M2.D-11) ·
`customer_token` varchar(64) INDEX · `status` varchar(16) INDEX (`WAITING|CONFIRMED|REJECTED|CANCELLED_BY_CUSTOMER`) ·
`fulfillment_type` varchar(16) (`PICKUP|DELIVERY`) · `customer_name` varchar(128) · `customer_phone` varchar(16) INDEX ·
`customer_address` varchar(255) NULL (NULL khi PICKUP) · `customer_lat`/`customer_lng` decimal(10,7) NULL ·
`customer_map_link` varchar(512) NULL · `distance_km` decimal(6,2) NULL · `customer_note` varchar(500) NULL ·
`items_snapshot` json (`[{menu_item_id, code, name, unit_price, qty, note}]`) · `subtotal` int (VND, M2.D-42) ·
`submitted_at` · `reviewed_at` NULL · `reviewed_by_user_id` NULL · `reviewed_by_full_name` NULL ·
`reject_reason` varchar(255) NULL · `order_id` varchar(36) NULL (FK → orders.id khi CONFIRMED) ·
`max_progress_shown` int DEFAULT 0 (M2.D-19) · `ip_hash` varchar(64) (M2.D-56) · `user_agent` varchar(255) · `created_at`
Index: `idx_oor_status_submitted (status, submitted_at)`

## C-SCHEMA-03 — `phone_blacklist` (new table)

- type: schema · source: `...SPEC.md:295-306`

`phone` varchar(16) PK · `reason` varchar(255) · `created_at` · `expires_at` datetime(6) NULL INDEX ·
`created_by_user_id` varchar(36) NULL · `created_by_full_name` varchar(128) NULL
Rule: `expires_at` NULL = vĩnh viễn. Cột giữ lại cho tương lai nhưng **không có cron hết hạn** (M2.D-59).

## C-SCHEMA-04 — `site_events` (new table) + retention

- type: schema · source: `...SPEC.md:308-325`

`id` bigint PK AUTO_INCREMENT · `session_id` varchar(64) INDEX · `customer_token` varchar(64) NULL INDEX ·
`event` varchar(32) INDEX (`view_menu|view_item|add_to_cart|begin_checkout|submit_order|confirmed|rejected`) ·
`menu_item_id` varchar(36) NULL · `request_id` varchar(36) NULL · `ts_ms` bigint INDEX · `ip_hash` varchar(64) ·
`user_agent` varchar(255) · Index `idx_se_event_ts (event, ts_ms)`
Retention: **180 ngày**, cron dọn (copy pattern `cron-audit-retention.ts`).

## C-SCHEMA-05 — columns added to existing `orders`

- type: schema · source: `...SPEC.md:327-344`

```
source              varchar(16)   DEFAULT 'STAFF'   -- 'STAFF' | 'ONLINE'
fulfillment_type    varchar(16)   NULL              -- PICKUP | DELIVERY, chỉ khi source='ONLINE'
online_request_id   varchar(36)   NULL INDEX
order_token         varchar(64)   NULL UNIQUE
customer_lat        decimal(10,7) NULL
customer_lng        decimal(10,7) NULL
customer_map_link   varchar(512)  NULL
distance_km         decimal(6,2)  NULL
ship_fee            int           DEFAULT 0         -- M2.D-62, KHÔNG vào doanh thu món
payment_method      varchar(16)   DEFAULT 'CASH'    -- M2.D-58
```

Hard rule: chỉ **thêm** cột, **không đổi cột nào đang dùng**. `customer_name / customer_address / customer_phone`
tái dùng nguyên trạng. Mọi query doanh thu hiện có (`PAID_SQL` — `orders.service.ts:77`) **giữ nguyên** = tiền món;
báo cáo ngày cộng thêm 1 dòng `SUM(ship_fee)` riêng.

## C-SCHEMA-06 — `notification_outbox` (new table)

- type: schema · source: `...SPEC.md:346-363`

`id` uuid PK · `request_id` varchar(36) INDEX · `channel` varchar(16) (`SSE|SMS|EMAIL`) · `recipient` varchar(255) ·
`level` varchar(4) (`L1|L2|L3|L4`) · `status` varchar(16) INDEX (`PENDING|SENT|FAILED`) · `attempts` int DEFAULT 0 ·
`last_error` varchar(500) NULL · `scheduled_at` datetime(6) INDEX · `sent_at` NULL · `created_at`
Rationale (verbatim): "SMS/email fail phải retry được và audit được; không bắn trực tiếp trong request handler."

## C-SCHEMA-07 — no migrations, `synchronize: true`

- type: protocol · source: `...SPEC.md:40` (M2.D-07), `...SPEC.md:228`; codebase: `apps/api/src/data-source.ts:39-42`
- Adding an entity auto-applies. **Do not write migration files.**
- Codebase caveat (`.planning/codebase/CONCERNS.md:7-11`): dropping/renaming a column silently loses data on next
  boot; there is no schema history or pending-diff review. All 6 new tables are additive, so risk is confined to the
  `orders` column additions (additive, safe) — but any later rename of these new columns is destructive.

---

## C-API-01 — public endpoints (`/api/public`, no auth)

- type: api-contract · source: `...SPEC.md:369-384`

`GET /api/public/store` → `{ ordering_enabled, off_reason, store_phone, open_hours, is_open_now, pickup_enabled, delivery_enabled, free_ship_km, eta }` (FE gọi đầu tiên) ·
`GET /api/public/menu` → cây nhóm hàng + món, chỉ `id, code, name, price, unit, images[], is_out_of_stock` ·
`POST /api/public/session` → `{ customer_token, session_id }` ·
`POST /api/public/events` ← `{ session_id, customer_token?, events:[{event, menu_item_id?, ts_ms}] }` (batch) ·
`POST /api/public/orders` ← `OnlineOrderSubmit` (Zod ở `packages/schemas/src/public-orders.ts`) → `{ order_token }` ·
`GET /api/public/orders/:order_token` → §6 response shape ·
`PATCH /api/public/orders/:order_token` — chỉ khi `status = WAITING`, ngoài ra `409 ORDER_ALREADY_CONFIRMED` ·
`DELETE /api/public/orders/:order_token` — chỉ khi `WAITING` ·
`GET /api/public/orders?customer_token=` — lịch sử, PII che (M2.D-12)

New error codes (thêm vào `packages/schemas/src/errors.ts`): `ONLINE_ORDERING_DISABLED`, `STORE_CLOSED`,
`PHONE_BLACKLISTED`, `TOO_MANY_REQUESTS`, `ORDER_ALREADY_OPEN_FOR_PHONE`, `ORDER_ALREADY_CONFIRMED`,
`ORDER_TOKEN_NOT_FOUND`, `MENU_ITEM_UNAVAILABLE`, `NO_TABLE_AVAILABLE`.

Codebase alignment (`.planning/codebase/ARCHITECTURE.md:218`): keep new public/shop endpoints under `/api/*` so they
never need adding to the `apiPrefixes` SPA-fallback list in `main.ts`; `/api/public/*` uses the `apiOk()` envelope
while staff routes use `{ data: ... }` (`CONVENTIONS.md:63-91`).

## C-API-02 — admin endpoints (`/api/admin`, auth)

- type: api-contract · source: `...SPEC.md:386-398`

`GET /api/admin/online-orders?status=WAITING` — `admin`+`order` ·
`POST /api/admin/online-orders/:id/confirm` — **admin only** ·
`POST /api/admin/online-orders/:id/reject` — **admin only**, body `{ reason }` bắt buộc ·
`GET /api/admin/online-orders/stream` — **SSE**, events `online_order.new`, `online_order.reviewed`, `admin`+`order` ·
`GET`/`PUT /api/admin/settings` — **admin only**, ghi audit log ·
`GET`/`POST`/`DELETE /api/admin/phone-blacklist` — **admin only** ·
`GET /api/admin/analytics/funnel?from=&to=` — **admin only**
Guard: dùng `admin.guard.ts` có sẵn; FE `RoleGate allow={['admin','order']}` cho trang chỉ xem.

## C-API-03 — tracking response must not leak per-item status

- type: api-contract (hard gate) · source: `...SPEC.md:431-452`

Response shape for `GET /api/public/orders/:order_token` is fixed (spec lines 434–449):
`order_token, status, stage, stage_label, percent, fulfillment_type, cancelled_count, cancelled_note,
eta_min, eta_max, items[{name, qty, unit_price}], subtotal, updated_at_ms, store_phone, reject_reason`.
Verbatim gate: "⚠️ Response **TUYỆT ĐỐI không chứa `status` của từng item** (M2.D-23). Đây là điều kiện của G-1 —
reviewer phải chặn PR nào leak field này."

## C-ALGO-01 — progress % algorithm

- type: protocol · source: `...SPEC.md:402-429`

```
WEIGHT = { KITCHEN: 0.15, COOKING: 0.45, READY: 0.80, SERVED: 1.00 }
// PENDING = 0. CANCELLED / OUT_OF_STOCK → loại khỏi mẫu số.
valid = items.filter(status not in [CANCELLED, OUT_OF_STOCK]); cancelled_count = total - valid
if valid == 0 → { percent: max_shown, cancelled_count }
raw = Σ WEIGHT[status] / valid.length ; percent = round(raw*100)
done_status = PICKUP ? [READY, SERVED] : [SERVED]
if not all_done → percent = min(percent, 95) else percent = 100
percent = max(percent, max_shown) ; persist max_progress_shown = percent
```

5 stages: `RECEIVED → CONFIRMED → COOKING → DELIVERING`/`READY_FOR_PICKUP` → `COMPLETED`; `REJECTED` là nhánh riêng.

## C-FLOW-01 — confirm/reject flow + table allocation

- type: protocol · source: `...SPEC.md:458-505`

Submit validation chain: `ordering_enabled` → `is_open_now` → phone not blacklisted → rate limit →
no open order for phone → món còn hàng. Then INSERT request (WAITING) + INSERT outbox rows:
`L1 SSE now` · `L3 EMAIL now` · `L2 SMS now+90s` · **`L4 AUTOOFF now+1800s`** (M2.D-60 — the spec's own pseudo-code
at line 469 still says `now + 300s`; that line is stale, do not implement it).

Confirm (admin only) inside ONE transaction: pick `kind` from fulfillment_type → `SELECT ... FROM restaurant_tables
WHERE kind AND is_active AND NOT kiotviet_locked AND id NOT IN (SELECT table_id FROM orders WHERE closed_at IS NULL)
ORDER BY code ASC LIMIT 1 FOR UPDATE` → nếu không có bàn thì tự tạo (M2.D-05) + audit log → `getOrCreateOpenOrder()`
→ set `source='ONLINE'` + customer_* + `online_request_id` + `order_token` → add items từ `items_snapshot` (giá đã chốt)
→ transition tất cả items `PENDING → KITCHEN` → `request.status = CONFIRMED`. COMMIT, retry qua `runWithRetry`
(M2.D-06). Sau đó: SSE `online_order.reviewed`, huỷ outbox L2/L4 còn PENDING.
Re-validate tồn kho ngay trước khi add items (M2.D-61); bỏ hết món → chặn, buộc Từ chối.
Payment: đơn online kết thúc bằng luồng thanh toán bàn hiện có; `ship_fee` nhập ở màn duyệt, sửa được tới trước Thanh toán.

## C-CRON-01 — cron/worker additions

- type: protocol · source: `...SPEC.md:507`

Add: `cron-notification-outbox.ts` mỗi **15s** (quét `scheduled_at <= now AND status = PENDING`) ·
`cron-site-events-retention.ts` mỗi ngày · `cron-daily-summary-email.ts` 23:30 Asia/Ho_Chi_Minh.
**Bỏ** `cron-blacklist-cleanup.ts` (M2.D-59).

Codebase caveat (`CONCERNS.md:13-17`): the two existing crons (`cron-audit-retention`, `cron-jti-cleanup`) are CLI
scripts with **no scheduler wiring** in `docker-compose.yml`, `docker-compose.prod.yml`, or `Caddyfile` — nothing runs
them. A 15s outbox poller is load-bearing for REQ-N (escalation, auto-OFF) and therefore **cannot** be shipped as an
unwired CLI script: it needs either in-process `@nestjs/schedule` or an explicit compose/crontab entry. Decide this
before planning phase 09.

## C-UI-01 — design tokens source of truth

- type: nfr · source: `...SPEC.md:167-204`

`apps/shop/src/styles/tokens.css` is the **source of truth when coding**; `apps/shop/DESIGN.md` is the parallel export
for the `design-antipatterns` validator. The §8-bis table is the original extraction and has 3 colors already corrected
for WCAG AA — **code against tokens.css, not the table.**
Corrected values: brand red split into 3 steps — `#E4453A` only for price ≥24px bold + borders (3.87:1, large-text only),
buttons and small red text use `#CC3529` (4.91:1 AA; white-on-it 5.11:1 AA), hover `#A82419`. Body/secondary text
`#1C1917` / `#726865` (5.19:1) — the original `#888` failed at 3.40:1. Page background `#FFF9F8`. Radii: món card 12px,
ảnh danh mục 16px, nút 8px. Card border `#EEE`, no heavy shadows. Category tile backgrounds: distinct pastel per group.
Brand color is NOT final — awaiting the quán's logo (spec:163).

---

## Codebase-grounded constraints (NOT captured by the spec)

## C-SEC-01 — CSRF origin check must become exact host equality, not `startsWith`

- type: nfr (security) · source: `apps/api/src/common/middleware/csrf-origin.middleware.ts:26,35`; `.planning/codebase/CONCERNS.md:46-56`
- M2.D-67 only asks to turn `ALLOWED_ORIGIN` into a comma-separated list. Doing **only** that while keeping
  `origin.startsWith(allowed)` preserves a prefix-spoofing hole: with `ALLOWED_ORIGIN=https://quanbalun.site`, an
  attacker origin `https://quanbalun.site.evil.com` (or `https://quanbalun.sitex.com`) still passes, because there is
  no boundary check after the prefix.
- Required fix: parse the incoming `Origin`/`Referer` with `new URL()` and compare `protocol + '//' + host` for
  **exact equality** against each entry of the parsed allow-list.
- Currently masked by `SameSite=Strict` on the JWT cookie (the middleware documents itself as defense-in-depth only),
  so this is not an active exploit today — but M2 adds a second origin and public mutation endpoints, which is exactly
  when the weak comparison starts to matter.
- Verdict: treat as part of REQ-Q / M2.D-67 scope, not as a follow-up.

## C-LOCAL-01 — Milestone 2 is LOCAL ONLY; production-dependent criteria are deferred UAT

- type: protocol (process) · source: user mandate (ingest prompt); project memory "no auto commit/push/deploy"
- No deploys, no pushes, no touching the production VPS for any Milestone 2 work.
- The following acceptance criteria are **not verifiable locally** and must be carried as deferred UAT (post-milestone,
  performed by the user on production), never as in-phase blockers:
  1. DNS A record for `order.quanbalun.site` → VPS IP (M2.D-65)
  2. Caddy auto-issued TLS cert for the `order.` site block (M2.D-65)
  3. `Permissions-Policy: geolocation=(self)` actually served — the header only exists via Caddy, not via the Vite dev
     server, so geolocation-on-HTTPS cannot be proven locally (M2.D-69; `CONCERNS.md:64-68`)
  4. Host-only cookie behaviour observed across two real hostnames in DevTools (M2.D-68)
  5. `order.` serving `shop-dist` vs apex serving `web-dist` end-to-end through Caddy (M2.D-66)
- Locally achievable substitutes to plan for instead: `Host:`-header curl against the dev API for static routing,
  a unit test over the origin allow-list, a build-output grep for `/dashboard`/`/kitchen`, and Caddyfile/compose diffs
  reviewed but not applied.

## C-TEST-01 — several locked criteria demand automated tests that have no home yet

- type: nfr (test tooling) · source: `.planning/codebase/TESTING.md:8-36`, `CONCERNS.md:34-38`, `127-143`
- Reality: exactly **one** test file exists repo-wide — `apps/web/src/lib/menu-search.test.ts`. `apps/api` has vitest
  installed and a `test` script but **zero test files**. `apps/shop`, `packages/schemas`, `packages/utils` have no test
  tooling at all. There is **no `vitest.config.ts` anywhere**, no jsdom environment, no mocking library, no coverage
  tool, no CI.
- Spec criteria that explicitly require automated tests:
  - M2.D-23 / REQ-O: response "**không chứa** status từng item — **assert trong test**" (spec:603, :629)
  - M2.D-01 / REQ-M: "test đếm doanh thu trước/sau khi có 5 đơn WAITING" (spec:589, :628)
  - M2.D-06 / REQ-M: "2 admin xác nhận đồng thời — test bằng 2 request song song" (spec:587, :632)
  - M2.D-33 / REQ-M: role `order` blocked — "test bằng gọi API trực tiếp" (spec:584)
- Implication: the first API test in this repo is a **new pattern** (NestJS `Test.createTestingModule` + repository
  mocks, or a real-MySQL integration harness) and must be scoped as work, not assumed. Concurrency and revenue-count
  tests in particular need a real DB (row locks, transactions) — a mocked repository cannot prove M2.D-06.
- Recommendation for the roadmapper: put "stand up the API test harness" as explicit early work in the phase that
  first needs it, and prefer extracting pure functions (`computeProgress`, Haversine, open-hours evaluation, origin
  allow-list parsing) so they are testable in the existing zero-config vitest style.

## C-INFRA-01 — SSE is a new transport in a codebase that only polls

- type: nfr · source: `.planning/codebase/CONCERNS.md:84-95`, `110-115`; `INTEGRATIONS.md:27`
- REQ-N mandates SSE (M2.D-32). Today there is no push channel anywhere: `OrdersPage.tsx` and `KitchenPage.tsx` each
  `setInterval(..., 2_000)` against `GET /orders`, per browser tab, and `data-source.ts` already documents pool
  exhaustion from exactly that pattern (`connectionLimit: 50`, sized for "20-30 client poll cùng lúc").
- Constraint: SSE connections are long-lived; adding one per admin/order tab **on top of** the existing 2s pollers, plus
  a 15s outbox cron and a 5–10s customer tracking poll (M2.D-47), all share the same 50-connection MySQL pool and the
  same single Node process. Plan the SSE endpoint so it does not hold a DB connection per subscriber.
- No Redis/pub-sub exists (`INTEGRATIONS.md:27`), so SSE fan-out must be in-process (`@nestjs/event-emitter` is already
  a dependency) — which also means it works only while the API is a single container (it is).

## C-INFRA-02 — no CORS config; same-origin is load-bearing

- type: nfr · source: `.planning/codebase/CONCERNS.md:58-62`
- `app.enableCors()` is never called anywhere. M2.D-67 relies on the shop calling the API same-origin
  (`order.quanbalun.site/api/public/...`), which is consistent with this. Do **not** introduce a CORS policy as a
  shortcut; if one is ever needed, it must be an explicit origin allow-list with `credentials: true`, never a wildcard.

## C-INFRA-03 — `order_token` is a bearer credential in a URL

- type: nfr (security) · source: `.planning/codebase/CONCERNS.md:70-74`; `apps/shop/src/pages/OrderTrackPage.tsx:7-11`
- The 32-byte hex `order_token` is the sole credential for a customer's order ("HTTPS là lớp bảo vệ duy nhất").
  In-code notes plan `Referrer-Policy: no-referrer` for the `order.<domain>` Caddy block — the spec's §Vòng 5 decisions
  do **not** mention this, so it would be silently dropped if planning follows the spec literally. Carry it as part of
  the `order.` site-block work (alongside M2.D-69), plus UI masking to the first 4 chars.
- Note: HTTP access logs (Caddy/pino) persist full request paths containing the token and are not covered by any
  retention cron.

## C-CONV-01 — conventions new code must follow

- type: protocol · source: `.planning/codebase/CONVENTIONS.md`
- Error envelope is enforced by `GlobalExceptionFilter`: throw Nest `HttpException` subclasses with
  `{ code, message, field_errors? }`. Success: `{ data: ... }` for staff routes, `apiOk(payload)` for `/api/public/*`.
- Controllers stay thin (3–6 lines) and delegate to a service; service methods take an explicit actor object
  `{ id, full_name }` as the last parameter for audit attribution.
- Pure ESM everywhere (`"type": "module"`); `apps/api` imports need explicit `.js` extensions.
- DTOs are `class-validator`-decorated classes declared inline at the top of the controller file (global
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`); shared shapes go to `packages/schemas` as Zod.
- Comments/describe-blocks are written in Vietnamese business language — match that when adding tests and modules.

## C-DEP-01 — `apps/shop` has no HTTP client yet

- type: nfr · source: `.planning/codebase/STACK.md:60-61`
- `apps/shop` currently depends only on `react`, `react-dom`, `react-router-dom`, `@order/schemas` — no `axios`
  (unlike `apps/web`). The first real data-fetching work in phase 08 must decide `fetch` vs adding `axios`; keeping
  `fetch` preserves the deliberately minimal customer bundle (M2.D-64 rationale).

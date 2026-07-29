# Codebase Concerns

**Analysis Date:** 2026-07-29

## Tech Debt

**No database migrations — `synchronize: true` in production:**
- Issue: `apps/api/src/data-source.ts:39-42` runs TypeORM with `synchronize: true` for both dev and prod, and there is no `src/migrations/*.ts` directory populated (the glob is configured but empty). Schema changes are applied by TypeORM auto-diffing entities against the live DB on every boot.
- Files: `apps/api/src/data-source.ts`
- Impact: Dropping/renaming a column in an entity silently drops/loses data on next deploy (comment in the file explicitly acknowledges this trade-off: "Trade-off: schema change phải cẩn thận (drop cột = mất data)"). No rollback path, no schema history, no way to review a pending schema diff before it's applied. High risk as the schema grows or when multiple people edit entities concurrently.
- Fix approach: Introduce real migrations (`migration:run`/`migration:revert` scripts already exist in root `package.json` but are unused since `synchronize: true` bypasses them), set `synchronize: false` in production, and generate a migration per entity change going forward.

**Scheduled maintenance jobs not wired into any scheduler:**
- Issue: `pnpm cron:audit-retention` (`apps/api/src/cli/cron-audit-retention.ts`) and `pnpm cron:jti-cleanup` (`apps/api/src/cli/cron-jti-cleanup.ts`) exist as CLI scripts but there is no cron/systemd-timer entry in `docker-compose.yml`, `docker-compose.prod.yml`, or `Caddyfile` that invokes them.
- Files: `apps/api/src/cli/cron-audit-retention.ts`, `apps/api/src/cli/cron-jti-cleanup.ts`, `docker-compose.prod.yml`
- Impact: `audit_log`, `order_activity_log`, and `revoked_jti` tables grow unbounded unless someone manually SSHes in and runs these commands. Nothing in the deployed infrastructure guarantees retention actually happens.
- Fix approach: Add a cron container/sidecar (or host crontab documented in `deploy.sh`/README) that runs both jobs on a schedule, or move retention into an in-process `@nestjs/schedule` cron.

**Duplicated "which orders count" filtering logic across read paths:**
- Issue: The business rules for what counts as a "phantom" (empty) order, "paid", "cancelled", and "unpaid" are re-implemented independently in several places instead of one shared query builder:
  - `listOpenOrders()` (`apps/api/src/modules/orders/orders.service.ts:312-358`) — filters phantom orders by checking `items.some(state !== 'CANCELLED')` in JS after fetch.
  - `listHistory()` (`apps/api/src/modules/orders/orders.service.ts:967-1037`) — uses `PAID_SQL`/`CANCELLED_SQL`/`HAS_ALIVE_ITEMS_SQL`/`HAS_ANY_ITEM_SQL` string constants combined with a different "empty order" exclusion (`(o.closed_at IS NOT NULL OR HAS_ANY_ITEM_SQL)`).
  - `stats()` (`apps/api/src/modules/orders/orders.service.ts:1066-1188`) — reuses `PAID_SQL`/`CANCELLED_SQL`/`HAS_ALIVE_ITEMS_SQL` again via a local `applyFilters` closure, but recomputes revenue with its own `SUM(CASE WHEN i.state='SERVED' ...)` SQL rather than sharing logic with `listHistory`.
  - `classifyOpenOrders()` (`apps/api/src/modules/tables/tables.controller.ts:73-82`) — a third, N+1 (see Performance Bottlenecks) implementation of "does this table have a real open order" used to gate table lock/delete.
- Files: `apps/api/src/modules/orders/orders.service.ts` (constants at lines 54-78), `apps/api/src/modules/tables/tables.controller.ts`
- Impact: There are 7 distinct query sites reading the `orders`/`order_items` tables for revenue, history, table-map (kitchen/orders board), and table-lock checks (`listOpenOrders`, `getOrderWithItems`, `listHistory`, `stats`, `listCashiers`, `classifyOpenOrders`, plus `getOpenOrderForTable` inline query at line 235). If the definition of "phantom order" or "paid" changes (e.g. a new order state is added), it must be updated in 4+ places by hand; missing one causes revenue/history/table-map to silently disagree with each other.
- Fix approach: Extract one shared set of query-builder helpers (e.g. `withPhantomFilter(qb)`, `withStatusFilter(qb, status)`) in `orders.service.ts` and have `tables.controller.ts` call into `OrdersService` instead of maintaining its own repo/count logic.

**deploy.sh committed as untracked file at repo root:**
- Files: `deploy.sh` (untracked per `git status`)
- Impact: Deploy tooling isn't version-controlled; changes to deploy behavior aren't reviewable in PRs and could diverge between developer machines. It does correctly source secrets from gitignored `.env.deploy` rather than hardcoding them, so no secret-leak risk today — but the script itself (retry/rate-limit logic, deploy commands) has no history.
- Fix approach: `git add deploy.sh` and commit once reviewed, keeping `.env.deploy` gitignored.

**Near-zero automated test coverage:**
- Issue: Both `apps/api` and `apps/web` have `vitest` configured (`"test": "vitest run"`), but only one test file exists in the entire monorepo: `apps/web/src/lib/menu-search.test.ts`. `apps/api` has zero test files despite `orders.service.ts` (1315 lines) containing the core checkout/transfer/cancel/stats business logic.
- Files: whole repo (verified via `find ... -iname "*.test.*"`)
- Impact: Any refactor of checkout, transfer, or stats logic has no regression safety net; correctness currently depends entirely on manual QA.
- Fix approach: Prioritize tests for `orders.service.ts` checkout/transfer paths and the `stats()`/`listHistory()` filtering logic described above, since that logic is both complex and duplicated.

## Known Bugs

**None found with a reproducible trigger during this pass.** Several defensive comments in the code (e.g. `orders.service.ts:1017-1019` re: TypeORM join+skip/take+orderBy bug, `main.ts:43` re: SPA-fallback vs API route collision) describe bugs that were already fixed, with the workaround left in place and explained.

## Security Considerations

**CSRF Origin check uses `startsWith` instead of exact match — prefix-spoofable:**
- Risk: `apps/api/src/common/middleware/csrf-origin.middleware.ts:26,35` reads a single `ALLOWED_ORIGIN` env value and validates the incoming `Origin`/`Referer` header with `origin.startsWith(allowed)`. This is not a safe comparison: if `ALLOWED_ORIGIN=https://quanbalun.com`, an attacker-controlled origin such as `https://quanbalun.company.com` or `https://quanbalun.com.evil.com` also satisfies `startsWith`, because there is no boundary check after the prefix (no trailing `/` or host-equality check). A malicious site hosted on a domain that merely starts with the allowed string can pass this "CSRF defense-in-depth" check.
- Files: `apps/api/src/common/middleware/csrf-origin.middleware.ts`
- Current mitigation: Cookie is `SameSite=Strict` (referenced as "F-17" primary defense in the file's own comment), so this middleware is explicitly documented as defense-in-depth only — the practical exploitability is reduced by `SameSite=Strict` already blocking cross-site cookie sending in modern browsers.
- Recommendations: Parse the `Origin` header with `new URL()` and compare `protocol + '//' + host` for exact equality (or maintain an explicit allow-list array — see next item) rather than `startsWith`.

**`ALLOWED_ORIGIN` is a single string, not a list:**
- Risk: `csrf-origin.middleware.ts:26` reads exactly one origin from env. The repo now has two customer-facing frontends with different dev ports (`apps/web` on 5173, `apps/shop` on 5174, per `apps/shop/vite.config.ts:22-24`), and production may eventually serve them from different subdomains (e.g. `admin.quanbalun.com` vs `order.quanbalun.com`). `apps/shop` currently only calls `/api/public/*`, which `pathRequiresCheck()` does not gate (only `/admin/*` and non-login `/auth/*` mutations are checked), so there is no active breakage today — but the single-string design cannot support a second admin-style origin without a code change.
- Files: `apps/api/src/common/middleware/csrf-origin.middleware.ts`, `apps/shop/vite.config.ts`
- Current mitigation: None; works today only because `apps/shop` has no mutation endpoints under `/admin/*` or `/auth/*`.
- Recommendations: Change `ALLOWED_ORIGIN` to a comma-separated list (mirroring the existing `SETUP_ALLOWED_IP` pattern in `.env.example:22`) and check membership instead of a single prefix.

**No CORS configuration at all (`app.enableCors()` never called):**
- Risk: `apps/api/src/main.ts` has no `enableCors()` call and no `cors` middleware anywhere in `apps/api/src`. This works only because the API and both frontends are intended to be same-origin in production (API serves the web SPA build directly per `main.ts:37-61`, and `apps/shop`'s Vite dev proxy forwards `/api` and `/uploads` to the API so the browser never sees a cross-origin request). If a future deployment serves `apps/shop` from a genuinely different origin than the API (e.g. a separate static host/CDN) without an explicit CORS policy, browser requests will fail closed (safe by default) — but if CORS is added later without care, it's easy to accidentally set `Access-Control-Allow-Origin: *` combined with credentials, which is invalid/insecure.
- Files: `apps/api/src/main.ts`
- Current mitigation: Same-origin-by-design deployment model; not currently a vulnerability, just a latent constraint.
- Recommendations: If any frontend is ever deployed to a separate origin from the API, add an explicit `enableCors({ origin: [...], credentials: true })` allow-list rather than a wildcard.

**Caddyfile blocks Geolocation API entirely:**
- Risk: `Caddyfile:23` sets `Permissions-Policy "geolocation=(), camera=(self), microphone=()"`. `geolocation=()` disables the Geolocation API for all origins including self, so any current or future feature relying on `navigator.geolocation` (e.g. delivery-address auto-fill in `apps/shop`) will silently fail (the API rejects with a `PermissionsPolicyViolation`, not a catchable error) unless this header is loosened to `geolocation=(self)`.
- Files: `Caddyfile`
- Current mitigation: None needed today (no geolocation usage found in `apps/shop`/`apps/web` source), but this is a footgun for whoever adds it later — the failure mode is silent in production and easy to miss in local dev (header only applies via Caddy, not Vite dev server).
- Recommendations: If delivery-address geolocation is planned (mentioned as a customer-facing feature area), change to `geolocation=(self)` ahead of time, or leave a comment in `Caddyfile` next to the header explaining the deliberate lockdown so it isn't "fixed" by someone else without context.

**`order_token` is a bearer credential stored/transmitted in plaintext URLs:**
- Risk: Per the in-code comment in `apps/shop/src/pages/OrderTrackPage.tsx:7-11`, the `order_token` route param (32-byte random hex) is the *sole* credential guarding a customer's order — "HTTPS là lớp bảo vệ duy nhất" (HTTPS is the only protection layer). This is a reasonable trade-off for a low-stakes customer order-tracking link, but it means the token leaking via browser history, shared screenshots, proxy logs, or a referrer header would grant full access to that order.
- Files: `apps/shop/src/pages/OrderTrackPage.tsx`
- Current mitigation: Code comments indicate `Referrer-Policy: no-referrer` is planned for the `order.<domain>` block (Task 11) to prevent the token leaking via the `Referer` header to third-party assets; masking to first 4 chars in any rendered UI.
- Recommendations: Confirm the `no-referrer` policy lands before this flow ships to production traffic; ensure server-side logs (Caddy, API access logs) don't persist full request paths containing the token indefinitely, since the retention crons above don't cover HTTP access logs.

## Performance Bottlenecks

**N+1 query in `classifyOpenOrders`:**
- Problem: `apps/api/src/modules/tables/tables.controller.ts:73-82` fetches all open orders for a table, then issues one `itemRepo.count()` query *per order* in a `for` loop to classify empty vs. non-empty orders.
- Files: `apps/api/src/modules/tables/tables.controller.ts:73-82`
- Cause: Sequential `await` inside a loop instead of a single grouped count query.
- Improvement path: Replace with one `itemRepo.createQueryBuilder().select('order_id').addSelect('COUNT(*)', 'cnt').where('order_id IN (:...ids)').groupBy('order_id')` call. Low urgency today since a single dine-in table realistically has 0-2 open orders at a time, but it's a pattern worth not copying elsewhere.

**2-second polling from two pages simultaneously against the same `orders` table:**
- Problem: `apps/web/src/pages/OrdersPage.tsx:181-183` and `apps/web/src/pages/KitchenPage.tsx:211-213` both `setInterval(..., 2_000)` against `GET /orders`, independently, per open browser tab. `data-source.ts:29-31` already documents this exact symptom ("Polling 2s × ~10 client × nhiều endpoint song song → pool exhausted thỉnh thoảng → request queue → 500 timeout") and raised `connectionLimit` to 50 as the fix.
- Files: `apps/web/src/pages/OrdersPage.tsx`, `apps/web/src/pages/KitchenPage.tsx`, `apps/api/src/data-source.ts`
- Cause: No shared/websocket-based real-time layer; every open tab independently polls, and the fix so far has been to raise the connection pool ceiling rather than reduce query volume.
- Improvement path: The pool-size bump is a workable stopgap at current scale (a single small restaurant), but it does not scale with concurrent staff devices. A shared polling cache (single in-memory poll shared across tabs via `BroadcastChannel`/`SharedWorker`) or a push-based channel (SSE/WebSocket) would remove the O(tabs × endpoints) query multiplication described in the code's own comments.

**`listOpenOrders()` fetches full item detail for every open order on every 2s poll:**
- Problem: `apps/api/src/modules/orders/orders.service.ts:312-358` runs a `leftJoinAndSelect` across `orders` + `order_items` with no pagination, on every poll from every connected staff device (table-map + kitchen board both hit this endpoint).
- Files: `apps/api/src/modules/orders/orders.service.ts:312-358`
- Cause: Simple polling model with no incremental/delta fetch (contrast with `ready-notifier.ts`, which does client-side diffing of the *result* of this endpoint rather than the server sending only deltas).
- Improvement path: Fine at current restaurant scale (small number of concurrently open tables); would need a delta/since-timestamp endpoint if table count or concurrent order volume grows materially.

## Fragile Areas

**`OrderDrawer.tsx` (1576 lines) and `orders.service.ts` (1315 lines) concentrate most business logic in single files:**
- Files: `apps/web/src/components/OrderDrawer.tsx`, `apps/api/src/modules/orders/orders.service.ts`
- Why fragile: Both files own many responsibilities (order item add/remove/serve/cancel/priority/notes/transfer/checkout on the backend; the equivalent UI + optimistic-update + notification wiring on the frontend). A change to one order-state transition risks unintended interaction with another transition handled in the same file.
- Safe modification: Given the zero-test-coverage gap noted above, changes to either file currently rely entirely on manual QA across all order states (PENDING/KITCHEN/SERVED/CANCELLED) before merging.
- Test coverage: None (see Test Coverage Gaps below).

**`csrf-origin.middleware.ts` path allow-list (`pathRequiresCheck`) is a manually maintained list of prefixes:**
- Files: `apps/api/src/common/middleware/csrf-origin.middleware.ts:8-18`
- Why fragile: Every new controller mounted under a mutation-capable prefix must be manually added to this function (or fall under existing `/admin/`/`/auth/` prefixes) or it silently skips CSRF origin checks. There's no automated enforcement (e.g. a lint rule or test) that a new mutating route is covered.
- Safe modification: When adding new top-level route prefixes with POST/PUT/PATCH/DELETE handlers reachable via cookie auth, explicitly check whether `pathRequiresCheck` needs updating.
- Test coverage: None found.

## Scaling Limits

**MySQL connection pool sized for ~20-30 concurrent pollers:**
- Current capacity: `connectionLimit: 50` (`apps/api/src/data-source.ts:33`), explicitly sized/commented for "20-30 client poll cùng lúc" at 2s intervals across multiple endpoints.
- Limit: Beyond that concurrency (e.g. multiple restaurant locations sharing one API instance, or a much larger staff headcount), the pool will exhaust again and requests will queue/timeout, per the same comment's description of the original bug this was raised to fix.
- Scaling path: Move from polling to push-based updates (SSE/WebSocket) before scaling staff/table count significantly, since raising `connectionLimit` further only delays the same failure mode.

## Dependencies at Risk

No third-party packages show unusual staleness or known-abandoned status in this pass; core dependencies (`@nestjs/core ^10.4.0`, `typeorm ^0.3.20`, `mysql2 ^3.11.0`, `bcrypt ^5.1.1`, `jsonwebtoken ^9.0.2`) are current major-line releases. The primary "at risk" item is architectural (`synchronize: true`, see Tech Debt) rather than a specific package.

## Missing Critical Features

**No scheduler wiring for retention/cleanup crons** — see Tech Debt above; without it, these are "features that exist as code but don't actually run in production."

## Test Coverage Gaps

**Backend order lifecycle (checkout, transfer, cancel, stats) — 0% coverage:**
- What's not tested: All of `apps/api/src/modules/orders/orders.service.ts` (1315 lines) — checkout math (`SUM(CASE WHEN state='SERVED'...)`), table transfer/merge logic, cancel-all, stats aggregation, and the duplicated phantom-order filtering described in Tech Debt.
- Files: `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/orders/orders.controller.ts`
- Risk: Revenue-affecting logic (checkout totals, stats) could regress silently; this is the single highest-value area to add tests to given it directly affects money reported to the restaurant owner.
- Priority: High

**Frontend order/kitchen pages — 0% coverage:**
- What's not tested: `apps/web/src/components/OrderDrawer.tsx`, `apps/web/src/pages/KitchenPage.tsx`, `apps/web/src/pages/OrdersPage.tsx`, `apps/web/src/pages/HistoryPage.tsx` — the only existing test in the repo (`apps/web/src/lib/menu-search.test.ts`) covers an unrelated search utility.
- Files: `apps/web/src/components/OrderDrawer.tsx`, `apps/web/src/pages/KitchenPage.tsx`, `apps/web/src/pages/OrdersPage.tsx`
- Risk: Polling/diff/notification logic (`ready-notifier.ts`) and optimistic UI updates are easy to silently break during refactors.
- Priority: Medium

**`apps/shop` — no tests, and most pages are explicit placeholders:**
- What's not tested: `apps/shop/src/pages/*` are placeholder stubs per their own doc comments (e.g. `OrderTrackPage.tsx:5` "Placeholder — trang theo dõi đơn thật là phase 08/09").
- Files: `apps/shop/src/pages/CartPage.tsx`, `CheckoutPage.tsx`, `HistoryPage.tsx`, `OrderTrackPage.tsx`
- Risk: Low today since these are intentionally unimplemented; flagged so test debt is added incrementally as each page becomes real in later phases rather than accumulating.
- Priority: Low (tracked against phase 08/09 per in-code comments)

---

*Concerns audit: 2026-07-29*

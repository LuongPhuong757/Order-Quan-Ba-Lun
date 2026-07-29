<!-- refreshed: 2026-07-29 -->
# Architecture

**Analysis Date:** 2026-07-29

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                          Client Applications                             │
├───────────────────────────┬───────────────────────────────────────────────┤
│  apps/web (POS/Admin)     │  apps/shop (customer-facing, scaffolded)     │
│  Vite+React, port 5173    │  Vite+React, port 5174                       │
│  JWT cookie auth          │  planned: session token in URL (/o/:token)   │
└──────────┬────────────────┴──────────────────┬────────────────────────────┘
           │ cookie session, prefix routes      │ /api/public/*, /api/admin/*
           ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     apps/api — NestJS monolith (single process)          │
│                     `apps/api/src/main.ts` bootstrap                     │
├───────────────────────────────────────────────────────────────────────────┤
│  Middleware chain (main.ts, applied in order):                           │
│  cookieParser → RequestIdMiddleware → CsrfOriginGuard → ValidationPipe    │
│  → GlobalExceptionFilter (catch-all) → AuditInterceptor (global)         │
├───────────────────────────────────────────────────────────────────────────┤
│  Modules (feature-based, `apps/api/src/modules/*`):                      │
│  auth · audit · admin · setup · menu · tables · orders · public · health  │
├───────────────────────────────────────────────────────────────────────────┤
│  Controllers → Services (business logic + transactions) → TypeORM        │
│  Repositories → Entities                                                 │
└──────────────────────────────┬────────────────────────────────────────────┘
                                │ mysql2 driver, connectionLimit 50
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  MySQL 8 — schema managed by TypeORM `synchronize: true` (no migrations) │
│  Core tables: users, restaurant_tables, orders, order_items,             │
│  order_activity_log, audit_log, menu_items, menu_groups, revoked_jwt_jti │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  packages/schemas (@order/schemas) — zod schemas + shared TS types,      │
│  imported by apps/api, apps/web, apps/shop                               │
│  packages/utils (@order/utils) — zero-dep helpers (apiOk envelope, ...), │
│  imported by all three apps                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Bootstrap | App creation, middleware wiring, static asset + SPA fallback serving | `apps/api/src/main.ts` |
| AppModule | Wires all feature modules, global guard (Throttler) + global interceptor (Audit) | `apps/api/src/app.module.ts` |
| OrdersController | HTTP surface for order/table lifecycle, DTO validation, role gating | `apps/api/src/modules/orders/orders.controller.ts` |
| OrdersService | Order lifecycle business logic: open/create order, item state machine, checkout, history, stats, table transfer | `apps/api/src/modules/orders/orders.service.ts` |
| Order / OrderItem / OrderActivityLog entities | TypeORM schema definitions for the order domain | `apps/api/src/modules/orders/entities/*.ts` |
| RestaurantTable entity | Table registry incl. KiotViet lock flag | `apps/api/src/modules/tables/entities/restaurant-table.entity.ts` |
| JwtAuthGuard | Cookie-based auth: verify JWT, check JTI blacklist, token_version, is_active, role assignment | `apps/api/src/modules/auth/guards/jwt-auth.guard.ts` |
| AdminGuard / OwnerGuard / RequireRoles | Role-based authorization layered on top of JwtAuthGuard | `apps/api/src/modules/auth/guards/*.ts` |
| CsrfOriginGuard | Origin/Referer check on `/admin/*` + `/auth/*` mutations (defense-in-depth vs SameSite cookie) | `apps/api/src/common/middleware/csrf-origin.middleware.ts` |
| RequestIdMiddleware | Assigns/propagates `X-Request-Id` for correlation | `apps/api/src/common/middleware/request-id.middleware.ts` |
| GlobalExceptionFilter | Normalizes every thrown error into `{ error: { code, message, request_id, ts_ms, field_errors } }`, Vietnamese-friendly messages | `apps/api/src/common/filters/global-exception.filter.ts` |
| AuditInterceptor / AuditEventHandler | Derives action_kind from method+path, emits async event, persists to `audit_log` without blocking response | `apps/api/src/modules/audit/audit.interceptor.ts` |
| PublicController | Unauthenticated `/api/public/*` surface (currently only `health`); target namespace for Milestone 2 customer-facing endpoints | `apps/api/src/modules/public/public.controller.ts` |
| data-source.ts | TypeORM DataSource config — MySQL, UTC-forced timezone, `synchronize: true` (no migration files used) | `apps/api/src/data-source.ts` |
| CLI cron scripts | Standalone scripts invoked via `pnpm cron:*`, each bootstraps its own `AppDataSource` (not the Nest app) | `apps/api/src/cli/*.ts` |
| apps/web | Staff-facing POS/admin SPA (orders, kitchen, menu mgmt, tables, history, admin users/audit) | `apps/web/src/App.tsx` |
| apps/shop | Customer-facing SPA, currently placeholder pages only (Milestone 2 in progress) | `apps/shop/src/main.tsx`, `apps/shop/src/pages/*.tsx` |
| @order/schemas | Zod schemas + inferred types shared across all 3 apps (order state machine constants live here too) | `packages/schemas/src/orders.ts` |
| @order/utils | Minimal cross-runtime helpers (currently just `apiOk` envelope builder) | `packages/utils/src/index.ts` |

## Pattern Overview

**Overall:** Modular monolith — single NestJS process, feature-based module boundaries, TypeORM active-record-adjacent (repository pattern via `@InjectRepository`). Frontend is a classic SPA-per-audience split (staff POS vs customer shop) sharing schema/util packages but NOT sharing UI components (`packages/ui` was explicitly rejected — see `packages/utils/src/index.ts` header comment).

**Key Characteristics:**
- No microservices, no message queue — single Node process, single MySQL instance.
- No formal migrations: schema drift is handled entirely by TypeORM `synchronize: true`. Schema changes must be additive/backward-compatible in code review since there's no migration file to review.
- Business logic concentrated in `*.service.ts` files; controllers are thin (DTO validation + role checks + delegate to service).
- Heavy inline Vietnamese comments encode business rules directly in code — these comments ARE the spec for domain edge cases (e.g. order state sealing, SERVED→CANCELLED "trả món" flow). Do not strip them when refactoring.
- Snapshot-heavy entities: `Order`/`OrderItem` denormalize actor names (`created_by_full_name`, `served_by_full_name`, etc.) and price/name at time of action rather than joining live — protects historical/audit accuracy against later edits/deletes of Users or MenuItems.
- Post-commit side effects (activity log writes) are deliberately non-transactional and swallow failures (`writeActivity` catches + warns) so a logging failure never blocks the primary business operation.

## Layers

**Controller layer:**
- Purpose: HTTP binding, DTO validation (`class-validator`), role/permission gating via guards, request/response shaping (`{ data: ... }` envelope for staff API, `apiOk()` envelope for `/api/public/*`).
- Location: `apps/api/src/modules/*/*.controller.ts`
- Contains: `@Controller`/`@Get`/`@Post` handlers, inline DTO classes with decorators.
- Depends on: Services (constructor injection), Guards.
- Used by: apps/web (staff, cookie session) and — planned — apps/shop (public/session-token API).

**Service layer:**
- Purpose: All business logic and transactional consistency (order state machine, checkout math, activity logging, retry-on-deadlock).
- Location: `apps/api/src/modules/*/*.service.ts`
- Contains: TypeORM repository calls, `DataSource.transaction()` blocks, domain validation, VN error messages with `code` fields.
- Depends on: TypeORM repositories/DataSource, other services rarely (mostly self-contained per module).
- Used by: Controllers only (no service-to-service HTTP calls; direct DI within the same process).

**Entity/persistence layer:**
- Purpose: TypeORM entity classes define table schema (columns, indexes, relations) that `synchronize: true` applies directly to MySQL.
- Location: `apps/api/src/modules/*/entities/*.entity.ts`
- Contains: `@Entity`, `@Column`, `@Index`, `@OneToMany`/`@ManyToOne` decorators; `dateToMsTransformer` (converts MySQL datetime ⇄ epoch ms, defined in `apps/api/src/modules/auth/entities/user.entity.ts`) used across all entities for consistent number-based timestamps.
- Depends on: TypeORM only.
- Used by: `data-source.ts` (entities array), repositories injected into services.

**Common/cross-cutting layer:**
- Purpose: App-wide middleware, guards, filters not owned by a single feature module.
- Location: `apps/api/src/common/`
- Contains: `filters/global-exception.filter.ts`, `middleware/request-id.middleware.ts`, `middleware/csrf-origin.middleware.ts`, `text.ts` (string helpers).
- Depends on: Nest core, `@order/schemas` (ErrorCode type).
- Used by: `main.ts` (middleware registration), `app.module.ts` (global filter/interceptor providers).

**CLI/ops layer:**
- Purpose: One-off/scheduled maintenance jobs run outside the HTTP server (invoked via `pnpm cron:*` / `pnpm seed:*`).
- Location: `apps/api/src/cli/*.ts`
- Contains: `main()` functions that call `AppDataSource.initialize()` directly (bypassing Nest DI entirely), then `AppDataSource.destroy()`.
- Depends on: `data-source.ts`, relevant entities directly.
- Used by: `package.json` root scripts (`cron:audit-retention`, `cron:jti-cleanup`), external OS cron/scheduler (not wired into the codebase — invocation is external).

## Data Flow

### Primary Request Path (staff order flow)

1. Browser (apps/web) issues request with `withCredentials: true`; JWT sits in an httpOnly cookie (`apps/web/src/lib/api.ts`).
2. `main.ts` middleware chain runs: `cookieParser()` → `RequestIdMiddleware` → `CsrfOriginGuard` (mutations to `/admin/*`, `/auth/*` only) → Nest routing.
3. Route-level `JwtAuthGuard` (class-level `@UseGuards` on controller, e.g. `apps/api/src/modules/orders/orders.controller.ts:113`) verifies JWT, checks `revoked_jwt_jti` blacklist and `token_version`, attaches `req.user`.
4. Optional method-level guard (`AdminGuard`, `RequireRoles(...)`) narrows by role.
5. `ValidationPipe` (whitelist + transform, global in `main.ts:78`) validates/casts the DTO.
6. Controller delegates to `OrdersService` method (e.g. `getOrCreateOpenOrder`, `addItemsBulk`, `changeItemState`, `checkout` — `apps/api/src/modules/orders/orders.service.ts`).
7. Service wraps the mutation in `this.ds.transaction(async (mgr) => {...})` when it touches multiple rows/tables; validates domain invariants (order not closed, state-machine transition allowed, stock available) before writing.
8. Post-commit, service calls `writeActivity(...)` to append an `OrderActivityLog` row (best-effort, never throws).
9. Response shaped as `{ data: ... }` by the controller, returned through Nest → Express → axios.
10. `AuditInterceptor` (global, `app.module.ts:45`) taps the response stream for 2xx mutations and emits `audit.write`; `AuditEventHandler` persists to `audit_log` asynchronously.
11. Any thrown exception anywhere in the chain is caught by `GlobalExceptionFilter`, mapped to `{ error: { code, message, request_id, ts_ms, field_errors } }`.

### Order Item State Machine Flow

1. Item created via `addItem`/`addItemsBulk` in state `PENDING` (or `KITCHEN` if `send_to_kitchen`), one row per unit quantity (`apps/api/src/modules/orders/orders.service.ts:420-440`).
2. Transitions validated against `ALLOWED_TRANSITIONS` map (service-local copy, must match `packages/schemas/src/orders.ts` `ALLOWED_TRANSITIONS`): `PENDING→{KITCHEN,SERVED,CANCELLED}`, `KITCHEN→{COOKING,SERVED,CANCELLED}`, `COOKING→{READY,SERVED,CANCELLED}`, `READY→{SERVED,CANCELLED}`, `SERVED→{CANCELLED}`, `CANCELLED→{}` (terminal).
3. `changeItemState` blocks all transitions once the parent order has `closed_at` set (paid or cancelled order is immutable).
4. `SERVED→CANCELLED` ("trả món" / item return) is the one non-strictly-terminal path: allows removing an already-served item from the bill, always logged as `item_returned` with refund amount, defaulting reason to "Khách không dùng đến" if none given.
5. Revenue calculation (`checkout`, `stats`) only ever sums `state = 'SERVED'` items — `CANCELLED` items (manual or auto-cancelled-at-checkout) never count.

**State Management:**
- No client-side or server-side in-memory session state for orders — all state lives in MySQL (`orders.closed_at`/`is_paid`, `order_items.state`). Frontend polls REST endpoints (no websockets) — see comments in `apps/web/src/lib/api.ts` about disabling HTTP caching for polling correctness.
- Auth state: JWT in httpOnly cookie + server-side `revoked_jwt_jti` blacklist + `users.token_version` for force-logout-everywhere.

## Key Abstractions

**Order/OrderItem "seal" pattern:**
- Purpose: A closed order is defined ONLY by `closed_at IS NOT NULL`; whether it was paid vs cancelled is disambiguated by `is_paid` (`PAID_SQL` / `CANCELLED_SQL` constants).
- Examples: `sealAsCancelled()` helper, `checkout()`, `cancelWholeOrder()` — all in `apps/api/src/modules/orders/orders.service.ts`.
- Pattern: Once `closed_at` is set, `changeItemState`/`addItem`/`removeItemUnits`/`transferTable` all refuse further mutation ("Đơn đã thanh toán — không sửa được nữa").

**Fast-path/slow-path read-then-lock:**
- Purpose: Avoid `pessimistic_write` lock contention under 2-second client polling while still preventing duplicate "open order" creation races.
- Examples: `getOrCreateOpenOrder` → `getOrCreateOpenOrderImpl` (`orders.service.ts:183-288`).
- Pattern: unlocked SELECT first; only fall into `ds.transaction()` + `pessimistic_write` when a create or dedupe is actually needed. Wrapped in `runWithRetry` (2 attempts) for transient deadlock/lock-timeout errors.

**Snapshot/actor pattern:**
- Purpose: Preserve historical accuracy (who did what, at what price/name) independent of later User/MenuItem edits or deletes.
- Examples: `created_by_full_name`, `served_by_full_name`, `cancelled_by_full_name` on `OrderItem`; `menu_item_name`/`menu_item_price` snapshot at add-time; `table_code` snapshot on `Order`.
- Pattern: Always copy the human-readable value into the transactional row at write time rather than joining live at read time.

**Append-only activity log:**
- Purpose: Per-order human-readable audit trail distinct from the system-wide `audit_log`.
- Examples: `OrderActivityLog` entity (`apps/api/src/modules/orders/entities/order-activity-log.entity.ts`), `writeActivity()` private method.
- Pattern: Best-effort insert, post-commit, failures logged but never surfaced to the caller.

**Error envelope with domain `code`:**
- Purpose: Every thrown `HttpException` carries a machine-readable `code` (e.g. `CONFLICT`, `NOT_FOUND`, `TABLE_KIOTVIET_LOCKED`) plus a human Vietnamese `message`.
- Examples: throughout `orders.service.ts` (`throw new BadRequestException({ code: 'CONFLICT', message: '...' })`); consumed by `GlobalExceptionFilter` and `FRIENDLY_VN` map.
- Pattern: `ErrorCode` type shared via `@order/schemas` (`packages/schemas/src/errors.ts`) — new codes must be added there to stay type-safe on the FE.

## Entry Points

**apps/api HTTP server:**
- Location: `apps/api/src/main.ts`
- Triggers: `pnpm --filter @order/api dev` (swc-node watch) or `node dist/main.js` in production.
- Responsibilities: Nest app bootstrap, static asset serving (`/uploads/*` → `apps/api/uploads/`), production SPA serving + fallback (`web-dist` mounted, Accept-header-based routing between SPA shell and API JSON), body parser limits (10MB), Swagger (`/api/docs`, dev only), global pipes/filters, port from `API_PORT` env (default 3001).

**apps/api CLI scripts:**
- Location: `apps/api/src/cli/*.ts` (`seed-owner.ts`, `seed-menu-tables.ts`, `cron-audit-retention.ts`, `cron-jti-cleanup.ts`)
- Triggers: `pnpm cron:audit-retention`, `pnpm cron:jti-cleanup`, `pnpm seed:owner`, `pnpm seed:demo` (root `package.json` scripts, each `pnpm --filter @order/api`).
- Responsibilities: Each script independently calls `AppDataSource.initialize()` (raw TypeORM, not Nest DI), performs its task, then `AppDataSource.destroy()`. Not scheduled internally — external cron/scheduler must invoke them (nothing in-repo triggers these on a timer).

**apps/web SPA:**
- Location: `apps/web/src/main.tsx` → `App.tsx`
- Triggers: `pnpm --filter @order/web dev` (Vite dev server, port 5173, proxies 9 path prefixes to API at `localhost:3001`).
- Responsibilities: Staff-facing router with `AuthProvider`, role-gated routes (`admin`/`order`/`kitchen`), bottom nav per role.

**apps/shop SPA:**
- Location: `apps/shop/src/main.tsx`
- Triggers: `pnpm --filter @order/shop dev` (Vite dev server, port 5174, proxies only `/api` and `/uploads`).
- Responsibilities: Currently a placeholder root render ("Trang khách đang được dựng — phase 07"); page components exist (`CartPage`, `CheckoutPage`, `HistoryPage`, `OrderTrackPage`) but are not yet wired into a router — see `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` for the target build-out.

## Architectural Constraints

- **Threading:** Single-threaded Node event loop per app (no worker_threads, no cluster mode observed). Concurrency correctness for the order flow depends entirely on MySQL row locks (`pessimistic_write`), not in-process mutexes.
- **Global state:** `apps/api/src/modules/public/public.controller.ts` keeps a module-level `start_at = Date.now()` singleton for uptime reporting. `data-source.ts` exports a singleton `AppDataSource` used directly by CLI scripts (parallel to the Nest-managed `TypeOrmModule.forRoot()` instance used by the HTTP server — two separate DataSource instances exist in the process space depending on entry point).
- **No migrations:** `data-source.ts` sets `synchronize: true` and `migrations: ['src/migrations/*.ts']` but no migration files exist in the repo — schema changes happen by editing entity decorators and letting `synchronize` apply them directly to MySQL. Destructive column changes require manual care (no rollback path).
- **No shared UI component package:** `packages/ui` was explicitly rejected (see comment header in `packages/utils/src/index.ts`) — apps/web and apps/shop each own their UI code independently; only `@order/schemas` (types) and `@order/utils` (pure helpers) are shared.
- **Route prefix collision handling:** `main.ts` uses `Accept: text/html` header sniffing to disambiguate between "browser navigating to a client route that happens to share a path with an API route" (e.g. `/orders`) vs an actual API call — this is load-bearing for both apps/web (9 prefixes) and apps/shop (target: `/api/*` only) SPA fallback correctness. New API namespaces added under `/api/*` avoid this collision problem entirely (apps/shop's proxy config already narrows to `/api` + `/uploads` for this reason).

## Anti-Patterns

### Dual DataSource lifecycles

**What happens:** The HTTP server gets its `DataSource` via `TypeOrmModule.forRoot(dataSourceOptions)` (Nest-managed lifecycle), while every CLI script in `apps/api/src/cli/` imports the same `dataSourceOptions` but instantiates its own `AppDataSource` and calls `.initialize()`/`.destroy()` manually.
**Why it's wrong:** Two independently-configured DataSource instances (same options object, different connection pools) exist depending on entry point — connection pool sizing (`connectionLimit: 50`) and any future DataSource-level hooks must be reasoned about twice.
**Do this instead:** When adding new CLI scripts, keep following the existing `AppDataSource.initialize()` / `AppDataSource.destroy()` pattern shown in `apps/api/src/cli/cron-jti-cleanup.ts` for consistency — do not attempt to spin up the full Nest app for a one-shot script.

### Inline route-prefix allowlists

**What happens:** `apps/api/src/main.ts:46` hardcodes an `apiPrefixes` array (`/auth`, `/admin`, `/setup`, `/health`, `/menu`, `/menu-groups`, `/tables`, `/orders`, `/uploads`) used only in production SPA-fallback routing.
**Why it's wrong:** Any new top-level API route added without updating this array will silently be swallowed by the SPA fallback in production (dev is unaffected since Vite doesn't serve web-dist).
**Do this instead:** Prefer nesting new public/shop-facing endpoints under `/api/*` (as `PublicController` already does) so they never need to be added to `apiPrefixes` — this is explicitly called out in `public.controller.ts`'s own doc comment as the reason `/api` was chosen as the namespace.

## Error Handling

**Strategy:** Centralized — every controller/service throws Nest `HttpException` subclasses with a structured body `{ code, message, field_errors? }`; a single `GlobalExceptionFilter` (`apps/api/src/common/filters/global-exception.filter.ts`) catches everything (`@Catch()`, no type filter) and normalizes to one JSON shape.

**Patterns:**
- Domain errors carry a `code` from the shared `ErrorCode` union (`packages/schemas/src/errors.ts`) — always throw `new XException({ code: 'SOME_CODE', message: '...' })`, never a bare string.
- `class-validator` validation failures (400/422) are converted into `field_errors: [{ field, message }]` via regex extraction (`extractFieldFromMessage`) rather than left as raw string arrays.
- A `FRIENDLY_VN` lookup table overrides technical messages with user-facing Vietnamese text for known codes; unknown codes fall back to `'Lỗi không xác định'`/`'Internal server error'`.
- Transient DB errors (deadlock, lock wait timeout) are retried transparently at the service layer (`OrdersService.runWithRetry`) rather than surfaced as errors — only exhausted retries propagate.

## Cross-Cutting Concerns

**Logging:** Nest's built-in `Logger` (per-service instance, e.g. `private readonly logger = new Logger(OrdersService.name)`); no external log aggregation configured. Errors logged with stack traces in `GlobalExceptionFilter` and each service's catch blocks.

**Validation:** Global `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, stopAtFirstError: false })` in `main.ts` — DTOs are `class-validator`-decorated classes defined inline at the top of each `*.controller.ts` file (not separate `.dto.ts` files, except `apps/api/src/modules/auth/dto/auth.dto.ts`).

**Authentication:** JWT in httpOnly cookie (`SameSite=Strict` per comment in `csrf-origin.middleware.ts`), verified per-request by `JwtAuthGuard` at controller class level; JTI blacklist (`revoked_jwt_jti` table) + `token_version` column enable force-logout / revoke-all-sessions.

**Authorization:** Layered guards — `JwtAuthGuard` (identity) → `AdminGuard`/`OwnerGuard`/`RequireRoles(...)` (role). Role decisions for "how much history can this role see" are made in the controller (`staffHistoryWindowMs()` in `orders.controller.ts`), not the service, per an explicit code comment: "đây là quyết định QUYỀN, không phải nghiệp vụ đơn hàng".

---

*Architecture analysis: 2026-07-29*

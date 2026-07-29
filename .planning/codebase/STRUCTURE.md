# Codebase Structure

**Analysis Date:** 2026-07-29

## Directory Layout

```
OrderQuanBaLun/
├── apps/
│   ├── api/                    # NestJS backend (single deployable service)
│   │   ├── src/
│   │   │   ├── main.ts         # Bootstrap: middleware, static assets, SPA fallback
│   │   │   ├── app.module.ts   # Root module — wires feature modules + global guard/interceptor
│   │   │   ├── data-source.ts  # TypeORM DataSource config (MySQL, synchronize:true)
│   │   │   ├── types/          # Ambient type augmentation (express Request.user etc.)
│   │   │   ├── common/         # Cross-cutting: filters, middleware, text helpers
│   │   │   │   ├── filters/
│   │   │   │   └── middleware/
│   │   │   ├── cli/            # Standalone scripts (cron jobs, seeders) — own DataSource lifecycle
│   │   │   └── modules/        # Feature modules, one dir per domain
│   │   │       ├── auth/       # Login, JWT, guards, recovery codes
│   │   │       ├── audit/      # System-wide audit log (interceptor + service + entity)
│   │   │       ├── admin/      # User management endpoints (admin-only)
│   │   │       ├── setup/      # First-run owner account bootstrap
│   │   │       ├── menu/       # Menu items + menu groups
│   │   │       ├── tables/     # Restaurant table registry
│   │   │       ├── orders/     # Order + order-item lifecycle (core domain)
│   │   │       ├── public/     # Unauthenticated `/api/public/*` surface
│   │   │       └── health/     # Legacy `/health` endpoint (uptime checks)
│   │   └── uploads/            # User-uploaded files (menu images), served via /uploads/*
│   ├── web/                    # Staff-facing POS/admin SPA (Vite + React)
│   │   └── src/
│   │       ├── main.tsx        # React root mount
│   │       ├── App.tsx         # Router + role-gated routes + shell/nav
│   │       ├── pages/          # One file per route (OrdersPage, KitchenPage, etc.)
│   │       ├── components/     # Shared UI widgets used across pages
│   │       └── lib/            # api.ts (axios client), auth-context, notification helpers
│   └── shop/                   # Customer-facing SPA (Vite + React) — Milestone 2, in progress
│       └── src/
│           ├── main.tsx        # Placeholder root mount (not yet routed)
│           ├── pages/          # Placeholder pages: CartPage, CheckoutPage, HistoryPage, OrderTrackPage
│           └── styles/         # tokens.css — design tokens shared across shop pages
├── packages/
│   ├── schemas/                 # @order/schemas — zod schemas + shared TS types
│   │   └── src/                 # orders.ts, menu.ts, tables.ts, auth.ts, admin.ts, errors.ts, index.ts
│   └── utils/                    # @order/utils — zero-runtime-dependency helpers
│       └── src/index.ts          # apiOk() envelope builder (currently sole export)
├── docs/
│   └── MILESTONE-02-ONLINE-ORDERING-SPEC.md   # Spec driving apps/shop build-out
├── .planning/                    # GSD planning artifacts (this codebase map lives here)
├── docker-compose.yml / .prod.yml, Dockerfile, Caddyfile, deploy.sh, DEPLOY.md  # Deployment
├── turbo.json                    # Turborepo task graph (build/dev/typecheck/test/lint)
├── pnpm-workspace.yaml            # Workspace globs: apps/*, packages/*
└── tsconfig.base.json              # Shared TS compiler options (ES2022, strict, decorators)
```

## Directory Purposes

**`apps/api/src/modules/orders/`:**
- Purpose: Core business domain — order + order-item lifecycle, table transfer, checkout, history/stats reporting.
- Contains: `orders.controller.ts` (HTTP + DTOs), `orders.service.ts` (all business logic, ~1300 lines), `orders.module.ts`, `entities/` (Order, OrderItem, OrderActivityLog).
- Key files: `apps/api/src/modules/orders/orders.service.ts` is the largest and most business-critical file in the repo — read it before touching order/payment/table logic.

**`apps/api/src/common/`:**
- Purpose: App-wide concerns not owned by a single feature module (error formatting, correlation IDs, CSRF defense).
- Contains: `filters/global-exception.filter.ts`, `middleware/request-id.middleware.ts`, `middleware/csrf-origin.middleware.ts`, `text.ts`.
- Key files: `global-exception.filter.ts` defines the single response error shape used everywhere.

**`apps/api/src/cli/`:**
- Purpose: Scripts invoked outside the HTTP request lifecycle — seeding and scheduled maintenance.
- Contains: `seed-owner.ts`, `seed-menu-tables.ts`, `cron-audit-retention.ts`, `cron-jti-cleanup.ts`.
- Key files: each script is a self-contained `main()` that initializes/destroys its own `AppDataSource` — not wired into the Nest app or any in-process scheduler (must be invoked externally, e.g. by an OS cron or the deploy pipeline).

**`apps/api/src/modules/auth/`:**
- Purpose: Login, JWT issuance/verification, session revocation, role/ownership checks.
- Contains: `auth.controller.ts`, `auth.service.ts`, `jwt.service.ts`, `guards/` (jwt-auth, admin, owner, roles), `entities/` (User, RevokedJti, RecoveryCode), `dto/auth.dto.ts`.

**`apps/api/src/modules/public/`:**
- Purpose: The unauthenticated API namespace intended for apps/shop consumption — grows here across Milestone 2, not scattered across other modules.
- Contains: `public.controller.ts` (`GET /api/public/health` today), `public.module.ts`.
- Key files: `public.controller.ts`'s doc comment explains why `/api/*` was chosen as a namespace (avoids the SPA-fallback prefix-collision problem in `main.ts`).

**`apps/api/uploads/`:**
- Purpose: Filesystem storage for uploaded menu images (multer writes here; `main.ts` serves it at `/uploads/*`).
- Generated: Yes (runtime uploads).
- Committed: Directory structure present in repo (`uploads/menu/`), actual uploaded files are runtime data.

**`apps/web/src/pages/`:**
- Purpose: One file per top-level route for the staff POS/admin app.
- Contains: `OrdersPage.tsx` (table map + order drawer trigger), `KitchenPage.tsx` (KDS), `MenuManagementPage.tsx`, `TablesManagementPage.tsx`, `HistoryPage.tsx`, `DashboardPage.tsx`, `AdminUsersPage.tsx`, `AdminAuditPage.tsx`, `AccountPage.tsx`, `LoginPage.tsx`, `SetupPage.tsx`, `RecoverPage.tsx`.

**`apps/web/src/components/`:**
- Purpose: Reusable UI widgets shared across multiple pages within apps/web only (not shared with apps/shop — no shared component package exists).
- Contains: `OrderDrawer.tsx` (per-table order editing UI), `MenuPickerModal.tsx`, `BulkOrderModal.tsx`, `Charts.tsx`, `NotificationBell.tsx`, `ReadyListener.tsx`, `Toast.tsx`, `ConfirmDialog.tsx`, `ReLoginModal.tsx`, `PasswordInput.tsx`, `HelpModal.tsx`.

**`apps/web/src/lib/`:**
- Purpose: Non-component logic — HTTP client, auth context, client-side computed helpers.
- Contains: `api.ts` (axios instance + error extraction + re-login flow), `auth-context.tsx` (React context for current user/role, `defaultLandingPath()`), `item-age.ts`, `notification-store.ts`, `ready-notifier.ts`, `menu-search.ts` (+ its `.test.ts`).

**`apps/shop/src/pages/`:**
- Purpose: Placeholder route components for the customer-facing shop, awaiting router wiring per the Milestone 2 spec.
- Contains: `CartPage.tsx`, `CheckoutPage.tsx`, `HistoryPage.tsx`, `OrderTrackPage.tsx` — each currently renders static "coming in phase 08" copy.

**`packages/schemas/src/`:**
- Purpose: Single source of truth for cross-app types/validation — zod schemas double as TypeScript types via `z.infer`.
- Contains: `orders.ts` (order/order-item schemas + `ALLOWED_TRANSITIONS`, `CANCEL_NEEDS_CONFIRM`, VN labels/colors — **must stay in sync with the duplicate transition map in `orders.service.ts`**), `menu.ts`, `tables.ts`, `auth.ts`, `admin.ts`, `errors.ts` (`ErrorCode` union), `index.ts` (barrel).

**`packages/utils/src/`:**
- Purpose: Zero-runtime-dependency helpers importable from both Node ESM (apps/api) and browser bundles (apps/web, apps/shop).
- Contains: `index.ts` — currently only `apiOk<T>()` success-envelope builder. Per its own doc comment, Milestone 2/phase-08 work is expected to add `normalizePhone`, `stripDiacritics`, `haversineKm`, `isStoreOpenNow`, `maskPhone`/`maskAddress`, `formatVnd` here.

## Key File Locations

**Entry Points:**
- `apps/api/src/main.ts`: API server bootstrap, static asset + SPA fallback serving.
- `apps/web/src/main.tsx` → `apps/web/src/App.tsx`: Staff SPA mount + router.
- `apps/shop/src/main.tsx`: Customer SPA mount (placeholder, not yet routed).

**Configuration:**
- `apps/api/src/data-source.ts`: DB connection, entity registry, `synchronize: true`.
- `apps/web/vite.config.ts` / `apps/shop/vite.config.ts`: Dev server ports (5173 / 5174) and API proxy rules (Accept-header-aware bypass for SPA-route/API-path collisions).
- `tsconfig.base.json`: Shared compiler options (ES2022, strict, decorators enabled for TypeORM/Nest).
- `turbo.json`: Task pipeline (`build` depends on `^build`, `dev` uncached/persistent).
- `.env`, `.env.example`, `.env.production.example`, `.env.deploy`, `apps/api/.env` exist at root/app level — contain environment configuration, contents not inspected here (do not read/quote).

**Core Logic:**
- `apps/api/src/modules/orders/orders.service.ts`: Order lifecycle, state machine enforcement, checkout math, activity logging, table transfer.
- `apps/api/src/modules/auth/guards/jwt-auth.guard.ts`: Central identity verification used by nearly every protected route.
- `apps/api/src/common/filters/global-exception.filter.ts`: Central error response shaping.
- `packages/schemas/src/orders.ts`: Canonical state-machine definition consumed by the frontend for button/UI gating.

**Testing:**
- `apps/api/**/*.test.ts` (vitest, config via `apps/api/package.json` `test` script) — no dedicated test files found under `apps/api/src` at time of writing except what `vitest run` would pick up by glob; verify with `find apps/api/src -name '*.test.ts' -o -name '*.spec.ts'` before assuming coverage.
- `apps/web/src/lib/menu-search.test.ts`: Only test file currently present in apps/web.
- No test files found in `apps/shop`.

## Naming Conventions

**Files:**
- Backend: `<domain>.controller.ts`, `<domain>.service.ts`, `<domain>.module.ts`, entities under `entities/<name>.entity.ts` (kebab-case file names, PascalCase exported class names).
- Frontend: `PascalCase.tsx` for components/pages (`OrdersPage.tsx`, `OrderDrawer.tsx`), `kebab-case.ts` for non-component lib modules (`item-age.ts`, `ready-notifier.ts`).
- CLI scripts: `<verb>-<noun>.ts` (`cron-audit-retention.ts`, `seed-owner.ts`).

**Directories:**
- Backend feature modules are singular-domain nouns under `apps/api/src/modules/<domain>/`, each optionally with its own `entities/`, `dto/`, `guards/` subdirectory.
- Frontend apps use `pages/`, `components/`, `lib/` as the three standard subdirectories — apps/shop currently has only `pages/` and `styles/` populated (no `lib/` yet since API integration hasn't landed).

## Where to Add New Code

**New backend feature/domain:**
- Create `apps/api/src/modules/<name>/` with `<name>.module.ts`, `<name>.controller.ts`, `<name>.service.ts`, `entities/<name>.entity.ts` as needed — follow the existing `orders` or `tables` module as a template.
- Register the new entity in `apps/api/src/data-source.ts` (`entities: [...]` array) since `synchronize: true` requires it to be listed there.
- Import the new module into `apps/api/src/app.module.ts`.

**New public/customer-facing endpoint (apps/shop consumption):**
- Add to `apps/api/src/modules/public/public.controller.ts` (or a new controller registered in `public.module.ts`) under the `/api/public/*` prefix — this avoids needing to touch the `apiPrefixes` SPA-fallback allowlist in `main.ts`.
- Success responses should use `apiOk()` from `@order/utils`; errors should keep using the existing `GlobalExceptionFilter` compact shape (explicitly sanctioned as `legacy_compact_error_shape` per the doc comment in `public.controller.ts`).

**New staff-facing route/page:**
- Add a new file under `apps/web/src/pages/<Name>Page.tsx`, register the route in `apps/web/src/App.tsx` inside the appropriate `RoleGate` block, and add a nav link in the corresponding role's bottom-nav block in the same file.

**New customer-facing route/page:**
- Add under `apps/shop/src/pages/<Name>Page.tsx` following the placeholder pattern already there; wiring into an actual router is pending (see `apps/shop/src/main.tsx` TODO comment referencing "task-10").

**Shared types/validation:**
- Add zod schemas to the relevant file in `packages/schemas/src/` (or a new file + export from `index.ts`). If it's an order-state-machine change, update BOTH `packages/schemas/src/orders.ts` and the local `ALLOWED_TRANSITIONS` copy in `apps/api/src/modules/orders/orders.service.ts` — they are not currently derived from a single source.

**Shared cross-runtime utilities:**
- Add to `packages/utils/src/index.ts`. Must remain zero-runtime-dependency and work under both Node ESM and browser bundling — do not add Node-only or DOM-only APIs here.

**Database schema changes:**
- Edit the relevant `*.entity.ts` file's decorators; `synchronize: true` applies the change on next API boot. No migration file is needed or expected (this project intentionally has none) — but be conservative with destructive changes (dropping/renaming a column loses data with no rollback path).

## Special Directories

**`apps/api/uploads/`:**
- Purpose: Runtime storage for uploaded menu images, served statically via `app.useStaticAssets()` in `main.ts`.
- Generated: Yes (multer writes files here at runtime).
- Committed: Directory skeleton yes; uploaded file contents are environment-specific runtime data (check `.gitignore`).

**`apps/*/dist/` (api, web, shop):**
- Purpose: Build output (`tsc` for api, `vite build` for web/shop).
- Generated: Yes.
- Committed: No (build artifact).

**`.turbo/`:**
- Purpose: Turborepo's local cache for task outputs/hashes.
- Generated: Yes.
- Committed: No.

**`.planning/`:**
- Purpose: GSD workflow artifacts (phase plans, codebase maps including this document).
- Generated: Partially (codebase docs regenerated by `/gsd:map-codebase`; phase docs written by planning commands).
- Committed: Typically yes (project convention; verify `.gitignore` if unsure).

---

*Structure analysis: 2026-07-29*

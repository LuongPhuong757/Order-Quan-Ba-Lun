# Coding Conventions

**Analysis Date:** 2026-07-29

## Naming Patterns

**Files:**
- kebab-case for most TS/TSX files: `menu-search.ts`, `csrf-origin.middleware.ts`, `global-exception.filter.ts`, `revoked-jti.entity.ts`
- NestJS suffix convention strictly followed: `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.entity.ts`, `*.guard.ts`, `*.middleware.ts`, `*.filter.ts`, `*.interceptor.ts`, `*.dto.ts`
- React page components: PascalCase file matching component name, `Page` suffix — `LoginPage.tsx`, `OrdersPage.tsx`, `KitchenPage.tsx` in `apps/web/src/pages/` and `apps/shop/src/pages/`
- React reusable components: PascalCase, no suffix — `Toast.tsx`, `ConfirmDialog.tsx`, `MenuPickerModal.tsx` in `apps/web/src/components/`
- Test files colocated with source, `*.test.ts` suffix — `apps/web/src/lib/menu-search.test.ts` tests `apps/web/src/lib/menu-search.ts`
- Zod schema files in `packages/schemas/src/` named after domain, plural or singular matching module: `auth.ts`, `admin.ts`, `menu.ts`, `orders.ts`, `tables.ts`, `errors.ts`

**Functions:**
- camelCase throughout: `apiOk`, `extractError`, `isTransientError`, `toTitleCase`
- Service methods read as verbs on the domain: `svc.addItem`, `svc.changeItemState`, `svc.cancelWholeOrder`, `svc.checkout` (`apps/api/src/modules/orders/orders.service.ts`)
- Guard/helper functions colocated in controller files when only used there, e.g. `staffHistoryWindowMs(req)` defined directly in `apps/api/src/modules/orders/orders.controller.ts:107`

**Variables:**
- snake_case for wire-format fields (DB columns, DTO fields, API payload keys) to match DB schema and Vietnamese business vocabulary: `menu_item_id`, `full_name`, `is_out_of_stock`, `table_code`, `request_id`, `ts_ms`
- camelCase for local variables and internal-only state: `existingMap`, `groupNameByCode`, `wasOutOfStock`
- This produces a consistent rule: **anything that crosses a network/DB boundary is snake_case; anything purely internal to a function/component is camelCase.**

**Types:**
- PascalCase for Zod schema exports and their inferred types share the same name: `export const MenuItem = z.object({...}); export type MenuItem = z.infer<typeof MenuItem>;` (`packages/schemas/src/menu.ts`)
- Enum-like Zod schemas also share name with type: `OrderItemState`, `MenuGroup`, `TableKind`
- NestJS class-validator DTOs use `Dto` suffix: `CreateMenuItemDto`, `UpdateMenuItemDto`, `AddItemDto`, `ChangeStateDto`

## Code Style

**Formatting:**
- Prettier ^3.4.0 declared at root `package.json` (`pnpm format` = `prettier --write "**/*.{ts,tsx,md,json}"`)
- **No `.prettierrc` file exists anywhere in the repo** — Prettier runs with all-default settings (2-space indent, double quotes normalized to single per Prettier default... actually Prettier default is double quotes, but existing code consistently uses single quotes). Do not assume a specific print-width or quote style is enforced beyond Prettier defaults; match surrounding file style when editing by hand.
- Single quotes used consistently across `.ts`/`.tsx` files by convention (not by config) — follow this when adding code.
- Semicolons used throughout.

**Linting:**
- `apps/api/package.json` declares `"lint": "eslint src --max-warnings 0"` but **no ESLint config file exists anywhere in the repo** (`.eslintrc*`, `eslint.config.*` all absent). Running `pnpm lint` in `apps/api` will fail/no-op until a config is added. Treat this as a known gap — do not assume lint enforcement catches style violations; rely on TypeScript strict mode and manual review instead.
- `apps/web` and `apps/shop` have no `lint` script at all.
- TypeScript `strict: true` is enforced repo-wide via `tsconfig.base.json` (`/Users/m1macbook/Desktop/OrderQuanBaLun/tsconfig.base.json`) — this is the primary safety net, not ESLint.

## Import Organization

**Order (observed, not enforced by tooling):**
1. External package imports (`@nestjs/*`, `typeorm`, `class-validator`, `react`, `axios`)
2. Node builtin imports (`node:path`, `node:fs`, `node:crypto`) — imported with `node:` prefix
3. Workspace package imports (`@order/schemas`, `@order/utils`)
4. Relative imports to local module files (entities, guards, services) — always with explicit `.js` extension in `apps/api` (NodeNext ESM resolution) or `.ts`/`.tsx` extension in `apps/web`/`apps/shop` (Vite/Bundler resolution)

**Path Aliases:**
- No `@/` or path-alias imports configured; all cross-file imports are relative (`../auth/guards/jwt-auth.guard.js`, `./entities/menu-item.entity.js`)
- Cross-package imports use workspace protocol names: `@order/schemas`, `@order/utils` (see `pnpm-workspace.yaml`, resolved via `workspace:*` in each `package.json`)

**Critical detail — extension rules differ per app:**
- `apps/api` (NodeNext module resolution) requires `.js` extensions on relative imports even though source is `.ts`: `import { toTitleCase } from '../../common/text.js';`
- `apps/web` / `apps/shop` (Vite bundler resolution, `allowImportingTsExtensions: true`) use `.ts`/`.tsx` extensions directly: `import { api, extractError } from '../lib/api.ts';`
- `packages/schemas` and `packages/utils` (also NodeNext-style build) use `.js` extensions in re-exports: `export * from './errors.js';` (`packages/schemas/src/index.ts`)
- When adding new files, match the extension convention of the app you're in — mixing them causes build failures.

## Error Handling

**API error envelope (canonical shape, enforced by `GlobalExceptionFilter`):**
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Dữ liệu thiếu hoặc sai định dạng, bạn kiểm tra lại nhé.",
    "request_id": "uuid",
    "ts_ms": 1234567890,
    "field_errors": [{ "field": "price", "message": "price must be an integer" }]
  }
}
```
- Defined by `ErrorEnvelope` Zod schema in `packages/schemas/src/errors.ts` and implemented by `apps/api/src/common/filters/global-exception.filter.ts`.
- `ErrorCode` is a closed Zod enum (`packages/schemas/src/errors.ts:5-24`) shared between backend and frontend — **add new error codes here first**, then reference the string in NestJS exceptions.
- Controllers throw NestJS built-in exceptions (`BadRequestException`, `ConflictException`, `NotFoundException`, `ForbiddenException`) with a structured body `{ code: '<ErrorCode value>', message: '<Vietnamese message>' }`, e.g.:
  ```typescript
  throw new NotFoundException({ code: 'NOT_FOUND', message: 'Món không tồn tại' });
  throw new ConflictException({ code: 'CONFLICT', message: 'Mã món đã tồn tại' });
  ```
- `GlobalExceptionFilter` also has a `FRIENDLY_VN` map (`global-exception.filter.ts:19-37`) that overrides `message` with a canned Vietnamese-language string keyed by error code — this always wins over the message passed at throw site once a code has an entry. When adding a new error code with a user-facing message, add it to both the throw-site AND `FRIENDLY_VN` if you want it to override.
- `class-validator` validation failures (array of strings) are auto-converted into `field_errors` array via `extractFieldFromMessage()` (`global-exception.filter.ts:103-107`), which parses the leading token before "must/should/has" out of each message.

**Success envelope (`apiOk` pattern — only partially adopted):**
- `packages/utils/src/index.ts` exports `ApiOk<T>` type and `apiOk<T>(data, message?)` helper — the ONLY helper in `@order/utils` as of this analysis. **There is no `apiErr` helper** — errors are always thrown as NestJS exceptions and handled centrally by `GlobalExceptionFilter`, never constructed manually via a helper function.
- `apiOk()` is used in exactly one place today: `apps/api/src/modules/public/public.controller.ts` (the `/api/public/health` endpoint). All other controllers (`menu.controller.ts`, `orders.controller.ts`, `tables.controller.ts`, `auth.controller.ts`) return a plain object literal `{ data: ... }` directly instead of calling `apiOk()`.
- **For new `/api/public/*` routes (shop-facing), use `apiOk()` explicitly** — this is documented as the required pattern for Phase 08+ in `public.controller.ts:23-25`: "success = `apiOk()`, error = giữ shape compact hiện có của `GlobalExceptionFilter`".
- For existing internal routes (`apps/web`-facing, under `/menu`, `/orders`, `/auth`, `/tables`), continue the existing `{ data: ... }` literal pattern for consistency with surrounding code — do not retrofit `apiOk()` into those controllers as part of unrelated work.

**Frontend error handling:**
- `apps/web/src/lib/api.ts` exports `extractError(err)` which normalizes any thrown error (Axios or otherwise) into `{ code, message, field_errors? }`, falling back to Vietnamese generic messages (`'Lỗi mạng, thử lại sau ít phút nhé.'`) when the response has no structured error body.
- `isTransientError(err)` (`api.ts:68-77`) classifies 5xx/408/429/network errors as transient — used to suppress toast noise during polling loops.
- Components call `extractError(err)` in `catch` blocks and pass `.message` to a toast (`useToast().push('error', e.message)`), never rendering raw error objects.

## Logging

**Framework:** `nestjs-pino` / `pino` / `pino-http` (declared in `apps/api/package.json`) for structured JSON logging; NestJS's built-in `Logger` class used directly in some files (e.g. `new Logger(GlobalExceptionFilter.name)` in `global-exception.filter.ts:41`).

**Patterns:**
- Validation failures are logged at `warn` level with full field/message detail even though the client sees a friendlier generic message (`global-exception.filter.ts:74-78`).
- Unhandled `Error` instances are logged at `error` level with full stack trace (`global-exception.filter.ts:83`).
- `request_id` middleware (`apps/api/src/common/middleware/request-id.middleware.ts`) attaches a request ID used both in logs and in the error envelope for correlation.

## Comments

**When to Comment:**
- Heavy use of Vietnamese-language business-rule comments explaining *why*, not *what* — e.g. state machine transition rationale in `packages/schemas/src/orders.ts:52-60` and `apps/api/src/modules/orders/orders.service.ts:17-25`. New business logic should follow this pattern: explain the business reason for a rule directly above the code implementing it.
- Ticket/task references embedded in comments as tags like `P01.D-09`, `P08.D-61`, `M2.D-64` — these map to planning docs (`docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md`) and prior decisions. When implementing a phase task, tag the relevant code comment with the task ID if one exists in the plan.
- SQL fragments used as constants get an explanatory doc comment above them, e.g. `HAS_ALIVE_ITEMS_SQL` vs `HAS_ANY_ITEM_SQL` in `orders.controller.ts` area / `orders.service.ts` — both the SQL and the distinction between them are explained.

**JSDoc/TSDoc:**
- `/** ... */` doc comments used above exported functions/classes/methods to describe route purpose, params, and edge cases — e.g. every controller method in `menu.controller.ts` and `orders.controller.ts` has a one-line route summary comment (`/** GET /menu — list menu items. ... */`).
- Not enforced by tooling (no ESLint `jsdoc` plugin), but consistently present — match this style for new endpoints.

## Function Design

**Size:** Controller methods stay thin — delegate business logic to the service (e.g. `OrdersController` methods are typically 3-6 lines, calling into `OrdersService`). Exception: `MenuController` has some inline business logic for `bulkImport` and `toggleStock` directly in the controller (see `menu.controller.ts:178-250`, `296-357`) — newer/simpler modules may inline logic instead of a service; prefer a service layer for anything beyond simple CRUD.

**Parameters:** Service methods take an explicit "actor" object for audit/attribution rather than pulling it from a global context — pattern is `{ id: req.user!.sub, full_name: req.user!.full_name }` passed as the last parameter, typed as `OrderCreator` (`apps/api/src/modules/orders/orders.service.ts:11`).

**Return Values:** Controllers always return `{ data: <payload> }` (or `apiOk(payload)` for `/api/public/*` per above) — never a bare payload.

## Module Design

**Exports:**
- `packages/schemas/src/index.ts` is a barrel file re-exporting all domain schema modules: `export * from './errors.js'` etc. Add new schema domains here.
- `packages/utils` has a single flat `index.ts` with no barrel indirection (small surface area today).
- NestJS modules (`*.module.ts`) declare `controllers`, `providers`, and `imports` (TypeOrmModule.forFeature(...) for entities) — one module per bounded context (`auth`, `menu`, `orders`, `tables`, `admin`, `audit`, `public`, `setup`, `health`).

**DTO placement — two different patterns coexist:**
- `apps/api/src/modules/auth/dto/auth.dto.ts` — dedicated `dto/` subfolder, used only by `auth` module.
- `apps/api/src/modules/menu/menu.controller.ts` and `apps/api/src/modules/orders/orders.controller.ts` — class-validator DTOs declared **inline at the top of the controller file itself**, not in a separate `dto/` file. This is the dominant pattern for newer modules (menu, orders, tables).
- **When adding a new module, default to inline DTOs in the controller file** unless the DTO set grows large enough to warrant extraction (as auth did). Both patterns are acceptable; inline is more common and matches majority of the codebase.
- Note: `packages/schemas/src/*.ts` also defines Zod equivalents of some of these same DTOs (e.g. `AddItemDto` in both `packages/schemas/src/orders.ts` and inline in `orders.controller.ts`) — these are currently **not shared/unified**; the Zod schemas in `packages/schemas` describe the wire contract for docs/type-sharing with frontend, while NestJS uses its own separate class-validator DTOs at runtime for the same shape. Keep both in sync manually when changing a field.

## Entity Conventions (TypeORM)

- All entities use UUID primary keys: `@PrimaryGeneratedColumn('uuid')`.
- Money stored as integer VND (no decimals): `@Column({ type: 'int', unsigned: true }) price!: number;`
- Timestamps stored as MySQL `datetime(6)` but transformed to epoch-ms numbers for app code via shared transformers defined in `apps/api/src/modules/auth/entities/user.entity.ts`: `dateToMsTransformer` (Date ↔ ms) and `bigIntTransformer` (MySQL BIGINT string ↔ number). Reuse these transformers on any new entity with datetime or bigint columns — import from `user.entity.ts` as the other entities do (`menu-item.entity.ts:9`).
- Indexes declared with explicit names via `@Index('idx_<table>_<cols>', [...])` — follow the `idx_<table>_<column(s)>` naming pattern for new indexes.
- Nullable/soft-delete pattern: `is_active: boolean` column (default `true`) used for soft-delete instead of hard deletes, e.g. `MenuItem.is_active`, toggled by `DELETE /menu/:id` handler which sets `is_active = false` rather than removing the row.

---

*Convention analysis: 2026-07-29*

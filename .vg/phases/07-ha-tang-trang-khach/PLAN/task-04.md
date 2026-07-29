### Task 04 — `GET /api/public/health` — the phase's only new endpoint
<!-- vg-binding: SPECS:success-criteria -->
<!-- vg-binding: INTERFACE-STANDARDS:error-shape -->
<wave>2</wave>
<implements-decision>M2.D-64</implements-decision>
<implements-decision>M2.D-67</implements-decision>
<file-path>apps/api/src/modules/public/public.controller.ts</file-path>
<file-path>apps/api/src/modules/public/public.module.ts</file-path>
<file-path>apps/api/src/app.module.ts</file-path>
<edits-endpoint>GET /api/public/health</edits-endpoint>
<goals-covered>G-04,G-09,G-12</goals-covered>
<estimated-loc>85</estimated-loc>

Covers goal: G-04, G-09, G-12

**Description:** Ship the single public, unauthenticated endpoint of phase 07. It proves three
things at once: the customer page can call the API **same-origin** (no CORS needed, M2.D-67),
the `/api/*` namespace reaches a controller instead of the POS SPA shell (G-09), and
`@order/utils` resolves at runtime inside the built image (G-12). No business logic — phase 08
owns `/api/public/menu` and friends.

**Read first:**
- `apps/api/src/modules/health/health.controller.ts` (existing `/health`, the shape to echo)
- `apps/api/src/app.module.ts` (module + controller registration, `ThrottlerModule` config)
- `apps/api/src/common/filters/global-exception.filter.ts` (error envelope actually emitted today)
- `INTERFACE-STANDARDS.md` § API Standard

**Steps:**
1. `apps/api/src/modules/public/public.controller.ts`
   - `@Controller('api/public')` + `@Get('health')` → path is literally `/api/public/health`
     (there is no `setGlobalPrefix` in `main.ts`, so the controller path is the full path).
   - Inject `@InjectDataSource() DataSource`; `SELECT 1` inside try/catch exactly like
     `health.controller.ts`; never throw on DB down — return `status: 'degraded'`.
   - Return `apiOk({ status, db, uptime_s, version })` imported from `@order/utils`
     (Task 02). Body therefore is `{"ok":true,"data":{...}}` per INTERFACE-STANDARDS
     success envelope. Explicit return type annotation (FOUNDATION §9.8 mandates signatures).
   - **No PII, no env values, no build paths** in the payload — it is world-readable.
   - No `@Throttle` override: the global `default` throttler (600 req/min/IP,
     `app.module.ts`) already applies; per-endpoint public limits are phase 08 (P08.D-61).
2. `apps/api/src/modules/public/public.module.ts` — `@Module({ controllers: [PublicController] })`.
   No `TypeOrmModule.forFeature` needed (raw `DataSource` only).
3. `apps/api/src/app.module.ts` — add `PublicModule` to `imports` (keep `HealthController` in
   `controllers` untouched; `/health` must keep its current shape for the existing uptime checks
   and POS — G-07).
4. Do **not** modify `GlobalExceptionFilter`. Errors from this endpoint keep the legacy compact
   shape `{ error: { code, message, request_id, ts_ms, field_errors } }`, which
   INTERFACE-STANDARDS allows through `legacy_compact_error_shape`. Record in the task notes
   that phase 08 must reuse this same success/error pairing for all `/api/public/*` routes.

**Acceptance criteria:**
- [ ] `GET /api/public/health` (dev, no auth cookie) → 200 with body matching
      `{"ok":true,"data":{"status":"ok","db":"up","uptime_s":<int>,"version":"0.1.0"}}`.
- [ ] With MySQL stopped the same call still returns 200 with `"status":"degraded","db":"down"`
      (a health probe must not 500).
- [ ] Existing `GET /health` response is byte-identical to before this task (no envelope wrap).
- [ ] The controller imports `apiOk` from `@order/utils` — not a locally re-declared helper.
- [ ] Response contains no `ALLOWED_ORIGIN`, no filesystem path, no user data.

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
corepack pnpm db:up                      # LOCAL docker-compose.yml mysql only
corepack pnpm --filter @order/utils build && corepack pnpm --filter @order/schemas build
corepack pnpm --filter @order/api dev &   # dev mode: no SPA middleware in the way
sleep 8
curl -s http://localhost:3001/api/public/health | jq .
curl -s http://localhost:3001/health | jq .          # unchanged POS/uptime endpoint
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/public/health
kill %1
```
(The production-mode `Accept: text/html` assertion for G-09 lives in Task 08 + Task 12 —
in dev the SPA middleware is not installed, so dev alone cannot prove it.)

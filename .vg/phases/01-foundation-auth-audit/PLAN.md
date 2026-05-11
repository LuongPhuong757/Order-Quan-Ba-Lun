---
phase: "01"
created_at: "2026-05-11T00:00:00Z"
plan_count: 1
wave_count: 7
task_count: 34
profile: "web-fullstack"
phase_profile_specs: "infra"
goals_proxy: "TS-NN scenarios from CONTEXT.md §Decisions (TEST-GOALS.md not yet generated — TS-01..TS-52 used as G-XX proxies)"
design_manifest: "none (greenfield phase 01 — no UI mockups; all FE tasks tagged <design-ref>none-greenfield</design-ref>)"
fine_grained_components: false
test_ids_enabled: true
---

# Phase 01 — Plan (Foundation & Auth Infrastructure)

> Source: SPECS.md + CONTEXT.md (28 decisions P01.D-01..P01.D-28; 52 test scenarios TS-01..TS-52).
> Architecture lock: FOUNDATION §9 (NestJS 10 + React 19 + Vite + MySQL 8 + TypeORM + pnpm/Turbo).
> Mobile-first per F-16; JWT 7d cookie HttpOnly per F-17.
> Phase profile in SPECS = `infra` but plan is `web-fullstack` because phase 01 ships both BE auth/audit infra AND FE login/admin/audit surfaces (TEST-GOALS.md will be created in /vg:blueprint step 2b5; pending generation TS-NN scenarios serve as goal proxies).

---

## Wave 1 — Foundation: schema, shared packages, app skeleton

### Task 1 — DB migrations: 5 core entities + indexes

<file-path>apps/api/src/migrations/1715472000000-InitFoundationSchema.ts</file-path>
<edits-collection>users, audit_log, revoked_jwt_jti, recovery_codes, setup_status</edits-collection>
<goals-covered>TS-05, TS-08, TS-10, TS-13, TS-17, TS-22, TS-24, TS-44, TS-46</goals-covered>
<estimated-loc>220</estimated-loc>

**Description:** TypeORM migration creating all 5 phase-01 tables with required indexes per CONTEXT P01.D-08 (`users.token_version` BIGINT not INT — Q-P01-03), P01.D-04 (`recovery_codes`), P01.D-24 (UNIQUE WHERE is_owner=true via generated col + partial index workaround for MySQL 8), audit_log immutability commentary (no UPDATE/DELETE app code path — P01.D-03 BR-1). Includes seed-safe `setup_status` row tracking and Q-P01-01 decision: keep `recovery_codes.used_at` (mark used vs delete) for forensic trail.

**Acceptance criteria:**
- [ ] `users (id BIGINT PK AI, username VARCHAR(64) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL, is_owner BOOLEAN NOT NULL DEFAULT FALSE, is_active BOOLEAN NOT NULL DEFAULT TRUE, token_version BIGINT NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))` created
- [ ] `audit_log (id BIGINT PK AI, actor_id BIGINT NULL, actor_name VARCHAR(64), ip VARCHAR(64), ts_ms BIGINT NOT NULL, action_kind VARCHAR(64) NOT NULL, target_kind VARCHAR(64), target_id VARCHAR(64), before_json JSON, after_json JSON)` + indexes `(actor_id, ts_ms)`, `(action_kind, ts_ms)`, `(target_kind, target_id)`
- [ ] `revoked_jwt_jti (jti VARCHAR(64) PK, revoked_at_ms BIGINT NOT NULL, expires_at_ms BIGINT NOT NULL)` + index `(expires_at_ms)`
- [ ] `recovery_codes (id BIGINT PK AI, user_id BIGINT FK users.id, code_hash VARCHAR(255) NOT NULL, used_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`
- [ ] `setup_status (id TINYINT PK CHECK (id=1), completed_at DATETIME(3) NULL)` — single-row sentinel for P01.D-24
- [ ] DB constraint enforces ≤1 owner (UNIQUE index on `is_owner` filtered via stored-gen column + partial UNIQUE or app-level)
- [ ] `up()` + `down()` both run cleanly (TS-24 + TS-25 / P01.D-21 idempotent revert)

**Read first:** `.vg/phases/01-foundation-auth-audit/CONTEXT/D-04.md`, `CONTEXT/D-08.md`, `CONTEXT/D-24.md`, FOUNDATION.md §9.5

---

### Task 2 — TypeORM entities (User, AuditLog, RevokedJwtJti, RecoveryCode, SetupStatus)

<file-path>apps/api/src/modules/auth/entities/user.entity.ts, apps/api/src/modules/audit/entities/audit-log.entity.ts, apps/api/src/modules/auth/entities/revoked-jwt-jti.entity.ts, apps/api/src/modules/auth/entities/recovery-code.entity.ts, apps/api/src/modules/setup/entities/setup-status.entity.ts</file-path>
<edits-collection>users, audit_log, revoked_jwt_jti, recovery_codes, setup_status</edits-collection>
<goals-covered>TS-05, TS-08, TS-10, TS-17</goals-covered>
<estimated-loc>180</estimated-loc>

**Description:** 5 entity classes (`@Entity()` decorators, columns matching migration in Task 1) per FOUNDATION §9.3 folder convention. No `password_hash` exposure (use `@Exclude()` from class-transformer where serialized). `tokenVersion` BIGINT mapped to `string` in TS to avoid JS number precision loss (or use `bigint` lib decorator). Audit before/after JSON typed as `Record<string, unknown> | null`.

**Acceptance criteria:**
- [ ] Each entity exports a class + matches DB schema 1:1 (typecheck passes)
- [ ] `User` has `@Exclude()` on `passwordHash` field
- [ ] `tokenVersion` typed correctly for BIGINT (no precision loss)
- [ ] No entity exposes `before_json/after_json` to plain serializer without sanitization

**Read first:** Task 1 migration output, FOUNDATION.md §9.3, `CONTEXT/D-08.md`

---

### Task 3 — Shared error-code enum + envelope schema in packages/schemas

<file-path>packages/schemas/src/errors.ts, packages/schemas/src/api-envelope.ts, packages/schemas/src/index.ts</file-path>
<goals-covered>TS-20, TS-21</goals-covered>
<estimated-loc>140</estimated-loc>

**Description:** Centralize error codes (P01.D-09): `AUTH_INVALID_CRED`, `AUTH_RATE_LIMITED`, `AUTH_TOKEN_REVOKED`, `AUTH_TOKEN_EXPIRED`, `AUTH_INACTIVE_USER`, `ADMIN_REQUIRED`, `OWN_PASSWORD_WRONG`, `RECOVERY_CODE_INVALID`, `SETUP_ALREADY_DONE`, `VALIDATION_FAILED`, `INTERNAL_ERROR`. Export as TS const-as enum + Zod schema for envelope per INTERFACE-STANDARDS.md (success `{ok, data, message?, meta?, request_id?}` + error `{ok:false, error:{code, message, user_message?, details?, field_errors?, request_id?}}`). FE + BE both import.

**Acceptance criteria:**
- [ ] `ErrorCode` exported as union string literal + const object
- [ ] `ApiSuccess<T>` + `ApiError` Zod schemas exported with `parse()` working
- [ ] All 11 codes from P01.D-09 present (unit test verifies `Object.values(ErrorCode).length === 11`)
- [ ] `packages/schemas/package.json` exports `./errors` + `./api-envelope` subpaths

**Read first:** INTERFACE-STANDARDS.md, `CONTEXT/D-09.md`

---

## Wave 2 — Cross-cutting: logger, error filter, request-id, trust-proxy

### Task 4 — NestJS app bootstrap: trust proxy, pino logger, request_id middleware

<file-path>apps/api/src/main.ts, apps/api/src/common/middleware/request-id.middleware.ts, apps/api/src/common/logger/logger.config.ts</file-path>
<goals-covered>TS-22, TS-23</goals-covered>
<estimated-loc>150</estimated-loc>

**Description:** Bootstrap NestJS app with `app.set('trust proxy', 1)` for nginx X-Forwarded-For (P01.D-10), wire `nestjs-pino` with redact paths `req.headers.cookie`, `req.headers.authorization`, `req.body.password`, `*.password_hash` (FOUNDATION §9.4 + P01.D-23 fixture privacy). RequestIdMiddleware generates UUID v4, attaches to `req.requestId`, response header `X-Request-Id`, AsyncLocalStorage for pino to auto-inject. Cookie parser + helmet (CSP `default-src 'self'`, X-Frame-Options DENY, HSTS 1y per FOUNDATION §9.5).

**Acceptance criteria:**
- [ ] `req.ip` resolves to X-Forwarded-For value when behind proxy (TS-22)
- [ ] Every response has `X-Request-Id` header matching `req.requestId` (TS-23)
- [ ] pino log lines include `request_id` field
- [ ] Sensitive fields redacted in logs (manual grep test: log a request with password field → never appears)
- [ ] Helmet + HSTS headers set

**Read first:** `CONTEXT/D-10.md`, FOUNDATION.md §9.4, §9.5

---

### Task 5 — Global ExceptionFilter: convert to error envelope

<file-path>apps/api/src/common/filters/global-exception.filter.ts</file-path>
<goals-covered>TS-20, TS-29, TS-31</goals-covered>
<estimated-loc>180</estimated-loc>

**Description:** NestJS `@Catch()` filter (P01.D-09) catches `HttpException`, `ZodError`, `QueryFailedError`, generic `Error`. Maps to error envelope per INTERFACE-STANDARDS.md: `{ok:false, error:{code, message, user_message?, field_errors?, request_id}}`. Status code matrix per P01.D-15 (200/201/204/400/401/403/422/429). class-validator failures → 422 + `VALIDATION_FAILED` + `field_errors`. Unknown → 500 + `INTERNAL_ERROR` (never leak stack to client; log server-side with request_id).

**Acceptance criteria:**
- [ ] `HttpException(401)` → envelope with `error.code='AUTH_INVALID_CRED'` (or pass-through if already mapped)
- [ ] class-validator 422 → `field_errors: {fieldName: ['msg1','msg2']}` (TS-29)
- [ ] Unknown error → 500 + `INTERNAL_ERROR` + log includes stack + request_id
- [ ] Status code matrix mapping verified for each code (TS-31 matrix unit test)

**Read first:** `CONTEXT/D-09.md`, `CONTEXT/D-15.md`, INTERFACE-STANDARDS.md

---

### Task 6 — Health endpoint + Swagger setup

<file-path>apps/api/src/modules/health/health.controller.ts, apps/api/src/modules/health/health.module.ts, apps/api/src/common/swagger/setup.ts</file-path>
<edits-endpoint>GET /health</edits-endpoint>
<goals-covered>TS-28, TS-30</goals-covered>
<estimated-loc>90</estimated-loc>

**Description:** `GET /health` returns `{ok:true, data:{status:'alive', ts_ms, version}}` (no DB roundtrip — used by pm2/nginx upstream check per vg.config services.local.check). Swagger spec mounted at `/api/docs` dev-only (gate via `process.env.NODE_ENV !== 'production'`) per P01.D-14. `@nestjs/swagger` decorators discovered from controllers in later waves.

**Acceptance criteria:**
- [ ] `curl http://localhost:3000/health` → 200 envelope
- [ ] `/api/docs` renders in dev, 404 in production env (TS-30)
- [ ] No new DB queries per /health call

**Read first:** `CONTEXT/D-14.md`, vg.config.md services block

---

## Wave 3 — Auth backend (login/logout/me/change-password/recover + setup)

### Task 7 — Auth DTOs + class-validator decorators

<file-path>apps/api/src/modules/auth/dto/login.dto.ts, apps/api/src/modules/auth/dto/change-password.dto.ts, apps/api/src/modules/auth/dto/recover.dto.ts, apps/api/src/modules/setup/dto/setup.dto.ts</file-path>
<goals-covered>TS-29, TS-39</goals-covered>
<estimated-loc>110</estimated-loc>

**Description:** DTO classes per P01.D-14 with `@IsString @MinLength(1) @MaxLength(64) username`, `@IsString @MinLength(8) password`, `@IsString @Length(16,16) code` for recover. `@ApiProperty` decorators for OpenAPI. Validation pipe attached globally with `transform:true, whitelist:true, forbidNonWhitelisted:true`.

**Acceptance criteria:**
- [ ] Each DTO has @ApiProperty + class-validator decorators
- [ ] Invalid input → 422 envelope with field_errors (covered by Task 5 filter)
- [ ] password min-length 8 matches FOUNDATION §9.5

**Read first:** `CONTEXT/D-14.md`, FOUNDATION.md §9.5

---

### Task 8 — JwtAuthGuard + tv check + JTI blacklist check

<file-path>apps/api/src/modules/auth/guards/jwt-auth.guard.ts, apps/api/src/modules/auth/guards/owner.guard.ts</file-path>
<goals-covered>TS-03, TS-04, TS-14, TS-17, TS-18, TS-19</goals-covered>
<estimated-loc>200</estimated-loc>

**Description:** Custom guard (P01.D-08 + P01.D-06): read cookie `ssp_token`, verify HS256 signature with `process.env.JWT_SECRET`, decode `{sub, name, iat, exp, jti, tv}`. Fail paths: missing/invalid signature/expired → 401 `AUTH_TOKEN_EXPIRED`, JTI in `revoked_jwt_jti` table → 401 `AUTH_TOKEN_REVOKED`, `tv !== users.token_version` → 401 `AUTH_TOKEN_REVOKED`, `users.is_active=false` → 401 `AUTH_INACTIVE_USER`. OwnerGuard runs after JwtAuthGuard and asserts `user.isOwner=true` else 403 `ADMIN_REQUIRED` (P01.D-02 BR-6). Attach decoded user to `req.user`.

**Acceptance criteria:**
- [ ] Missing cookie → 401 `AUTH_INVALID_CRED` (no token)
- [ ] Expired token → 401 `AUTH_TOKEN_EXPIRED` (TS-17 partial)
- [ ] JTI in blacklist → 401 `AUTH_TOKEN_REVOKED` (TS-04 covered + logout)
- [ ] `tv` mismatch → 401 `AUTH_TOKEN_REVOKED` (TS-17/18/19)
- [ ] `is_active=false` → 401 `AUTH_INACTIVE_USER` (TS-14)
- [ ] OwnerGuard 403 `ADMIN_REQUIRED` when `is_owner=false` (TS-03)
- [ ] OwnerGuard 200 path when `is_owner=true` (TS-04)

**Read first:** `CONTEXT/D-02.md`, `CONTEXT/D-06.md`, `CONTEXT/D-08.md`

---

### Task 9 — AuthService: login + password verify + JWT issue

<file-path>apps/api/src/modules/auth/auth.service.ts</file-path>
<goals-covered>TS-01, TS-02, TS-06, TS-50</goals-covered>
<estimated-loc>240</estimated-loc>

**Description:** Methods `login(username, password, ip)` → bcrypt verify (cost 10, F-17), issue JWT (HS256, payload `{sub, name, iat, exp=now+7d, jti=uuid, tv}`), return `{user, token, jti, expMs}`; `logout(jti, expMs)` → insert into `revoked_jwt_jti`; `changePassword(userId, oldPw, newPw)` → verify old → bcrypt new → update users + tv++; `revokeAllForUser(userId)` → tv++; `recover(code, newPw)` → bcrypt-compare code against all `recovery_codes` rows for owner, mark used_at, update password + tv++. Audit emit done in Wave 4 via EventEmitter.

**Acceptance criteria:**
- [ ] Wrong password → throw 401 `AUTH_INVALID_CRED` (TS-01 fail leg)
- [ ] Correct → token signed with .env secret, exp = iat + 7*86400 (verify with jwt.verify)
- [ ] Password hash uses bcrypt cost 10 + min length 8 enforced before hash
- [ ] changePassword: old wrong → 422 `OWN_PASSWORD_WRONG`, success → tv++ in DB (TS-02, TS-17)
- [ ] No plaintext password ever logged/returned (grep test in Task 26)

**Read first:** `CONTEXT/D-04.md`, `CONTEXT/D-08.md`, FOUNDATION.md §9.5

---

### Task 10 — AuthController: 4 endpoints + rate-limit + cookie set

<file-path>apps/api/src/modules/auth/auth.controller.ts, apps/api/src/modules/auth/auth.module.ts</file-path>
<edits-endpoint>POST /auth/login, POST /auth/logout, GET /auth/me, POST /auth/change-password, POST /auth/recover</edits-endpoint>
<goals-covered>TS-01, TS-02, TS-06, TS-08, TS-09, TS-31, TS-50</goals-covered>
<estimated-loc>230</estimated-loc>

**Description:** Wire endpoints per SPECS + P01.D-04 + P01.D-15: `POST /auth/login` → set cookie `ssp_token` HttpOnly/Secure/SameSite=Strict/Max-Age=7d, 200 + `{ok:true, data:{user:{id,name,isOwner}}}`; `POST /auth/logout` → 204 + clear cookie; `GET /auth/me` → 200 with current user; `POST /auth/change-password` → 200 + refresh cookie (new JWT after tv++); `POST /auth/recover` → 200. Apply `@Throttle({default:{limit:5, ttl:300_000}})` on /auth/login + /auth/recover per P01.D-26 (BR-3). Decorate with `@ApiTags('auth')`. 5xx → envelope via global filter.

**Acceptance criteria:**
- [ ] Login success → `Set-Cookie: ssp_token=...; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`
- [ ] 5 failed logins in 5 min from same IP → 6th gets 429 + `Retry-After: 900` (TS-06/TS-50)
- [ ] /auth/me requires JwtAuthGuard, returns `{sub, name, isOwner}`
- [ ] /auth/recover with reused code → 401 `RECOVERY_CODE_INVALID` (TS-09)
- [ ] /auth/recover success → password updated + tv++ + recovery_code.used_at set (TS-08)
- [ ] Status codes match P01.D-15 matrix (TS-31)

**Read first:** `CONTEXT/D-04.md`, `CONTEXT/D-15.md`, `CONTEXT/D-26.md`, SPECS §Scope/API Auth

---

### Task 11 — SetupModule: GET /setup + POST /setup with IP gate + recovery code generation

<file-path>apps/api/src/modules/setup/setup.controller.ts, apps/api/src/modules/setup/setup.service.ts, apps/api/src/modules/setup/setup.module.ts, apps/api/src/modules/setup/guards/setup-ip.guard.ts</file-path>
<edits-endpoint>GET /setup, POST /setup</edits-endpoint>
<edits-collection>users, recovery_codes, setup_status</edits-collection>
<goals-covered>TS-11, TS-12, TS-13, TS-46, TS-47</goals-covered>
<estimated-loc>240</estimated-loc>

**Description:** Implement P01.D-05 + P01.D-24 dual gate: (a) atomic transaction check `users.count()===0` + `setup_status.completed_at IS NULL` with `SELECT ... FOR UPDATE`; (b) `SetupIpGuard` compares `req.ip` against `process.env.SETUP_ALLOWED_IP` (comma-list ok). On valid POST → create owner user (bcrypt cost 10), generate 16-char random recovery code via `crypto.randomBytes(12).toString('base64url').slice(0,16)`, bcrypt-hash → insert `recovery_codes` row, mark `setup_status.completed_at=now()`, return 201 with `{user, recoveryCode}` (plaintext code shown ONCE — last time). After complete → both endpoints return 404 `SETUP_ALREADY_DONE`.

**Acceptance criteria:**
- [ ] GET /setup when DB empty + IP allowed → 200 + render hint envelope (TS-11)
- [ ] GET /setup after owner exists → 404 `SETUP_ALREADY_DONE` (TS-12)
- [ ] POST /setup from unauthorized IP → 403 + audit log row `setup.blocked.ip` (TS-46)
- [ ] 2 concurrent POST /setup → exactly 1 owner (transaction + UNIQUE constraint, TS-13/TS-47)
- [ ] recovery_code stored as bcrypt hash, plaintext never in DB nor logs (TS-10)
- [ ] DB constraint enforces ≤1 owner

**Read first:** `CONTEXT/D-04.md`, `CONTEXT/D-05.md`, `CONTEXT/D-24.md`

---

### Task 12 — CSRF Origin/Referer middleware for mutations

<file-path>apps/api/src/common/middleware/csrf-origin.middleware.ts</file-path>
<goals-covered>TS-26, TS-27</goals-covered>
<estimated-loc>110</estimated-loc>

**Description:** Per P01.D-12 + P01.D-13: middleware applied to `POST|PUT|PATCH|DELETE` requests under `/auth/*` + `/admin/*` + `/setup`. Compare `req.headers.origin` (fallback `referer`) against `process.env.FE_ORIGIN` (e.g. `https://order-quan-balun.com`). Mismatch or missing → 403 `ADMIN_REQUIRED` (reuse code for hostile-origin block). GET/HEAD bypass. Defense-in-depth on top of SameSite=Strict cookie (F-17).

**Acceptance criteria:**
- [ ] POST with `Origin: https://order-quan-balun.com` → pass-through (TS-26)
- [ ] POST with `Origin: https://evil.com` → 403 (TS-27)
- [ ] POST with no Origin/Referer → 403
- [ ] GET requests never blocked by this middleware

**Read first:** `CONTEXT/D-12.md`, `CONTEXT/D-13.md`

---

## Wave 4 — Audit + admin-users backend

### Task 13 — AuditInterceptor (async event emit) + AuditService write handler

<file-path>apps/api/src/modules/audit/audit.interceptor.ts, apps/api/src/modules/audit/audit.service.ts, apps/api/src/modules/audit/audit.module.ts, apps/api/src/modules/audit/audit.types.ts</file-path>
<edits-collection>audit_log</edits-collection>
<goals-covered>TS-07, TS-16, TS-22, TS-23, TS-48, TS-52</goals-covered>
<estimated-loc>240</estimated-loc>

**Description:** NestJS Interceptor (P01.D-25 + P01.D-07 + P01.D-28) captures `POST/PUT/PATCH/DELETE` requests + flagged GETs (`/admin/audit*` for meta-audit). On response complete → emit `audit.event` with `{actor_id, actor_name, ip, ts_ms, action_kind, target_kind, target_id, before_json, after_json, request_id}` to `EventEmitter2` (`@nestjs/event-emitter`). Handler subscribes and persists via TypeORM async (`setImmediate`-equivalent). Sanitization: strip `password`, `password_hash`, `recoveryCode`, `code` from before/after JSON before insert. Action-kind catalog: `auth.login_success`, `auth.login_failed`, `auth.logout`, `auth.password_changed`, `admin.user_created`, `admin.password_reset`, `admin.user_disabled`, `setup.completed`, `setup.blocked.ip`, `audit.viewed`, `audit.exported`.

**Acceptance criteria:**
- [ ] Single mutation → 1 audit_log row inserted within 5s (TS-07, TS-48)
- [ ] Response not blocked waiting for audit INSERT (measure response time pre/post)
- [ ] Sanitizer removes password fields (unit test with synthetic payload)
- [ ] GET /admin/audit → row `action_kind='audit.viewed'`, `before_json={filter, page}` (TS-16, TS-52)
- [ ] audit_log.ip = real client IP via trust proxy (TS-22)
- [ ] audit_log.request_id matches response X-Request-Id (TS-23)

**Read first:** `CONTEXT/D-07.md`, `CONTEXT/D-25.md`, `CONTEXT/D-28.md`

---

### Task 14 — Audit viewer endpoints (list + CSV export)

<file-path>apps/api/src/modules/audit/audit.controller.ts, apps/api/src/modules/audit/audit-export.service.ts</file-path>
<edits-endpoint>GET /admin/audit, GET /admin/audit/export.csv</edits-endpoint>
<edits-collection>audit_log</edits-collection>
<goals-covered>TS-16, TS-52</goals-covered>
<estimated-loc>220</estimated-loc>

**Description:** Owner-only (OwnerGuard). `GET /admin/audit?actor=&action_kind=&from=&to=&page=&page_size=` returns paged list (default 20 per FOUNDATION §9.9), URL-state-friendly. `GET /admin/audit/export.csv` streams CSV with headers `id,actor_id,actor_name,ip,ts_ms,action_kind,target_kind,target_id,before_json,after_json` (JSON columns stringified, comma/quote escaped per RFC 4180). Both endpoints trigger AuditInterceptor → meta-audit row (P01.D-07/D-28). Throttle CSV export to 1 per 10s.

**Acceptance criteria:**
- [ ] Filter by actor + date range returns correct rows
- [ ] CSV file ≥ 1 row when audit_log has data
- [ ] CSV headers correct + RFC 4180 escaping for embedded quotes
- [ ] Both endpoints log meta-audit row (TS-16, TS-52)
- [ ] Pagination meta in envelope (`meta:{total, page, page_size}`)

**Read first:** `CONTEXT/D-07.md`, `CONTEXT/D-28.md`, FOUNDATION.md §9.9

---

### Task 15 — Admin users module (CRUD + reset + disable)

<file-path>apps/api/src/modules/admin/users/admin-users.controller.ts, apps/api/src/modules/admin/users/admin-users.service.ts, apps/api/src/modules/admin/users/admin-users.module.ts, apps/api/src/modules/admin/users/dto/create-user.dto.ts</file-path>
<edits-endpoint>POST /admin/users, GET /admin/users, POST /admin/users/:id/reset-password, POST /admin/users/:id/disable</edits-endpoint>
<edits-collection>users</edits-collection>
<goals-covered>TS-03, TS-04, TS-14, TS-15, TS-18, TS-19</goals-covered>
<estimated-loc>240</estimated-loc>

**Description:** Per SPECS Admin user management + P01.D-06 + P01.D-08: `POST /admin/users` (201, bcrypt cost 10, audit `admin.user_created`); `GET /admin/users` (200, exclude password_hash); `POST /admin/users/:id/reset-password` (200 returns temp password ONCE in response body, bcrypt-hash to DB, tv++, audit `admin.password_reset`); `POST /admin/users/:id/disable` (204, set is_active=false + tv++, audit `admin.user_disabled`). All routes behind `JwtAuthGuard` + `OwnerGuard`. Cannot disable self (`req.user.sub === :id` → 422 with helpful message).

**Acceptance criteria:**
- [ ] Staff calling any → 403 ADMIN_REQUIRED (TS-03)
- [ ] Owner can list + create + reset + disable (TS-04)
- [ ] Disable target → JWT cũ next request → 401 AUTH_INACTIVE_USER (TS-14 via Task 8 guard)
- [ ] Disabled user re-login attempt → 401 AUTH_INACTIVE_USER (TS-15)
- [ ] Reset password → tv++ + old JWT 401 (TS-18)
- [ ] Owner cannot disable own account (422 with friendly message)

**Read first:** `CONTEXT/D-02.md`, `CONTEXT/D-06.md`, `CONTEXT/D-08.md`

---

### Task 16 — Cron jobs: audit retention 90d + JTI cleanup

<file-path>apps/api/src/modules/audit/audit-retention.cron.ts, apps/api/src/modules/auth/jti-cleanup.cron.ts, apps/api/src/app.module.ts</file-path>
<edits-collection>audit_log, revoked_jwt_jti, recovery_codes</edits-collection>
<goals-covered>TS-05, TS-44</goals-covered>
<estimated-loc>140</estimated-loc>

**Description:** Two `@Cron` jobs via `@nestjs/schedule`: (a) `auditRetentionCron` daily 03:00 ICT (`0 3 * * *` with `timeZone:'Asia/Ho_Chi_Minh'` per F-15) → `DELETE FROM audit_log WHERE ts_ms < UNIX_TIMESTAMP() * 1000 - 90 * 86400000` in batches of 10k; (b) `jtiCleanupCron` daily 03:30 ICT → `DELETE FROM revoked_jwt_jti WHERE expires_at_ms < now()`. Log row counts at info level. Disable in test env via `process.env.NODE_ENV==='test'` short-circuit.

**Acceptance criteria:**
- [ ] Cron registered with timezone Asia/Ho_Chi_Minh
- [ ] Inserted fake row at ts_ms = now-91d → cron run → row removed (TS-05 + retention success criterion)
- [ ] JTI cleanup removes only expired rows, fresh rows untouched
- [ ] Logs include `{deleted_count, duration_ms}` per run
- [ ] No cron in NODE_ENV=test

**Read first:** SPECS §Audit log retention, FOUNDATION.md §3 (F-15 timezone)

---

## Wave 5 — Shared UI kit + FE foundation (axios + auth-guard)

### Task 17 — packages/ui-kit primitives (Button, Input, Form, Modal, Toast, EmptyState, Spinner)

<file-path>packages/ui-kit/src/Button.tsx, packages/ui-kit/src/Input.tsx, packages/ui-kit/src/Form.tsx, packages/ui-kit/src/Modal.tsx, packages/ui-kit/src/Toast.tsx, packages/ui-kit/src/EmptyState.tsx, packages/ui-kit/src/Spinner.tsx, packages/ui-kit/src/index.ts</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-32, TS-33, TS-40, TS-41</goals-covered>
<estimated-loc>240</estimated-loc>
<test_ids>
  <id kind="button" value="ui-button-default">Default Button primitive</id>
  <id kind="input" value="ui-input-default">Default Input primitive</id>
  <id kind="form" value="ui-form-default">Form root primitive</id>
  <id kind="modal" value="ui-modal-default">Modal root primitive</id>
</test_ids>

**Description:** Mobile-first primitives per FOUNDATION F-16 + BR-5 (P01.D-03) + P01.D-16: `Button` (min 44×44, full-width prop, `font-size:16px` min); `Input` (height ≥44, label-above, error prop renders red border + below-input message); `Form` (single-column, on-blur validation hook adapter); `Modal` (drawer-from-bottom on mobile ≤768px, centered on desktop); `Toast` (top-fixed, auto-dismiss 4s, accept `error.user_message || error.message`); `EmptyState` + `Spinner` for list states. Each component accepts `data-testid` prop pass-through (vg.config.md test_ids). No hover-only interactions (mobile no hover).

**Acceptance criteria:**
- [ ] Button renders min 44×44 with visible focus ring (touch-friendly)
- [ ] Input height 44 + font 16 (prevents iOS zoom)
- [ ] Form `onBlur` per-field validation (TS-32 driver primitive)
- [ ] Modal renders bottom-drawer on <768px viewport (matMedia test)
- [ ] Toast subscribes to global error bus + displays user_message priority per INTERFACE-STANDARDS
- [ ] All components accept + forward `data-testid` prop

**Read first:** FOUNDATION.md §9.6 mobile budget, `CONTEXT/D-16.md`, INTERFACE-STANDARDS.md frontend block

---

### Task 18 — packages/ui-kit advanced (PasswordInput, StrengthMeter, Table, ErrorBoundary, ReLoginModal)

<file-path>packages/ui-kit/src/PasswordInput.tsx, packages/ui-kit/src/StrengthMeter.tsx, packages/ui-kit/src/Table.tsx, packages/ui-kit/src/ErrorBoundary.tsx, packages/ui-kit/src/ReLoginModal.tsx</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-34, TS-35, TS-37, TS-38, TS-39, TS-41</goals-covered>
<estimated-loc>240</estimated-loc>
<test_ids>
  <id kind="button" value="ui-password-toggle-btn">Show/hide password toggle</id>
  <id kind="input" value="ui-password-input">Password input</id>
  <id kind="modal" value="ui-relogin-modal">Re-login modal root</id>
  <id kind="form" value="ui-relogin-form">Re-login modal form</id>
  <id kind="table-row" value="ui-table-row-{id}">Generic table row (dynamic id)</id>
</test_ids>

**Description:** `PasswordInput` (P01.D-19): eye-icon toggle visibility, caps-lock detection via `getModifierState('CapsLock')` + warning text "Caps Lock đang bật"; `StrengthMeter` lazy-loads `zxcvbn` (chunk-split — only loaded on /setup); `Table` renders as standard table on ≥768px, card-stack on mobile (P01.D-20 TS-41); `ErrorBoundary` (FOUNDATION §9.4) catches React errors → fallback EmptyState; `ReLoginModal` (P01.D-17): username read-only, password input, on success retries original request via global event.

**Acceptance criteria:**
- [ ] PasswordInput eye click toggles type=password ↔ text (TS-37)
- [ ] Caps-lock state detected + warning rendered (TS-38)
- [ ] StrengthMeter shows red/yellow/green per zxcvbn score 0-4 (TS-39)
- [ ] Table responsive switch at 768px breakpoint (TS-41)
- [ ] ReLoginModal renders only on 401 event, hidden by default

**Read first:** `CONTEXT/D-17.md`, `CONTEXT/D-19.md`, `CONTEXT/D-20.md`

---

### Task 19 — FE axios client + 401 re-login interceptor + i18n VN errors

<file-path>apps/web/src/lib/axios.ts, apps/web/src/lib/error-bus.ts, apps/web/src/i18n/errors.vi.ts</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-18, TS-34, TS-35, TS-36</goals-covered>
<estimated-loc>200</estimated-loc>

**Description:** Singleton axios client with `withCredentials:true`, base `/api`. Response interceptor: 401 → emit `auth:expired` event with original request config → ReLoginModal subscribes → on re-login success → retry config + resolve original promise; on re-login fail → modal stays (P01.D-17). 422 → if `field_errors` present, propagate to form; else toast. Other 4xx/5xx → toast `error.user_message || error.message || network_fallback` per INTERFACE-STANDARDS message priority. `errors.vi.ts` central map P01.D-18: `{AUTH_INVALID_CRED:'Ôi, sai mật khẩu rồi. Thử lại nhé!', AUTH_RATE_LIMITED:'Thử nhiều quá rồi. Đợi 15 phút nhé.', AUTH_TOKEN_EXPIRED:'Phiên đăng nhập hết hạn, đăng nhập lại nhé.', ...}` (one entry per code from P01.D-09).

**Acceptance criteria:**
- [ ] 401 mid-request → modal renders, original request paused (TS-34)
- [ ] Re-login success → original request retried + resolved (TS-34)
- [ ] Re-login fail → modal stays (TS-35)
- [ ] Toast never shows "Request failed with status..." (TS-36 + INTERFACE-STANDARDS)
- [ ] All 11 ErrorCode values have a VN message entry

**Read first:** `CONTEXT/D-17.md`, `CONTEXT/D-18.md`, INTERFACE-STANDARDS.md, `CONTEXT/D-09.md`

---

### Task 20 — Auth-guard HOC + useAuth hook + router skeleton

<file-path>apps/web/src/features/auth/hooks/use-auth.ts, apps/web/src/features/auth/components/auth-guard.tsx, apps/web/src/App.tsx, apps/web/src/main.tsx</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-01, TS-03, TS-04, TS-14</goals-covered>
<estimated-loc>180</estimated-loc>
<test_ids>
  <id kind="link" value="nav-logout-link">Logout link in app shell</id>
</test_ids>

**Description:** `useAuth()` hook calls `GET /auth/me` once on mount, caches result via React context; `AuthGuard` wraps protected route → if loading → Spinner, if 401 → `<Navigate to="/login" replace />`, if owner-only route + not owner → `<Navigate to="/dashboard" replace />` (P01.D-02). React Router 6 routes: `/login`, `/setup`, `/recover` public; `/dashboard`, `/account`, `/admin/users`, `/admin/audit` guarded; owner-only: `/admin/*`. App shell includes logout button (`POST /auth/logout` → clear context → navigate /login).

**Acceptance criteria:**
- [ ] Direct hit `/admin/users` while logged out → redirect /login (TS-03 surface)
- [ ] Staff hits `/admin/users` → redirect /dashboard
- [ ] Owner hits `/admin/users` → renders (TS-04)
- [ ] Logout clears cookie + context → /login

**Read first:** `CONTEXT/D-02.md`, SPECS §FE pages

---

## Wave 6 — FE pages: login, setup, recover, admin-users, admin-audit, account

### Task 21 — Login page (mobile-first, on-blur validation, friendly VN errors)

<file-path>apps/web/src/features/auth/pages/login.tsx, apps/web/src/features/auth/components/login-form.tsx</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-01, TS-06, TS-32, TS-33, TS-36, TS-37, TS-38, TS-40</goals-covered>
<estimated-loc>220</estimated-loc>
<test_ids>
  <id kind="form" value="login-form">Login form root</id>
  <id kind="input" value="login-username-input">Username field</id>
  <id kind="input" value="login-password-input">Password field</id>
  <id kind="button" value="login-submit-btn">Submit button</id>
  <id kind="button" value="login-password-toggle-btn">Show/hide password toggle</id>
  <id kind="link" value="login-recover-link">Forgot password / recover link</id>
</test_ids>

**Description:** Single-column mobile-first form. Inputs use `<Input>` + `<PasswordInput>` from ui-kit. On-blur validation (P01.D-16): empty username → "Bắt buộc nhập tên đăng nhập"; password <8 → "Mật khẩu tối thiểu 8 ký tự". Submit disabled while pending. Friendly VN error toast (P01.D-18) on 401/429. iPhone SE viewport 320×568 must render without horizontal scroll. After success → axios cookie set + navigate `/dashboard`. Performance budget: route bundle ≤150KB gzip (F-16 §9.6) — verify via build report.

**Acceptance criteria:**
- [ ] Blur empty field → inline error (TS-32)
- [ ] Submit invalid → all errors shown (TS-33)
- [ ] Eye toggle on password (TS-37) + caps-lock warning (TS-38)
- [ ] 401 → toast VN friendly (TS-36); 429 → "Đợi 15 phút nhé"
- [ ] Renders correctly at 320×568 (TS-40 — Playwright iPhone SE profile)
- [ ] Bundle ≤150KB gzip for `/login` route (verified at Wave 7 CI)

**Read first:** `CONTEXT/D-16.md`, `CONTEXT/D-18.md`, `CONTEXT/D-20.md`, FOUNDATION.md F-16

---

### Task 22 — Setup wizard page (greenfield first-owner) with strength meter + recovery-code display

<file-path>apps/web/src/features/setup/pages/setup.tsx, apps/web/src/features/setup/pages/setup-complete.tsx</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-11, TS-12, TS-13, TS-39, TS-46</goals-covered>
<estimated-loc>200</estimated-loc>
<test_ids>
  <id kind="form" value="setup-form">Setup wizard form root</id>
  <id kind="input" value="setup-username-input">Owner username</id>
  <id kind="input" value="setup-password-input">Owner password</id>
  <id kind="button" value="setup-submit-btn">Submit setup</id>
  <id kind="button" value="setup-copy-recovery-btn">Copy recovery code</id>
</test_ids>

**Description:** P01.D-05 + P01.D-19: SetupPage fetches `GET /setup` on mount → if 404 navigate `/login`; renders form (username + password + StrengthMeter lazy-loaded zxcvbn — only on this route). Submit `POST /setup` → on 201 navigate `/setup-complete?code=...` (code via in-memory state, not URL — refresh-loss accepted with "save now" warning). SetupCompletePage shows code with copy-to-clipboard + warning "Hệ thống sẽ không hiển thị lại — hãy lưu ngay (chụp màn hình / in giấy)" + "Đăng nhập" CTA.

**Acceptance criteria:**
- [ ] /setup renders form when GET /setup returns 200 (TS-11)
- [ ] Weak password → meter red + warning (TS-39)
- [ ] Submit success → 201 response → code rendered ONCE
- [ ] Refresh on /setup-complete → code gone (in-memory only) + redirect /login
- [ ] Unauthorized IP → setup endpoint 403 → page renders friendly VN error (TS-46 FE leg)

**Read first:** `CONTEXT/D-05.md`, `CONTEXT/D-19.md`, `CONTEXT/D-24.md`

---

### Task 23 — Recover + change-password pages

<file-path>apps/web/src/features/auth/pages/recover.tsx, apps/web/src/features/account/pages/change-password.tsx</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-02, TS-08, TS-09</goals-covered>
<estimated-loc>180</estimated-loc>
<test_ids>
  <id kind="form" value="recover-form">Recover form</id>
  <id kind="input" value="recover-code-input">Recovery code input</id>
  <id kind="input" value="recover-new-password-input">New password input</id>
  <id kind="button" value="recover-submit-btn">Recover submit button</id>
  <id kind="form" value="change-password-form">Change password form</id>
  <id kind="input" value="change-password-old-input">Old password input</id>
  <id kind="input" value="change-password-new-input">New password input</id>
  <id kind="button" value="change-password-submit-btn">Change password submit</id>
</test_ids>

**Description:** `/recover` (public): username (read-only or pre-fill from query) + 16-char code + new-password fields. Submit `POST /auth/recover` → on success show success toast + navigate `/login`; on `RECOVERY_CODE_INVALID` → form-level error. `/account/change-password` (guarded): old + new + confirm password. Submit `POST /auth/change-password` → success → toast + (since tv++) axios will get fresh cookie automatically → stay on page. Both use ui-kit `<Form>` + `<PasswordInput>` with on-blur (P01.D-16).

**Acceptance criteria:**
- [ ] Recover happy path → user can login with new password (TS-08 FE leg)
- [ ] Recover with used code → form shows VN friendly error (TS-09)
- [ ] Change password wrong old → field error `OWN_PASSWORD_WRONG` (TS-02 leg)
- [ ] Change password success → user remains logged in (cookie refreshed) (TS-02)

**Read first:** `CONTEXT/D-04.md`, `CONTEXT/D-09.md`, `CONTEXT/D-18.md`

---

### Task 24 — Admin users list + create + reset + disable UI

<file-path>apps/web/src/features/admin-users/pages/users-list.tsx, apps/web/src/features/admin-users/pages/users-create.tsx, apps/web/src/features/admin-users/components/reset-password-modal.tsx, apps/web/src/features/admin-users/components/disable-confirm-dialog.tsx</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-03, TS-04, TS-14, TS-15, TS-41</goals-covered>
<estimated-loc>240</estimated-loc>
<test_ids>
  <id kind="table-row" value="users-table-row-{userId}">User row in admin list (dynamic)</id>
  <id kind="button" value="users-create-btn">Create user button</id>
  <id kind="button" value="users-reset-pw-btn-{userId}">Reset password button per row</id>
  <id kind="button" value="users-disable-btn-{userId}">Disable button per row</id>
  <id kind="form" value="users-create-form">Create user form</id>
  <id kind="input" value="users-create-username-input">New username input</id>
  <id kind="input" value="users-create-password-input">Initial password input</id>
  <id kind="modal" value="users-reset-modal">Reset password modal</id>
  <id kind="modal" value="users-disable-confirm">Disable confirm dialog</id>
</test_ids>

**Description:** OwnerGuard route (FE redirect if not owner, BE 403 belt-and-suspenders). UsersList: Table from ui-kit (card-stack on mobile, TS-41), URL-state filter (`?status=active|disabled&page=1`) per FOUNDATION §9.9, debounce search 300ms. UsersCreate: form → POST /admin/users → on success show temp password (mirror /setup-complete UX: copy-to-clipboard + "lưu ngay"). ResetPasswordModal: confirm → POST → display new temp password ONCE. DisableConfirmDialog: confirm dialog with friendly VN copy.

**Acceptance criteria:**
- [ ] Staff direct nav → redirect /dashboard (TS-03)
- [ ] Owner sees full table (TS-04)
- [ ] Create user → list refreshes, new user visible
- [ ] Reset PW → temp password shown ONCE, copy works
- [ ] Disable → row visually marked inactive, target's session 401 next request (TS-14)
- [ ] Mobile viewport → table renders as cards (TS-41)

**Read first:** `CONTEXT/D-02.md`, `CONTEXT/D-06.md`, FOUNDATION.md §9.9

---

### Task 25 — Admin audit log viewer + filter + CSV export

<file-path>apps/web/src/features/admin-audit/pages/audit-log.tsx, apps/web/src/features/admin-audit/components/filter-form.tsx</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-16, TS-41, TS-52</goals-covered>
<estimated-loc>230</estimated-loc>
<test_ids>
  <id kind="form" value="audit-filter-form">Audit filter form root</id>
  <id kind="input" value="audit-filter-actor-input">Actor filter input</id>
  <id kind="select" value="audit-filter-action-select">Action kind dropdown</id>
  <id kind="input" value="audit-filter-from-input">Date from</id>
  <id kind="input" value="audit-filter-to-input">Date to</id>
  <id kind="button" value="audit-filter-apply-btn">Apply filter</id>
  <id kind="button" value="audit-export-csv-btn">Export CSV button</id>
  <id kind="table-row" value="audit-table-row-{id}">Audit row (dynamic)</id>
</test_ids>

**Description:** Owner-only. Filter by `actor`, `action_kind` (dropdown of 11 catalog values from Task 13), `from/to` (date pickers — native input type=date for mobile keyboard). URL-state per FOUNDATION §9.9 (refresh keeps filter). Table renders compact rows (mobile: card-stack with key fields). Export CSV button → `window.location.href = '/api/admin/audit/export.csv?<filter>'` (browser downloads); throttle UI button 10s. Pagination 20/page with prev/next.

**Acceptance criteria:**
- [ ] Filter actor+date → results match (TS-16)
- [ ] URL params encode filter, refresh preserves (FOUNDATION §9.9)
- [ ] CSV download produces ≥ 1 row file when filtered set non-empty
- [ ] Mobile renders as card-stack (TS-41)
- [ ] Page navigation triggers new meta-audit row (TS-52)

**Read first:** `CONTEXT/D-07.md`, `CONTEXT/D-28.md`, FOUNDATION.md §9.9

---

### Task 26 — Dashboard placeholder + logout

<file-path>apps/web/src/features/dashboard/pages/dashboard.tsx, apps/web/src/features/dashboard/components/app-shell.tsx</file-path>
<design-ref>none-greenfield</design-ref>
<goals-covered>TS-04, TS-40</goals-covered>
<estimated-loc>130</estimated-loc>
<test_ids>
  <id kind="button" value="dashboard-logout-btn">Logout button</id>
  <id kind="link" value="dashboard-admin-users-link">Link to admin users (owner only)</id>
  <id kind="link" value="dashboard-admin-audit-link">Link to admin audit (owner only)</id>
</test_ids>

**Description:** Placeholder dashboard page satisfying SPECS §FE/pages (`/dashboard` post-login landing). Bottom navigation pattern (F-16 mobile no-sidebar). Owner sees admin links; staff sees only "Đăng xuất" + welcome `Xin chào, {name}`. Real features land in Phases 02-06. App shell is responsive (bottom nav on mobile, top header desktop).

**Acceptance criteria:**
- [ ] Logged-in staff sees dashboard + welcome name + logout
- [ ] Owner sees admin links (Users, Audit)
- [ ] Logout button posts /auth/logout + redirects /login
- [ ] iPhone SE viewport → bottom nav, no horizontal scroll (TS-40)

**Read first:** SPECS §FE pages, FOUNDATION.md F-16

---

## Wave 7 — Tests, CI, deploy plumbing

### Task 27 — Vitest unit tests: auth service + error codes + sanitizer

<file-path>apps/api/src/modules/auth/auth.service.spec.ts, apps/api/src/modules/audit/audit.service.spec.ts, packages/schemas/src/errors.spec.ts, apps/api/src/common/filters/global-exception.filter.spec.ts</file-path>
<goals-covered>TS-05, TS-10, TS-20, TS-21, TS-31, TS-44, TS-45</goals-covered>
<estimated-loc>240</estimated-loc>

**Description:** Unit coverage for pure logic: bcrypt verify, JWT sign/verify with mocked secret, sanitizer strips password fields (assert grep coverage TS-45 — never plaintext password in audit row), error code enum completeness (TS-21), error envelope shape (TS-20), status code matrix (TS-31). Vitest config sets `retry: 2` per P01.D-21/TS-44; coverage threshold 70 per FOUNDATION §9.7.

**Acceptance criteria:**
- [ ] `pnpm turbo test --filter=api` passes
- [ ] Sanitizer test: synthetic payload with `password:'plaintext'` → assert NOT in stringified output (TS-45)
- [ ] All 11 error codes present (TS-21)
- [ ] vitest.config.ts has `retry:2` (TS-44)
- [ ] Coverage ≥70% for service files

**Read first:** FOUNDATION.md §9.7, `CONTEXT/D-21.md`, `CONTEXT/D-23.md`

---

### Task 28 — Integration tests (MySQL test container): auth flow + audit interceptor + rate-limit

<file-path>apps/api/test/auth.integration.spec.ts, apps/api/test/admin-users.integration.spec.ts, apps/api/test/audit.integration.spec.ts, apps/api/test/setup.integration.spec.ts, apps/api/test/helpers/test-db.ts</file-path>
<goals-covered>TS-01, TS-02, TS-03, TS-04, TS-06, TS-07, TS-08, TS-09, TS-11, TS-12, TS-13, TS-14, TS-15, TS-16, TS-17, TS-18, TS-19, TS-22, TS-23, TS-26, TS-27, TS-29, TS-46, TS-47, TS-48, TS-52</goals-covered>
<estimated-loc>250</estimated-loc>

**Description:** Spin testcontainers MySQL 8 per file (or shared per worker), run migrations, exercise REST endpoints via supertest. Cover: login happy/fail/rate-limit (TS-01/06), change-password tv++ → old JWT 401 (TS-02/17), admin role gating (TS-03/04), user disable revokes (TS-14/15), reset-password (TS-18), audit row creation (TS-07/16/48/52), setup IP gate + race (TS-11/12/13/46/47), CSRF Origin (TS-26/27), trust-proxy + request-id correlation (TS-22/23), validation 422 envelope (TS-29). Use `@faker-js/faker` for fixtures (P01.D-23).

**Acceptance criteria:**
- [ ] All 26 listed TS scenarios pass when `pnpm turbo test:integration --filter=api`
- [ ] Tests use faker (no hardcoded PII) — TS-45 partial
- [ ] Each test resets DB state (migration revert or truncate)
- [ ] Race-condition test (TS-13/47) uses `Promise.allSettled` with 2+ concurrent requests + asserts exactly 1 success

**Read first:** SPECS §Success criteria, `CONTEXT/D-23.md`, all CONTEXT/D-*.md

---

### Task 29 — Playwright E2E (mobile profiles iPhone SE + Galaxy A5x)

<file-path>apps/web/e2e/playwright.config.ts, apps/web/e2e/auth-flow.spec.ts, apps/web/e2e/admin-flow.spec.ts, apps/web/e2e/setup-flow.spec.ts, apps/web/e2e/fixtures/users.ts</file-path>
<goals-covered>TS-32, TS-33, TS-34, TS-35, TS-36, TS-37, TS-38, TS-39, TS-40, TS-41, TS-42</goals-covered>
<estimated-loc>240</estimated-loc>

**Description:** Playwright config (P01.D-20): 2 projects `iPhone SE` + `Galaxy A5x` (`devices['iPhone SE'] + devices['Galaxy A5x'] equivalent` — 360×800 custom). Chromium-only. Tests: login on-blur validation (TS-32/33), 401 re-login modal flow (TS-34/35), VN friendly toast (TS-36), password show/hide (TS-37) + caps-lock (TS-38), setup strength meter (TS-39), iPhone SE viewport render (TS-40), Galaxy A5x table card-stack (TS-41). Manual smoke checklist (TS-42) documented in `apps/web/e2e/MANUAL-SMOKE.md`. Use `getByTestId()` from test_ids declared in FE tasks (vg.config.md test_ids.codegen_priority).

**Acceptance criteria:**
- [ ] `pnpm turbo test:e2e --filter=web` passes both device profiles
- [ ] All TS-32..TS-41 automated; TS-42 manual checklist file exists
- [ ] No `getByText("vietnamese-string")` selectors (i18n-resilient per Rule 10)
- [ ] Retry budget 2 per test (P01.D-21)

**Read first:** `CONTEXT/D-20.md`, `CONTEXT/D-21.md`, vg.config.md test_ids

---

### Task 30 — Migration test CI workflow + idempotent revert

<file-path>.github/workflows/test-migration.yml, apps/api/scripts/test-migration.sh</file-path>
<goals-covered>TS-24, TS-25, TS-43</goals-covered>
<estimated-loc>120</estimated-loc>

**Description:** GitHub Actions workflow (P01.D-11 + P01.D-21): spin MySQL 8 service, checkout, `pnpm install`, `pnpm migration:run` on clean DB → verify schema via SHOW TABLES + DESCRIBE → `pnpm migration:revert` → verify all tables dropped → `pnpm migration:run` again → assert idempotent (no error, schema identical via diff). Job runs on PR + main pushes.

**Acceptance criteria:**
- [ ] Workflow runs successfully on PR (5 tables created — TS-24)
- [ ] revert+rerun is idempotent (TS-25/43)
- [ ] Fail → block deploy (workflow status check required in branch protection — documented in RUNBOOK)

**Read first:** `CONTEXT/D-11.md`, `CONTEXT/D-21.md`

---

### Task 31 — CI pipeline: typecheck + lint + unit + integration + e2e + bundle-size budget

<file-path>.github/workflows/ci.yml, apps/web/scripts/bundle-budget.mjs</file-path>
<goals-covered>TS-24, TS-40, TS-44, TS-45</goals-covered>
<estimated-loc>150</estimated-loc>

**Description:** GitHub Actions on push/PR. Jobs: (a) `typecheck` (`pnpm turbo typecheck`), (b) `lint` (`pnpm turbo lint`), (c) `unit` (`pnpm turbo test:unit`), (d) `integration` (MySQL service container, `pnpm turbo test:integration`), (e) `e2e` (Playwright), (f) `bundle-size`: parse Vite build output, fail if any route gzip > 150KB (F-16 §9.6). Cache pnpm store + Turbo remote cache. Run on Node 20 LTS.

**Acceptance criteria:**
- [ ] All 6 jobs pass on green main
- [ ] Bundle budget check fails when /login route > 150KB gzip (asserts F-16 §9.6 budget)
- [ ] vitest retry:2 honored across CI
- [ ] Job logs include `request_id` correlation per pino structured output

**Read first:** FOUNDATION.md §9.6, vg.config.md build_gates

---

### Task 32 — Pre-commit hook: fixture privacy + .env block + lint-staged

<file-path>.husky/pre-commit, .lintstagedrc.json, scripts/check-fixture-privacy.mjs</file-path>
<goals-covered>TS-45</goals-covered>
<estimated-loc>110</estimated-loc>

**Description:** Husky pre-commit hook per P01.D-23: (a) block any `.env` file staging (allow `.env.example`), (b) check fixtures under `apps/**/e2e/fixtures/` for hardcoded PII patterns (regex emails, phone-like patterns) → require faker.js usage (grep `@faker-js/faker` import in same file), (c) run lint-staged (eslint+prettier on changed TS/TSX). Bypassable only via `--no-verify` (logged to override-debt per vg.config.debt).

**Acceptance criteria:**
- [ ] Commit attempt staging `.env` → blocked with friendly message
- [ ] Fixture with hardcoded email + no faker import → blocked
- [ ] Lint+format auto-fix staged files (TS-45 surface)

**Read first:** `CONTEXT/D-23.md`

---

### Task 33 — Env configuration + secrets template + RUNBOOK

<file-path>.env.example, apps/api/src/common/config/env.schema.ts, RUNBOOK.md</file-path>
<goals-covered>TS-42, TS-49, TS-51</goals-covered>
<estimated-loc>180</estimated-loc>

**Description:** `.env.example` (gitignored real `.env`): `JWT_SECRET`, `SETUP_ALLOWED_IP`, `FE_ORIGIN`, `DB_HOST/PORT/USER/PASSWORD/NAME`, `NODE_ENV`, `LOG_LEVEL`, `COOKIE_DOMAIN`. `env.schema.ts` uses Zod to validate on bootstrap (fail fast if missing). RUNBOOK.md documents: manual smoke checklist (TS-42, P01.D-20), rate-limit reset on VPS restart caveat (TS-51, P01.D-26), audit-async data-loss window on crash (TS-49, P01.D-25), JWT key rotation procedure (Q-P01-02 placeholder), recovery-code lock-out risk (P01.D-04), email link friction note (P01.D-27).

**Acceptance criteria:**
- [ ] Server fails fast with VN-localised error if any env missing
- [ ] `.env.example` covers all required keys
- [ ] RUNBOOK has dedicated sections for TS-42/49/51 procedures
- [ ] FE_ORIGIN consumed by CSRF middleware (Task 12)

**Read first:** `CONTEXT/D-20.md`, `CONTEXT/D-25.md`, `CONTEXT/D-26.md`, `CONTEXT/D-27.md`

---

### Task 34 — Deploy script: rsync + pm2 reload + smoke check

<file-path>scripts/deploy.sh, ecosystem.config.cjs, nginx/orderquanbalun.conf.example</file-path>
<goals-covered>TS-22, TS-28, TS-42</goals-covered>
<estimated-loc>160</estimated-loc>

**Description:** Deploy pipeline (vg.config.md sandbox.deploy.*): `scripts/deploy.sh` runs `git pull && pnpm install && pnpm turbo build && pm2 reload orderquanbalun-api --update-env && curl -sf http://localhost:3000/health` for sandbox/VPS. Rollback: `pm2 stop all && git checkout {prev_sha} && pnpm install && pnpm build && pm2 reload all`. PM2 ecosystem config: 1 instance NestJS, `max_memory_restart: '500M'`, log rotation. Nginx example config: TLS termination + reverse-proxy `/api/*` → :3000 + serve `apps/web/dist` static (P01.D-13 same-origin).

**Acceptance criteria:**
- [ ] Deploy script idempotent (rerun ok)
- [ ] Rollback script restores previous SHA + reloads
- [ ] /health smoke check post-reload succeeds (TS-28)
- [ ] Nginx config has `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` enabling trust-proxy (TS-22)
- [ ] RUNBOOK references manual smoke 5-min checklist (TS-42)

**Read first:** vg.config.md sandbox.deploy block, `CONTEXT/D-13.md`, FOUNDATION.md F-07

---

## Goal coverage (TS-NN proxies for G-XX — TEST-GOALS.md pending)

| TS ID | Source Decision | Tasks covering | Status |
|-------|-----------------|----------------|--------|
| TS-01 | P01.D-01 | Task 9, 10, 20, 21, 28 | Covered |
| TS-02 | P01.D-01 | Task 9, 10, 23, 28 | Covered |
| TS-03 | P01.D-02 | Task 8, 15, 24, 28 | Covered |
| TS-04 | P01.D-02 | Task 8, 15, 20, 24, 26, 28 | Covered |
| TS-05 | P01.D-03 | Task 1, 16, 27 | Covered |
| TS-06 | P01.D-03 | Task 10, 21, 28 | Covered |
| TS-07 | P01.D-03 | Task 13, 28 | Covered |
| TS-08 | P01.D-04 | Task 10, 11, 23, 28 | Covered |
| TS-09 | P01.D-04 | Task 10, 23, 28 | Covered |
| TS-10 | P01.D-04 | Task 1, 11, 27 | Covered |
| TS-11 | P01.D-05 | Task 11, 22, 28 | Covered |
| TS-12 | P01.D-05 | Task 11, 22, 28 | Covered |
| TS-13 | P01.D-05 | Task 1, 11, 22, 28 | Covered |
| TS-14 | P01.D-06 | Task 8, 15, 20, 24, 28 | Covered |
| TS-15 | P01.D-06 | Task 15, 24, 28 | Covered |
| TS-16 | P01.D-07 | Task 13, 14, 25, 28 | Covered |
| TS-17 | P01.D-08 | Task 1, 8, 9, 28 | Covered |
| TS-18 | P01.D-08 | Task 8, 15, 19, 28 | Covered |
| TS-19 | P01.D-08 | Task 8, 15, 28 | Covered |
| TS-20 | P01.D-09 | Task 3, 5, 27 | Covered |
| TS-21 | P01.D-09 | Task 3, 27 | Covered |
| TS-22 | P01.D-10 | Task 4, 13, 28, 34 | Covered |
| TS-23 | P01.D-10 | Task 4, 13, 28 | Covered |
| TS-24 | P01.D-11 | Task 1, 30, 31 | Covered |
| TS-25 | P01.D-11 | Task 1, 30 | Covered |
| TS-26 | P01.D-12 | Task 12, 28 | Covered |
| TS-27 | P01.D-12 | Task 12, 28 | Covered |
| TS-28 | P01.D-13 | Task 6, 34 | Covered |
| TS-29 | P01.D-14 | Task 5, 7, 28 | Covered |
| TS-30 | P01.D-14 | Task 6 | Covered |
| TS-31 | P01.D-15 | Task 5, 10, 27 | Covered |
| TS-32 | P01.D-16 | Task 17, 21, 29 | Covered |
| TS-33 | P01.D-16 | Task 17, 21, 29 | Covered |
| TS-34 | P01.D-17 | Task 18, 19, 29 | Covered |
| TS-35 | P01.D-17 | Task 18, 19, 29 | Covered |
| TS-36 | P01.D-18 | Task 19, 21, 29 | Covered |
| TS-37 | P01.D-19 | Task 18, 21, 29 | Covered |
| TS-38 | P01.D-19 | Task 18, 21, 29 | Covered |
| TS-39 | P01.D-19 | Task 7, 18, 22, 29 | Covered |
| TS-40 | P01.D-20 | Task 21, 26, 29, 31 | Covered |
| TS-41 | P01.D-20 | Task 17, 18, 24, 25, 29 | Covered |
| TS-42 | P01.D-20 | Task 29, 33, 34 | Covered (manual checklist artifact) |
| TS-43 | P01.D-21 | Task 30 | Covered |
| TS-44 | P01.D-21 | Task 1, 27, 31 | Covered |
| TS-45 | P01.D-23 | Task 27, 31, 32 | Covered |
| TS-46 | P01.D-24 | Task 1, 11, 22, 28 | Covered |
| TS-47 | P01.D-24 | Task 11, 28 | Covered |
| TS-48 | P01.D-25 | Task 13, 28 | Covered |
| TS-49 | P01.D-25 | Task 33 | Covered (RUNBOOK manual) |
| TS-50 | P01.D-26 | Task 9, 10, 28 | Covered |
| TS-51 | P01.D-26 | Task 33 | Covered (RUNBOOK manual) |
| TS-52 | P01.D-28 | Task 13, 14, 25, 28 | Covered |

All 52 TS scenarios covered.

## ORG 6-Dimension check

| # | Dimension | Addressed by |
|---|-----------|--------------|
| 1 | **Infra** | Task 1 (DB migrations), Task 16 (cron schedule), Task 34 (pm2 + nginx) |
| 2 | **Env** | Task 33 (.env.example + Zod validation + RUNBOOK); FE_ORIGIN consumed in Task 12; SETUP_ALLOWED_IP consumed in Task 11 |
| 3 | **Deploy** | Task 31 (CI), Task 34 (rsync + pm2 reload script) |
| 4 | **Smoke** | Task 6 (/health), Task 34 (post-deploy curl /health), Task 29 + 33 (manual smoke checklist TS-42) |
| 5 | **Integration** | Task 30 (migration test in CI), Task 28 (integration test suite against MySQL container), Task 34 (nginx reverse-proxy config) |
| 6 | **Rollback** | Task 30 (migration:revert idempotency), Task 34 (rollback script via prev_sha + pm2 reload) |

All 6 dimensions covered.

## Open questions (carried from CONTEXT — flag for /vg:blueprint contract gen)

- **Q-P01-01 — recovery_codes.used_at vs delete on use** → resolved in plan: Task 1 keeps `used_at` column (mark used, never delete) for forensic trail; Task 9 sets `used_at=now()` on successful recover.
- **Q-P01-02 — JWT signature key rotation** → unresolved; Task 33 RUNBOOK has placeholder section documenting current manual swap procedure; full rolling rotation deferred to deploy/ops phase.
- **Q-P01-03 — token_version overflow INT vs BIGINT** → resolved in plan: Task 1 schema uses `BIGINT` for `users.token_version`; Task 2 entity maps BIGINT-safe TS type.

## Notes

- Wave 2 depends on Wave 1 (shared packages + entities).
- Wave 3 depends on Waves 1-2 (entities + filter + middleware + shared codes).
- Wave 4 depends on Wave 3 (AuthGuard for OwnerGuard composition).
- Wave 5 depends on Waves 1-2 (packages/schemas error codes).
- Wave 6 depends on Wave 5 (ui-kit + axios + auth-guard).
- Wave 7 depends on all prior waves (tests + CI + deploy plumbing).
- TEST-GOALS.md will be generated at /vg:blueprint step 2b5 — at that point this PLAN's TS-NN coverage map should be re-mapped to G-NN IDs (1:1 mapping likely).
- design/manifest.json NOT present (phase 01 greenfield) — all FE tasks use `<design-ref>none-greenfield</design-ref>` per Rule 8 Form-B-equivalent for greenfield (gap logged here for review).
- Estimated total LOC: ~6,000 (foundation phase — heavy infrastructure). Each task ≤250 LOC per Rule (Wave grouping rules + task granularity).

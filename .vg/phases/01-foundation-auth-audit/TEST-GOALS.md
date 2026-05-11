---
phase: "01"
created_at: 2026-05-08
goal_count: 28
profile: web-fullstack
source: derived from CONTEXT TS-01..TS-52 + INTERFACE-STANDARDS + SPECS success_criteria
---

# Phase 01 — Test Goals

Each goal maps to ≥ 1 PLAN task + ≥ 1 endpoint (or middleware) + verification strategy.

---

## G-01 — Login happy path

**Endpoints:** E-01 POST /auth/login
**Verification:** automated (integration + E2E)
**Success criteria:**
- POST {username, password} valid → 200 + cookie `ssp_token` with HttpOnly + Secure + SameSite=Strict + Max-Age=604800 (7d)
- Response data.user has `{sub, name, is_owner}`
- GET /auth/me afterwards returns same user info
- audit_log row `auth.login_success` created

**Traces:** TS-01 (CONTEXT.md), AC-C1 (SPECS)

---

## G-02 — Login fail + rate limit

**Endpoints:** E-01
**Verification:** automated integration with faketime
**Success criteria:**
- POST with wrong password → 401 `AUTH_INVALID_CRED`
- audit_log row `auth.login_failed`
- 5 fails in 5min/IP → 6th call 429 `AUTH_RATE_LIMITED` + `Retry-After: 900`
- After 900s → counter resets, next call works

**Traces:** TS-06, AC-C5

---

## G-03 — Logout flow with JTI blacklist

**Endpoints:** E-02 POST /auth/logout
**Verification:** automated integration
**Success criteria:**
- POST /auth/logout → 204 + Set-Cookie clear
- INSERT into `revoked_jwt_jti` with current JTI + expires_at_ms
- Subsequent request with old cookie → 401 `AUTH_TOKEN_REVOKED`
- audit_log `auth.logout`

**Traces:** TS-03 (challenger #1 mitigation via blacklist)

---

## G-04 — Change own password + tv++ + JWT cũ invalidated

**Endpoints:** E-04 POST /auth/change-password
**Verification:** automated integration
**Success criteria:**
- old password correct → 200 + UPDATE password_hash + token_version++
- Old JWT (with stale tv claim) → next request 401 `AUTH_TOKEN_REVOKED`
- New cookie issued with refreshed tv claim
- audit_log `auth.password_changed`
- old password wrong → 401 `OWN_PASSWORD_WRONG`

**Traces:** TS-02, TS-17

---

## G-05 — Owner creates user

**Endpoints:** E-08 POST /admin/users
**Verification:** automated integration
**Success criteria:**
- OwnerGuard accepts is_owner=true caller → 201 + user created
- INSERT users with is_owner=false, is_active=true, token_version=0
- Password hashed bcrypt cost 10
- audit_log `admin.user_created` with after_json containing user metadata (excluding password)
- staff caller → 403 `ADMIN_REQUIRED`

**Traces:** TS-04, TS-07

---

## G-06 — Owner reset staff password

**Endpoints:** E-10 POST /admin/users/:id/reset-password
**Verification:** automated integration
**Success criteria:**
- OwnerGuard accepts → 200 + temp_password returned (12 char random)
- UPDATE password_hash + token_version++
- Staff with old cookie → 401 next request
- audit_log `admin.password_reset` (NO plaintext password in row)

**Traces:** TS-18

---

## G-07 — Owner disable user (immediate revoke)

**Endpoints:** E-11 POST /admin/users/:id/disable
**Verification:** automated integration
**Success criteria:**
- OwnerGuard accepts → 204
- UPDATE users SET is_active=false, token_version++
- Disabled user's current cookie → 401 `AUTH_INACTIVE_USER` next request
- Disabled user attempts /auth/login → 401 `AUTH_INACTIVE_USER`
- audit_log `admin.user_disabled`
- Idempotent: disable twice = same state

**Traces:** TS-14, TS-15, TS-19

---

## G-08 — First owner setup happy path

**Endpoints:** E-06 GET /setup, E-07 POST /setup
**Verification:** automated integration
**Success criteria:**
- DB users empty + req.ip in SETUP_ALLOWED_IP → GET /setup 200
- POST /setup → 201 + owner created (is_owner=true, token_version=0) + 1-time recovery_code returned
- Recovery code displayed plaintext 1× in response, DB stores only bcrypt hash
- audit_log `setup.completed`

**Traces:** TS-11

---

## G-09 — Setup already done

**Endpoints:** E-06, E-07
**Verification:** automated integration
**Success criteria:**
- After G-08, GET /setup → 404
- POST /setup → 409 `SETUP_ALREADY_DONE`

**Traces:** TS-12

---

## G-10 — Setup race condition

**Endpoints:** E-07
**Verification:** automated concurrency (2 parallel POST)
**Success criteria:**
- Send 2 concurrent POST /setup requests
- Exactly 1 owner created (UNIQUE constraint or transactional check)
- The other gets 409 `SETUP_ALREADY_DONE`

**Traces:** TS-13, TS-47

---

## G-11 — Setup unauthorized IP

**Endpoints:** E-06, E-07
**Verification:** automated integration
**Success criteria:**
- req.ip NOT in SETUP_ALLOWED_IP env → 403
- audit_log `setup.blocked.ip`

**Traces:** TS-46

---

## G-12 — Recovery code valid use

**Endpoints:** E-05 POST /auth/recover
**Verification:** automated integration
**Success criteria:**
- POST {code (from G-08), new_password} → 200 + password reset
- UPDATE users password_hash + token_version++
- UPDATE recovery_codes SET used_at = now, code_hash invalidated
- audit_log `auth.recovered`

**Traces:** TS-08

---

## G-13 — Recovery code reuse rejected

**Endpoints:** E-05
**Verification:** automated integration
**Success criteria:**
- After G-12, POST /auth/recover same code → 401 `RECOVERY_CODE_INVALID`

**Traces:** TS-09

---

## G-14 — Recovery code stored as hash only

**Endpoints:** E-07 setup result
**Verification:** automated unit (DB query)
**Success criteria:**
- SELECT code_hash FROM recovery_codes WHERE user_id = <owner>
- Result is bcrypt hash (starts with `$2a$` or `$2b$`)
- Plaintext code MUST NOT appear in DB anywhere

**Traces:** TS-10

---

## G-15 — Audit log immutable

**Endpoints:** none (schema test)
**Verification:** automated unit
**Success criteria:**
- No NestJS controller has UPDATE or DELETE endpoint targeting audit_log
- Schema test: TypeORM entity AuditLog has no @UpdateDateColumn
- (Optional defense) DB user app_writer has GRANT INSERT, SELECT only on audit_log (no UPDATE/DELETE) — document in RUNBOOK

**Traces:** TS-05

---

## G-16 — Audit middleware writes mutation rows

**Endpoints:** any mutation endpoint (E-01, E-08, etc.)
**Verification:** automated integration
**Success criteria:**
- POST /admin/users (G-05) → 1 row in audit_log within 5s (async via EventEmitter per D-25)
- Row contents: actor_id, actor_name, ip, ts_ms, action_kind=`admin.user_created`, target_kind=`user`, target_id=`<new_user_id>`, before_json=null, after_json={sanitized}
- 100 mutations / 1s burst → all rows persisted within 5s post-burst

**Traces:** TS-07, TS-48

---

## G-17 — Audit retention cron

**Endpoints:** none (cron job)
**Verification:** automated integration with faketime
**Success criteria:**
- Insert fake audit_log rows with ts_ms = now - 91 days
- Run `pnpm cron:audit-retention --cutoff-days=90`
- Output: `{deleted_rows: N, cutoff_ts_ms: ...}` JSON
- Rows with ts_ms < cutoff are deleted
- Rows with ts_ms >= cutoff remain

**Traces:** SPECS Success criterion (audit retention)

---

## G-18 — Audit viewer + filter + export CSV

**Endpoints:** E-12 GET /admin/audit, E-13 GET /admin/audit/export.csv
**Verification:** automated integration
**Success criteria:**
- OwnerGuard accepts → 200 with paginated items
- Filter `?actor=&action_kind=&from=&to=` works server-side
- Meta-audit: each call writes audit_log row `audit.viewed` (E-12) or `audit.exported` (E-13)
- CSV response: Content-Type text/csv + Content-Disposition attachment + ≥ 1 row
- staff caller → 403 `ADMIN_REQUIRED`

**Traces:** TS-16, TS-52

---

## G-19 — JWT in cookie HttpOnly (security)

**Endpoints:** E-01 (header check)
**Verification:** automated integration
**Success criteria:**
- After login, response header `Set-Cookie` MUST include: `HttpOnly`, `Secure`, `SameSite=Strict`
- JS-accessible cookie via `document.cookie` MUST NOT return token
- Verified in Playwright E2E by `await page.context().cookies()` filter check

**Traces:** SPECS Success criterion (JWT in cookie)

---

## G-20 — JWT signed correctly + 7d lifetime

**Endpoints:** E-01
**Verification:** automated unit
**Success criteria:**
- jwt.verify(token, JWT_SECRET) succeeds
- payload contains `{sub, name, iat, exp, jti, tv}`
- payload.exp - payload.iat = 7 × 86400 (within 5s tolerance)
- payload does NOT contain email, phone, role, address (PII check)

**Traces:** SPECS Success criterion (JWT correctness)

---

## G-21 — No password leak

**Endpoints:** all
**Verification:** automated grep (CI step)
**Success criteria:**
- grep `password` in response bodies of all integration test runs → no plaintext password
- grep `password_hash` in audit_log before/after JSON → no
- grep `password` in pino log lines (with `_password: '[REDACTED]'`) → only REDACTED format
- Plaintext password MUST NOT appear in any response or log

**Traces:** SPECS Success criterion (no leak)

---

## G-22 — CSRF Origin check

**Endpoints:** E-08, E-10, E-11 (admin mutations)
**Verification:** automated integration
**Success criteria:**
- POST /admin/users with `Origin: https://valid-fe-origin.com` → 200/201
- POST /admin/users with `Origin: https://evil.com` → 403
- Missing Origin header on mutation → 403

**Traces:** TS-26, TS-27

---

## G-23 — Trust proxy + X-Forwarded-For + request_id

**Endpoints:** any
**Verification:** automated integration
**Success criteria:**
- Setup test express server forwarding `X-Forwarded-For: 203.0.113.1`
- NestJS `req.ip` returns `203.0.113.1` (not loopback)
- audit_log row has `ip = 203.0.113.1`
- Response header includes `X-Request-Id: <uuid>`
- Pino log line for same request includes same `request_id`
- 3 sources (response header, log line, audit row) ALL match same request_id

**Traces:** TS-22, TS-23

---

## G-24 — Migration test in CI

**Endpoints:** none (CI gate)
**Verification:** automated CI
**Success criteria:**
- GitHub Action `.github/workflows/test-migration.yml` runs on PR
- Step 1: clone clean MySQL test container
- Step 2: `pnpm migration:run` → 5 tables created
- Step 3: `pnpm migration:revert` → all 5 tables dropped
- Step 4: `pnpm migration:run` again → idempotent
- Fail any step → block merge

**Traces:** TS-24, TS-25, TS-43

---

## G-25 — Mobile responsive (login + admin pages)

**Endpoints:** N/A (frontend)
**Verification:** automated E2E (Playwright Chromium mobile viewport)
**Success criteria:**
- Playwright iPhone SE viewport (375×667): `/login` renders no horizontal scroll
- Playwright Galaxy A5x viewport (360×800): `/admin/audit` table → card-stack layout
- All buttons ≥ 44×44 px (Lighthouse audit + Playwright `boundingBox` assertion)
- Input font-size ≥ 16px (no iOS auto-zoom)

**Traces:** TS-40, TS-41, SPECS mobile criteria

---

## G-26 — Slow-4G TTI < 3s

**Endpoints:** N/A (frontend perf)
**Verification:** automated E2E (Playwright with Network.emulateNetworkConditions Slow-4G)
**Success criteria:**
- Throttle Slow-4G (400 Kbps download, 400ms latency)
- Navigate to `/login` → Time-to-Interactive measured via web-vitals < 3000ms
- Bundle size of /login route ≤ 150KB gzip (measured via lighthouse-ci or rollup-plugin-visualizer)

**Traces:** SPECS mobile network criterion

---

## G-27 — Friendly VN error tone + re-login modal

**Endpoints:** E-01, E-04 (UI flow)
**Verification:** automated E2E
**Success criteria:**
- Login fail → toast displays VN-friendly message ("Ôi, sai mật khẩu rồi. Thử lại nhé!"), NOT "401 Unauthorized"
- JWT expire mid-action → axios 401 → re-login modal appears (current page state preserved)
- Modal username read-only, password input
- Successful re-login → original request retried → no redirect to /login
- Form validation: on-blur → inline error below field; submit invalid → all errors shown
- Password input: eye-icon toggle works; caps-lock warning detect
- /setup page: zxcvbn strength meter renders + warns on weak password

**Traces:** TS-32, TS-33, TS-34, TS-35, TS-36, TS-37, TS-38, TS-39

---

## G-28 — Test data privacy + pre-commit hook

**Endpoints:** N/A (CI gate)
**Verification:** automated CI
**Success criteria:**
- All test fixtures use `@faker-js/faker` for usernames/emails (grep check: no `nguyen.van.a@gmail.com` style real data)
- `.env.test` file gitignored and separate from `.env`
- Pre-commit hook (.husky or lefthook) blocks commits containing `.env` files
- Pre-commit hook scans staged fixtures for non-faker emails (basic regex)

**Traces:** TS-45

---

## Goal-to-PLAN-task mapping

Downstream `/vg:build` will use this to resolve `<goals-covered>` in PLAN.md:

| Goal | Plan task(s) likely | Wave |
|---|---|---|
| G-01..G-04 | auth module (login, logout, me, change-password) | 2 |
| G-05..G-07 | admin/users module | 4 |
| G-08..G-14 | setup + recover + recovery_codes | 2 |
| G-15..G-18 | audit module + viewer + cron | 3 |
| G-19..G-21 | shared security middleware | 1 |
| G-22..G-23 | CSRF + trust-proxy + request_id middleware | 1 |
| G-24 | CI workflow | 7 |
| G-25..G-27 | FE pages + components | 5, 6 |
| G-28 | CI pre-commit hook | 7 |

---

## Verification strategy summary

| Strategy | Count | Notes |
|---|---|---|
| automated unit | 4 (G-14, G-15, G-20, G-21) | vitest, no DB |
| automated integration | 17 | vitest + MySQL test container |
| automated E2E | 4 (G-25, G-26, G-27, G-19) | Playwright Chromium mobile profiles |
| automated CI | 3 (G-24, G-28, G-21 partial) | GitHub Actions |
| manual smoke | 0 (deferred per D-20 — real-device manual checklist in RUNBOOK) | accept-phase responsibility |

Coverage gate (FOUNDATION §9.7): 70% lines threshold.

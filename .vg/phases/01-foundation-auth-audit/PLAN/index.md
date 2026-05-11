# Phase 01 PLAN — Per-Task Index

Source: `../PLAN.md` (7 waves, 34 tasks).
Use `vg-load PLAN/T-NN.md` for per-task narrow context loading.

| Task | Wave | Title | LOC | Primary TS coverage |
|------|------|-------|-----|---------------------|
| T-01 | 1 | DB migrations: 5 core entities + indexes | 220 | TS-05, 08, 10, 13, 17, 22, 24, 44, 46 |
| T-02 | 1 | TypeORM entities (User/AuditLog/RevokedJwtJti/RecoveryCode/SetupStatus) | 180 | TS-05, 08, 10, 17 |
| T-03 | 1 | Shared error-code enum + envelope schema (packages/schemas) | 140 | TS-20, 21 |
| T-04 | 2 | NestJS bootstrap: trust proxy + pino + request_id | 150 | TS-22, 23 |
| T-05 | 2 | Global ExceptionFilter → error envelope | 180 | TS-20, 29, 31 |
| T-06 | 2 | /health endpoint + Swagger setup | 90 | TS-28, 30 |
| T-07 | 3 | Auth DTOs + class-validator | 110 | TS-29, 39 |
| T-08 | 3 | JwtAuthGuard + tv check + JTI blacklist + OwnerGuard | 200 | TS-03, 04, 14, 17, 18, 19 |
| T-09 | 3 | AuthService: login + password verify + JWT issue | 240 | TS-01, 02, 06, 50 |
| T-10 | 3 | AuthController: 4 endpoints + rate-limit + cookie | 230 | TS-01, 02, 06, 08, 09, 31, 50 |
| T-11 | 3 | SetupModule: /setup endpoints with IP gate + recovery code | 240 | TS-11, 12, 13, 46, 47 |
| T-12 | 3 | CSRF Origin/Referer middleware | 110 | TS-26, 27 |
| T-13 | 4 | AuditInterceptor (async event emit) + write handler | 240 | TS-07, 16, 22, 23, 48, 52 |
| T-14 | 4 | Audit viewer endpoints (list + CSV export) | 220 | TS-16, 52 |
| T-15 | 4 | Admin users module (CRUD + reset + disable) | 240 | TS-03, 04, 14, 15, 18, 19 |
| T-16 | 4 | Cron jobs: audit 90d retention + JTI cleanup | 140 | TS-05, 44 |
| T-17 | 5 | packages/ui-kit primitives (Button/Input/Form/Modal/Toast/...) | 240 | TS-32, 33, 40, 41 |
| T-18 | 5 | packages/ui-kit advanced (PasswordInput/StrengthMeter/Table/ErrorBoundary/ReLoginModal) | 240 | TS-34, 35, 37, 38, 39, 41 |
| T-19 | 5 | FE axios client + 401 re-login interceptor + i18n VN errors | 200 | TS-18, 34, 35, 36 |
| T-20 | 5 | Auth-guard HOC + useAuth + router skeleton | 180 | TS-01, 03, 04, 14 |
| T-21 | 6 | Login page (mobile-first + on-blur + VN errors) | 220 | TS-01, 06, 32, 33, 36, 37, 38, 40 |
| T-22 | 6 | Setup wizard + recovery-code display | 200 | TS-11, 12, 13, 39, 46 |
| T-23 | 6 | Recover + change-password pages | 180 | TS-02, 08, 09 |
| T-24 | 6 | Admin users list + create + reset + disable UI | 240 | TS-03, 04, 14, 15, 41 |
| T-25 | 6 | Admin audit viewer + filter + CSV export | 230 | TS-16, 41, 52 |
| T-26 | 6 | Dashboard placeholder + logout + bottom nav | 130 | TS-04, 40 |
| T-27 | 7 | Vitest unit tests (auth service + error codes + sanitizer) | 240 | TS-05, 10, 20, 21, 31, 44, 45 |
| T-28 | 7 | Integration tests (MySQL container) | 250 | TS-01..04, 06..09, 11..19, 22, 23, 26, 27, 29, 46..48, 52 |
| T-29 | 7 | Playwright E2E (iPhone SE + Galaxy A5x) | 240 | TS-32..42 |
| T-30 | 7 | Migration test CI workflow + idempotent revert | 120 | TS-24, 25, 43 |
| T-31 | 7 | CI pipeline: typecheck/lint/unit/integration/e2e + bundle budget | 150 | TS-24, 40, 44, 45 |
| T-32 | 7 | Pre-commit hook: fixture privacy + .env block + lint-staged | 110 | TS-45 |
| T-33 | 7 | Env config + secrets template + RUNBOOK | 180 | TS-42, 49, 51 |
| T-34 | 7 | Deploy script (rsync + pm2 reload + smoke) | 160 | TS-22, 28, 42 |

**Totals:** 34 tasks across 7 waves. Sum of LOC estimates: ~6,300.

Reference parent: `../PLAN.md`. Each `T-NN.md` file mirrors that task block verbatim for narrow context loading.

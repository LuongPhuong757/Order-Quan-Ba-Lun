# TEST-STRATEGY — Phase 01 Foundation & Auth Infrastructure

Generated: 2026-05-08
Source: derived from CONTEXT.md decisions D-20..D-23 + SPECS Success Criteria
Pipeline next: /vg:blueprint will refine into TEST-GOALS.md

## Test Pyramid (per D-20, F-11 Solo dev pragmatic)

| Level | Framework | % effort | Coverage |
|---|---|---|---|
| Unit | Vitest (FE + BE) | 40% | service logic, utils, validators, error envelope |
| Integration | Vitest + MySQL test container | 30% | controller + DB end-to-end, audit middleware |
| E2E | Playwright Chromium emulation (iPhone SE 375×667 + Galaxy A5x 360×800) | 20% | login flow, admin UI, mobile responsive |
| Smoke | Playwright headless | 10% | post-deploy sanity (login + admin works) |

Coverage threshold: 70% lines (F-11 Solo dev practical baseline per FOUNDATION §9.7).

## Critical Test Categories

### Auth (8 scenarios)
- TS-01: Login happy path → cookie set + /auth/me works
- TS-02: Change password → tv++ + old JWT 401
- TS-04: Owner /admin/* → 200
- TS-03: Staff /admin/* → 403 ADMIN_REQUIRED
- TS-06: Rate-limit 5 fail/5min → 429 + Retry-After
- TS-17, TS-18, TS-19: token_version revocation chain (change-pwd / admin-reset / disable)

### Setup & Recovery (6 scenarios)
- TS-08: /recover valid code → password reset + tv++
- TS-09: /recover used code → 401 RECOVERY_CODE_INVALID
- TS-10: recovery code stored as bcrypt hash (no plaintext in DB)
- TS-11: /setup empty DB + IP whitelisted → render
- TS-12: /setup after owner exists → 404
- TS-13: /setup race 2 concurrent → exactly 1 owner
- TS-46: /setup unauthorized IP → 403
- TS-47: /setup race ditto

### Audit (5 scenarios)
- TS-05: schema test no UPDATE/DELETE on audit_log
- TS-07: BR-7 mutation auto-creates audit_log
- TS-16: GET /admin/audit → meta-audit "audit.viewed" row
- TS-48: 100 mutations / 1s → all rows persisted within 5s (async)
- TS-52: filter params captured in audit_log.before_json

### UI Mobile (8 scenarios)
- TS-32, TS-33: form on-blur + submit validation
- TS-34, TS-35: re-login modal preserves state
- TS-36: friendly VN error tone
- TS-37, TS-38, TS-39: password show/hide + caps-lock + zxcvbn meter
- TS-40, TS-41: Playwright iPhone SE + Galaxy mobile viewport
- TS-42: manual smoke checklist (RUNBOOK)

### Performance (3 scenarios)
- Login p95 < 500ms (bcrypt cost 10 = 80-150ms typical)
- /auth/me p95 < 250ms (whoami + JWT verify)
- TTI < 3s on Slow-4G (FE bundle ≤ 150KB gzip)

### Security (4 scenarios)
- DAST: ZAP active scan (Phase 01 risk profile = moderate)
- TS-26, TS-27: CSRF Origin check on /admin/*
- No password leak in response/log/audit (grep coverage test)
- No PII in JWT payload (decode + assert)

### Integration (3 scenarios)
- TS-24: migration:run on clean DB → 5 tables
- TS-25, TS-43: rollback drill (run → revert → run idempotent)
- TS-44: vitest config retries:2 + @flaky tag policy

### Privacy (1 scenario)
- TS-45: pre-commit hook reject .env commits + fixture only faker data

## Fixture Strategy (per D-23)

- Test DB fresh per test file (TypeORM `synchronize: true` for test env).
- Seed: 1 owner + 2 staff + 10 audit log rows.
- Faker.js for all PII fields (no real names/emails).
- `.env.test` separate from `.env` (gitignored, isolated).
- NO mock DB — integration uses MySQL test container.
- MSW for FE unit tests (axios/fetch wrapper).

## CI Runtime Budget

- Unit + Integration: < 3 phút (per F-13 budget)
- E2E: < 5 phút
- Smoke: < 1 phút

## Open Tests Deferred to Milestone 2

- Load test (D-22): k6 100 user/s login
- Real-device E2E: BrowserStack / Sauce Labs (~$30/mo vượt F-13)
- Mutation testing: Stryker
- Visual regression: Playwright screenshot baseline
- Accessibility extensive: axe-core full WCAG AAA

## Status

DRAFT — sẽ được /vg:blueprint refine thành `TEST-GOALS.md` per-task với verification_strategy explicit (automated|manual|fixture|faketime).

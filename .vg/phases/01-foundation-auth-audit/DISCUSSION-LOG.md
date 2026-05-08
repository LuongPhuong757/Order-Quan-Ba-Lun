# DISCUSSION-LOG — Phase 01 Foundation & Auth Infrastructure

Generated: 2026-05-08
Source: /vg:scope structured discussion (5 rounds + Deep Probe)
Run ID: 8c54ef30-bcfd-45da-9994-8b8bb6d0a075

---

## round-1: Domain & Business

**AI pre-fill:** 5 user stories, 2 roles (owner/staff), 7 business rules.
**User answer:** "OK — proceed Round 2" (rubber-stamp AI draft).

### round-1-challenger-1

**Mode:** USER-CONFIRMED-DRAFT (v2.6 anti-lazy strict review)
**Verdict:** has_issue=true, kind=security
**Evidence:** US-04 đổi password không revoke JWT cũ. Cookie 7d HttpOnly + JTI blacklist chỉ trigger khi logout (BR-4). Attacker đã steal cookie trước đó vẫn login được tới 7 ngày dù user đã đổi pass.
**Follow-up:** Khi user đổi password (US-04), có bump password_version/token_version để invalidate hết JWT cũ không?
**Proposed alternative:** Thêm cột users.token_version (int). JWT payload chứa tv claim. Middleware verify tv khớp DB.
**User choice:** **Defer** — quyết sau, chấp nhận 7d window phase 1 (sẽ revisit ở R2 challenger #1 khi gặp inconsistency với offboarding).

### round-1-expander-1

**Verdict:** 12 dimensions, 5 addressed, 7 missing — 4 CRITICAL.
**Critical missing dimensions raised:**
- C-1: Owner self-recovery (forgot password)
- C-2: First owner bootstrap / seed
- C-3: Offboarding / staff deactivation
- C-4: Audit log access logging (meta-audit)
**Nice-to-have raised:** review cadence, login UX ngôn ngữ, failed-login alerting.

**User resolutions:**
- C-1 → Recovery code 1-time at /setup, hiển thị 1 lần để owner save (D-04)
- C-2 → Web UI /setup screen lần đầu (D-05)
- C-3 → Disable + revoke immediate (implies tv mechanism — see R2 challenger) (D-06)
- C-4 → Log audit access (audit.viewed / audit.exported events) (D-07, refined D-28)

### round-1-deep-probe-1

**Probe:** Recovery code storage in DB?
**User choice:** Hash bcrypt + show plaintext 1 lần lúc /setup. (D-04 refined)

### round-1-deep-probe-2

**Probe:** Setup wizard exposure: KHÔNG ai được truy cập /setup sau khi owner đã tạo?
**User choice:** DB-empty check + first-deploy IP whitelist (SETUP_ALLOWED_IP env). (D-24)

### round-1-deep-probe-3

**Probe:** Audit log dưới tải: sync (block response) hay async (queue)?
**User choice:** Async (EventEmitter / setImmediate). (D-25)

### round-1-deep-probe-4

**Probe:** Rate-limit data store?
**User choice:** In-memory (@nestjs/throttler default). (D-26)

### round-1-deep-probe-5

**Probe:** Cookie SameSite=Strict + email link friction?
**User choice:** Chấp nhận friction, redirect /login (document trong RUNBOOK). (D-27)

---

## round-2: Technical Architecture

**AI pre-fill:** auth flow, authz model, failure recovery, observability, deployment, data storage, cache, secrets — mostly drawn from FOUNDATION §9.1-9.7 + SPECS.
**User answer:** "OK — proceed Round 3" (rubber-stamp AI draft).

### round-2-challenger-1

**Mode:** USER-CONFIRMED-DRAFT
**Verdict:** has_issue=true, kind=inconsistency_password_change_vs_offboarding_revocation
**Evidence:** Draft defers JWT revocation on password-change, yet R1 C-3 mandates immediate revocation on user disable. Both need the same mechanism (token_version column or bulk JTI blacklist). Deferring one but not the other means you'll build it twice or ship offboarding with a half-baked hack.
**Follow-up:** Tại sao cùng cơ chế revoke lại defer cho đổi pass nhưng bắt buộc immediate cho disable user? Sao không gộp lại để đóng cả 2 use case?
**Proposed alternative:** Thêm cột users.token_version INT default 0. JWT payload có tv claim. JwtAuthGuard so JWT.tv với users.token_version — mismatch = 401. Password-change VÀ disable-user đều tv++.
**User choice:** **Address** — gộp (D-08 token_version mechanism). Reverses R1 challenger #1 defer decision.

### round-2-expander-1

**Verdict:** 12 dim, 3 addressed, 9 missing — 4 CRITICAL.
**Critical:**
- error taxonomy / response shape
- reverse proxy header trust (X-Forwarded-For)
- request_id / correlation_id propagation
- migration test in CI / pre-deploy

**User resolutions:**
- Error envelope + code enum (D-09)
- Trust proxy + request_id correlation (D-10)
- Migration test in CI (D-11)

---

## round-3: API Contracts

**AI pre-fill:** 13 endpoints + envelope + error enum + pagination + idempotency + rate-limit policy + versioning defer.
**User answer:** "OK — proceed Round 4".

### round-3-challenger: SKIPPED (loop guard 3/3 — saving for R5 test strategy)

### round-3-expander-1

**Verdict:** 18 dim, 5 addressed, 13 missing — 4 CRITICAL.
**Critical:**
- CSRF protection cho /admin/* (cookie auth = CSRF risk)
- CORS preflight policy (FE same-domain or sub-domain?)
- OpenAPI contract + class-validator field-level validation
- HTTP status code conventions

**User resolutions:**
- CSRF: SameSite=Strict + Origin check middleware (D-12)
- CORS: same-domain (no CORS config needed) (D-13)
- OpenAPI: @nestjs/swagger + class-validator DTOs, /api/docs dev-only (D-14)
- HTTP status codes: locked mapping (200/201/204/400/401/403/422/429) (D-15)

---

## round-4: UI / UX (mobile-first)

**AI pre-fill:** 7 pages, 10+ shared components, state machine (loading/empty/error/success), nav (header + bottom-nav mobile / sidebar desktop), accessibility WCAG AA basic, i18n vi-only, PWA manifest+SW.
**User answer:** "OK — proceed Round 5".

### round-4-challenger: SKIPPED (loop guard preserved)

### round-4-expander-1

**Verdict:** 21 dim, 9 addressed, 12 missing — 4 CRITICAL.
**Critical:**
- form validation UX (when validate?)
- session expiry UX (JWT 7d expires mid-action)
- error message tone (technical vs friendly)
- password input UX (show/hide, strength meter)

**User resolutions:**
- Validate on-blur + inline error (D-16)
- Re-login modal preserves state (D-17)
- Friendly VN error messages (D-18)
- Show/hide + zxcvbn strength meter @ /setup (D-19)

---

## round-5: Test Strategy

**AI pre-fill:** 4-level pyramid (40 unit / 30 integration / 20 E2E / 10 smoke), ~30 critical scenarios, fixture strategy, CI runtime budget.
**User answer:** "OK — proceed Deep Probe".

### round-5-challenger-1

**Mode:** USER-CONFIRMED-DRAFT
**Verdict:** has_issue=true, kind=infeasible_e2e_device_strategy
**Evidence:** Draft specifies Playwright mobile profiles "iPhone SE + Galaxy A5x" but F-11 solo dev + F-13 bootstrapped budget. Real devices need device farm ($), CI mobile runners are emulator-only. Playwright "devices" presets are just viewport+UA emulation in Chromium — NOT real Safari/Samsung Internet.
**Follow-up:** E2E mobile testing chạy ở đâu cụ thể? (a) Playwright Chromium emulation local + GitHub Actions free, accept không catch Safari/iOS bugs; (b) BrowserStack ~$30/mo; (c) Bỏ E2E mobile.
**Proposed alternative:** (a) Playwright Chromium mobile viewport local + CI, document giới hạn, manual smoke 5 phút iPhone thật trước release.
**User choice:** **Address (a)** — Playwright Chromium emulation + manual smoke (D-20).

### round-5-expander-1

**Verdict:** 22 dim, 10 addressed, 12 missing — 4 CRITICAL.
**Critical:**
- rollback drill (migration:revert tested)
- flaky test budget (max retries + quarantine)
- load test (k6/artillery for login concurrency)
- test data privacy (faker, no prod dump)

**User resolutions:**
- Rollback drill + flaky budget (max 2 retries, @flaky tag) (D-21)
- Load test deferred to Milestone 2 (D-22)
- Test data privacy rules (faker, .env.test isolation) (D-23)

---

## Summary

- **Total decisions:** 28 (P01.D-01 → P01.D-28)
- **Challenger spawns:** 3 (R1, R2, R5) — loop guard reached, R3+R4 skipped per spec
- **Expander spawns:** 5 (R1-R5) — every round end as mandatory
- **Deep Probe rounds:** 5 (P-1 to P-5)
- **Open questions:** 3 (Q-P01-01 recovery code retention, Q-P01-02 JWT key rotation, Q-P01-03 token_version overflow type)
- **Acknowledged tradeoffs:** 6 (no RBAC, async audit, Chromium-only E2E, in-memory rate-limit, email link friction, recovery code lock-out risk)

## Cross-reference Index

- D-04, D-05, D-24 form recovery+setup chain
- D-06, D-08, D-17 form revocation+session-expiry chain
- D-09, D-10, D-15 form error+observability chain
- D-12, D-13 form CSRF+CORS pair
- D-20, D-21, D-23 form testing infrastructure trio

## Pipeline next-step pointer

Pipeline kế tiếp: `/vg:blueprint 01` — tiêu thụ CONTEXT.md per decision via `vg-load --phase 01 --artifact context --decision D-NN`. PLAN.md + API-CONTRACTS.md + TEST-GOALS.md sẽ được sinh ra ở đó (NOT ở scope — rule 4).

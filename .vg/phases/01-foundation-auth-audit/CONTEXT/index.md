# CONTEXT decisions index

Total: 28 decisions

- [D-01](D-01.md) — User stories cho Phase 01
- [D-02](D-02.md) — Roles owner / staff (no fine-grained RBAC)
- [D-03](D-03.md) — Business rules BR-1..7
- [D-04](D-04.md) — Owner self-recovery via 1-time recovery code
- [D-05](D-05.md) — First owner bootstrap qua web UI /setup
- [D-06](D-06.md) — Offboarding immediate revoke (disable user)
- [D-07](D-07.md) — Meta-audit (log audit log access)
- [D-08](D-08.md) — Token version mechanism (gộp revocation password-change + offboarding)
- [D-09](D-09.md) — Error response envelope + code enum
- [D-10](D-10.md) — Trust proxy + request_id correlation
- [D-11](D-11.md) — Migration test in CI before deploy
- [D-12](D-12.md) — CSRF protection cho /admin/* mutations
- [D-13](D-13.md) — CORS = same-domain (no CORS config needed)
- [D-14](D-14.md) — OpenAPI spec + class-validator DTOs
- [D-15](D-15.md) — HTTP status code conventions
- [D-16](D-16.md) — Form validation UX = on-blur + inline error
- [D-17](D-17.md) — Session expiry UX = re-login modal preserves state
- [D-18](D-18.md) — Error message tone = friendly VN
- [D-19](D-19.md) — Password input UX = show/hide + zxcvbn meter ở /setup
- [D-20](D-20.md) — E2E mobile = Playwright Chromium emulation + manual smoke
- [D-21](D-21.md) — Rollback drill + flaky test budget
- [D-22](D-22.md) — Load test deferred to Milestone 2
- [D-23](D-23.md) — Test data privacy rules
- [D-24](D-24.md) — Setup wizard exposure guard (race + lock-out)
- [D-25](D-25.md) — Audit log async (EventEmitter / setImmediate)
- [D-26](D-26.md) — Rate limit data store = in-memory (@nestjs/throttler default)
- [D-27](D-27.md) — Email link friction acceptance
- [D-28](D-28.md) — Audit log access logging implementation detail

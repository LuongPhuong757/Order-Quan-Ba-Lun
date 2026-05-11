# TEST-GOALS index

Total: 28 goals

- [G-01](G-01.md) — Login happy path
- [G-02](G-02.md) — Login fail + rate limit
- [G-03](G-03.md) — Logout flow with JTI blacklist
- [G-04](G-04.md) — Change own password + tv++ + JWT cũ invalidated
- [G-05](G-05.md) — Owner creates user
- [G-06](G-06.md) — Owner reset staff password
- [G-07](G-07.md) — Owner disable user (immediate revoke)
- [G-08](G-08.md) — First owner setup happy path
- [G-09](G-09.md) — Setup already done
- [G-10](G-10.md) — Setup race condition
- [G-11](G-11.md) — Setup unauthorized IP
- [G-12](G-12.md) — Recovery code valid use
- [G-13](G-13.md) — Recovery code reuse rejected
- [G-14](G-14.md) — Recovery code stored as hash only
- [G-15](G-15.md) — Audit log immutable
- [G-16](G-16.md) — Audit middleware writes mutation rows
- [G-17](G-17.md) — Audit retention cron
- [G-18](G-18.md) — Audit viewer + filter + export CSV
- [G-19](G-19.md) — JWT in cookie HttpOnly (security)
- [G-20](G-20.md) — JWT signed correctly + 7d lifetime
- [G-21](G-21.md) — No password leak
- [G-22](G-22.md) — CSRF Origin check
- [G-23](G-23.md) — Trust proxy + X-Forwarded-For + request_id
- [G-24](G-24.md) — Migration test in CI
- [G-25](G-25.md) — Mobile responsive (login + admin pages)
- [G-26](G-26.md) — Slow-4G TTI < 3s
- [G-27](G-27.md) — Friendly VN error tone + re-login modal
- [G-28](G-28.md) — Test data privacy + pre-commit hook

### Task 12 — Local production-mode verification script: routing matrix + bundle isolation + turbo
<!-- vg-binding: SPECS:success-criteria -->
<wave>5</wave>
<implements-decision>M2.D-66</implements-decision>
<implements-decision>M2.D-64</implements-decision>
<file-path>scripts/verify-phase07-routing.sh</file-path>
<goals-covered>G-01,G-02,G-07,G-08,G-09</goals-covered>
<estimated-loc>190</estimated-loc>

Covers goal: G-01, G-02, G-07, G-08, G-09

**Description:** The four infra bugs this phase fixes are all **production-only** — local dev
passes even when production is broken (that is exactly how F2 slipped through). This script
reproduces production mode on this machine (`NODE_ENV=production` + both dists staged next to the
API) and asserts the `(Host, path, Accept)` routing table, so the phase can be verified without
touching the VPS. Repo has zero test files and no vitest config, so a shell harness is the
honest deliverable here (see `## Risks`).

**Read first:** `apps/api/src/main.ts` (post-Task-08), `Dockerfile:69` (the `web-dist` /
`shop-dist` layout the script must reproduce), `docker-compose.yml` (local mysql service),
`.vg/phases/08-public-menu-checkout/CONTEXT.md` § P08.D-60 (the "routing table in production
mode" test that phase 08 expects to inherit).

**Steps:**
1. `#!/usr/bin/env bash`, `set -euo pipefail`, `cd` to repo root via
   `cd "$(dirname "$0")/.."`. A `pass()/fail()` pair increments counters and the script exits 1
   if any check failed (so it is CI-usable later).
2. Preamble comment stating the hard constraint: **this script never touches the VPS** — no
   `deploy.sh`, no `ssh`, no `git push`, no `docker compose -f docker-compose.prod.yml`.
3. Toolchain note + guard: drive pnpm through `corepack pnpm` (global pnpm on this machine wants
   Node ≥ 22.13 while the active runtime is Node v20.11.0; `package.json` pins `pnpm@9.0.0`).
4. Start local MySQL (`docker compose up -d mysql` from the **dev** `docker-compose.yml`), poll
   `docker inspect` health until healthy, max 60s.
5. Build: `corepack pnpm build` (turbo → schemas, utils, api, web, shop).
6. Stage dists exactly like the image does:
   `rm -rf apps/api/web-dist apps/api/shop-dist && cp -R apps/web/dist apps/api/web-dist &&
   cp -R apps/shop/dist apps/api/shop-dist`.
7. Boot the API in production mode on port 3099 with the 3-origin `ALLOWED_ORIGIN`, capture the
   PID, `trap` cleanup (kill API, `docker compose stop mysql` optional), poll
   `/api/public/health` until 200 or 30s timeout.
8. Assert the routing matrix (each row = one `pass`/`fail` line):

   | # | Request | Expect |
   |---|---|---|
   | 1 | `Host: order.quanbalun.site`, `GET /`, `Accept: text/html` | shop `<title>` |
   | 2 | `Host: quanbalun.site`, `GET /`, `Accept: text/html` | POS `<title>` |
   | 3 | `Host: www.quanbalun.site`, `GET /`, `Accept: text/html` | POS `<title>` |
   | 4 | `GET /api/public/health`, `Accept: text/html` | 200 + body starts `{` + `"ok":true` (G-09) |
   | 5 | `GET /api/public/health`, `Accept: application/json` | 200 + `"ok":true` |
   | 6 | `Host: order.…`, `GET /api/public/health`, `Accept: text/html` | 200 JSON (host does not matter for `/api/*`) |
   | 7 | `Host: quanbalun.site`, `GET /orders`, `Accept: text/html` | POS `<title>` (POS reload, G-07) |
   | 8 | `GET /orders`, `Accept: application/json` | JSON (401/200), `content-type: application/json` |
   | 8a | `Host: quanbalun.site`, `GET /kitchen`, `Accept: text/html` | POS `<title>` (thêm sau CrossAI finding #3) |
   | 8b | `Host: quanbalun.site`, `GET /dashboard`, `Accept: text/html` | POS `<title>` (thêm sau CrossAI finding #3) |
   | 8c | `Host: quanbalun.site`, `GET /admin/`, `Accept: text/html` | POS `<title>` (thêm sau CrossAI finding #3) |
   | 9 | `GET /health` | JSON, unchanged keys `status,db,uptime_s,version` |
   | 10 | `Host: order.…`, `GET /<shop hashed asset>` | 200, `content-type` javascript |
   | 11 | `Host: quanbalun.site`, same shop asset path | 404 (roots separate) |
   | 12 | `GET /uploads/menu/nope.jpg` | 404, body not HTML |
   | 13 | `Host: order.…`, `GET /cart`, `Accept: text/html` | shop `<title>` (SPA fallback per host) |
   The shop asset path for rows 10–11 is discovered with
   `basename $(ls apps/shop/dist/assets/*.js | head -1)`.
9. Bundle isolation (G-02): `grep -rE '/dashboard|/kitchen' apps/shop/dist/assets/*.js` must find
   nothing; also assert no `axios`/`xlsx` marker strings.
10. Bundle budget (F-16): every JS asset gzipped ≤ 153600 bytes; print actual sizes.
11. Turbo/dist isolation (G-08): assert `apps/web/dist/index.html` and
    `apps/shop/dist/index.html` differ; run `corepack pnpm build` a second time and assert the
    output mentions cache hits and that neither dist's `index.html` mtime/hash changed.
12. Print a final summary block listing each G-XX touched and PASS/FAIL, then exit non-zero on
    any failure. End with an explicit reminder that G-03, G-05, G-06 and the on-the-wire part of
    G-11 are DEFERRED to `DEFERRED-VPS-CHECKS.md`.
13. POS manual smoke checklist (G-07) printed at the end as instructions, not automated:
    `corepack pnpm dev` → login, table map, kitchen page, payment flow. The repo has no Playwright
    setup, so this stays a human check on localhost.

**Acceptance criteria:**
- [ ] `bash scripts/verify-phase07-routing.sh` runs end-to-end on this machine with no VPS access
      and exits 0 after Tasks 01–11.
- [ ] All 13 matrix rows print PASS, each with the observed value (not just "ok").
- [ ] The script fails loudly (exit 1) if `apps/api/shop-dist` is missing or the API does not boot.
- [ ] Killing the script mid-run leaves no orphan `node dist/main.js` (trap works).
- [ ] The script contains no `ssh`, no `deploy.sh`, no `git push`, no `docker-compose.prod.yml`
      reference — grep-provable.
- [ ] Re-running the script twice in a row gives the same result (idempotent staging).

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
bash scripts/verify-phase07-routing.sh ; echo "exit=$?"
grep -nE 'ssh |deploy\.sh|git push|docker-compose\.prod' scripts/verify-phase07-routing.sh \
  && echo 'FAIL: script touches production' || echo 'OK: local-only'
pgrep -fl 'node dist/main.js' || echo 'OK: no orphan api process'
```

---
phase: "07"
phase_name: "Hạ tầng trang khách"
profile: infra
platform: web-fullstack
goal_summary: "Dựng apps/shop trên order.<domain> dùng chung 1 API/DB + vá 4 lỗi hạ tầng (SPA nuốt /api, CSRF startsWith, static 1 root, Dockerfile thiếu package) — verify local, KHÔNG deploy."
total_waves: 6
total_tasks: 14
generated_at: "2026-07-29T09:13:20Z"
blueprint_version: "v1"
---

# Phase 07 — Plan (Hạ tầng trang khách)

> **Sources.** `SPECS.md` (12 success criteria, incl. the 2026-07-29 amendment F2/F4/F5/F6) ·
> `CONTEXT.md` (intentional stub — profile `infra` short-circuits `/vg:scope`, so this plan cites
> the milestone decisions **M2.D-64 … M2.D-69** from
> `.vg/MILESTONE-02-ONLINE-ORDERING-SPEC.md` § Vòng 5 instead of `P07.D-XX`) ·
> `INTERFACE-STANDARDS.md` (API success/error envelope + FE message priority) ·
> `FOUNDATION.md` §9 (architecture lock) ·
> `.vg/phases/08-public-menu-checkout/CONTEXT.md` § P08.D-59 (only `packages/utils` is created —
> `packages/ui` was DROPPED).
>
> **Hard constraint — KHÔNG DEPLOY (P08.D-72).** No task runs `./deploy.sh`, `git push`, `ssh`, or
> `docker compose -f docker-compose.prod.yml`. Local `docker build` and the **dev**
> `docker-compose.yml` mysql service are used for verification only. The `order.<domain>` DNS A
> record is a manual owner action (Task 14).
>
> **Goal IDs.** This phase has no `TEST-GOALS.md` (profile `infra`). `G-01 … G-12` are the
> `SPECS.md` `## Success criteria` checkboxes numbered in the order they appear.

## Goals (G-01 … G-12 = SPECS success criteria, in order)

| Goal | Criterion (short) | Source | Local verifiable |
|------|-------------------|--------|------------------|
| G-01 | `order.<domain>` → `shop-dist`; apex/`www` → `web-dist`; same container | AC-Q1, M2.D-66 | Yes (Host header + prod mode) |
| G-02 | Built shop JS contains no `/dashboard`, no `/kitchen` | AC-Q2, M2.D-64 | Yes (grep dist) |
| G-03 | Admin cookie `ssp_token` never sent to `order.<domain>` | AC-Q3, M2.D-68 | Partial (code assertion; DevTools DEFERRED) |
| G-04 | `GET /api/public/health` 200 from order origin; foreign origin blocked | AC-Q4, M2.D-67 | Yes |
| G-05 | "Chia sẻ vị trí" gets permission + lat/lng on HTTPS production | AC-Q5, M2.D-69 | **DEFERRED** (needs real HTTPS) |
| G-06 | `curl -I https://order.<domain>` → valid cert + HTTP/2 | AC-Q6 | **DEFERRED** |
| G-07 | No `apps/web` regression (login, tables, kitchen, payment) | SPECS | Yes (prod matrix + manual localhost smoke) |
| G-08 | Root `pnpm build` builds both apps; no turbo cache conflict | SPECS | Yes |
| G-09 | `GET /api/public/health` with `Accept: text/html` still JSON (prod mode) | SPECS 2026-07-29 | Yes |
| G-10 | Forged `…evil.com` origin → 403; real origins → pass; `curl` on `/api/public/*` without `Origin` → pass | SPECS 2026-07-29 | Yes |
| G-11 | `Referrer-Policy: no-referrer` on `order.`; `/uploads/menu/<file>` serves the image | SPECS 2026-07-29 | Partial (config asserted; wire DEFERRED) |
| G-12 | Image builds with `packages/utils` present — no `ERR_PNPM_OUTDATED_LOCKFILE` / `ERR_MODULE_NOT_FOUND` | SPECS 2026-07-29 | Yes (local `docker build`) |

## Task index

| Task | Wave | Title | Files | LOC | Goals |
|------|------|-------|-------|-----|-------|
| 01 | 1 | Scaffold `apps/shop` as a pnpm workspace package | 5 | 115 | G-01, G-02, G-08 |
| 02 | 1 | `packages/utils` skeleton + `apiOk` envelope helper | 3 | 60 | G-12 |
| 03 | 1 | Declare `@order/utils` + `express` in `apps/api`, refresh lockfile | 2 | 12 | G-12, G-01 |
| 04 | 2 | `GET /api/public/health` — the phase's only new endpoint | 3 | 85 | G-04, G-09, G-12 |
| 05 | 2 | Four placeholder pages (`/cart`, `/checkout`, `/o/:token`, `/history`) | 4 | 150 | G-02, G-01 |
| 06 | 2 | Dockerfile: `apps/shop` + `packages/utils` in all 3 stages → `shop-dist` | 1 | 16 | G-12, G-01, G-08 |
| 07 | 3 | Shop HomePage: health ping + temporary "Chia sẻ vị trí" probe | 3 | 170 | G-05, G-04, G-02 |
| 08 | 3 | `main.ts`: `/api/*` passthrough first + host-based static root | 1 | 70 | G-01, G-09, G-07 |
| 09 | 3 | CSRF exact-origin list + `/api/admin/` + exclude `/api/public/` | 3 | 85 | G-10, G-04, G-07 |
| 10 | 4 | Shop app shell: router (5 routes) + global styles | 3 | 140 | G-02, G-01, G-08 |
| 11 | 4 | `Caddyfile`: `order.{$DOMAIN}` block, `geolocation=(self)`, `no-referrer` | 1 | 32 | G-11, G-05, G-06, G-01 |
| 12 | 5 | Local prod-mode verification script: routing matrix + bundle + turbo | 1 | 190 | G-01, G-02, G-07, G-08, G-09 |
| 13 | 5 | Local security script: CSRF matrix + host-only cookie + image build | 1 | 180 | G-10, G-04, G-12, G-03, G-11 |
| 14 | 5 | Deferred owner runbook: DNS A record + HTTPS-only checks (manual) | 1 | 110 | G-03, G-05, G-06, G-11 |

**Totals:** 14 tasks · 5 waves · ~1,415 LOC estimated · 32 file paths.

## Wave 1 — Workspace packages (manifests only, zero runtime behaviour change)

Task 01 và 02 độc lập hoàn toàn, chạy song song được. Chúng đứng trước vì mọi task sau
(dòng COPY trong Dockerfile, import `@order/utils`, `express.static`) đều cần manifest đã đúng.

| Task | Title | Depends on |
|------|-------|-----------|
| 01 | Scaffold `apps/shop` as a pnpm workspace package | — |
| 02 | `packages/utils` skeleton + `apiOk` envelope helper | — |

**Exit gate:** `apps/shop/package.json` và `packages/utils/package.json` tồn tại ·
`corepack pnpm ls -r` thấy `@order/shop` và `@order/utils`.

## Wave 2 — Lockfile (SEQUENTIAL — bắt buộc sau wave 1)

> **Sửa sau CrossAI blueprint-review 2026-07-29 (finding #1).** Task 03 trước đây nằm trong
> Wave 1 với chú thích "these three run in parallel", nhưng bảng phụ thuộc của nó ghi
> "Depends on: 01, 02". Nếu executor chạy song song thật thì `corepack pnpm install` không
> thấy 2 manifest mới → `ERR_PNPM_OUTDATED_LOCKFILE` **ngay wave đầu**, chặn cả phase.
> Tách thành wave riêng để thứ tự là ràng buộc cấu trúc, không phải ghi chú dễ bỏ qua.

| Task | Title | Depends on |
|------|-------|-----------|
| 03 | Declare `@order/utils` + `express` in `apps/api`, refresh lockfile | 01, 02 (bắt buộc xong trước) |

**Exit gate:** `corepack pnpm install --frozen-lockfile` exits 0 ·
`corepack pnpm --filter @order/shop build` và `--filter @order/utils build` đều xanh.


## Wave 3 — API surface, placeholder pages, build plumbing

| Task | Title | Depends on |
|------|-------|-----------|
| 04 | `GET /api/public/health` (imports `apiOk` from `@order/utils`) | 02, 03 |
| 05 | Four placeholder pages | 01 |
| 06 | Dockerfile all 3 stages + `shop-dist` | 01, 02, 03 |

No two tasks in this wave touch the same file. Pages are written **before** the router (wave 4) so
the shell never imports a file that does not exist yet.

**Exit gate:** `curl localhost:3001/api/public/health` (dev) → `{"ok":true,…}` ·
`docker build .` green · `--filter @order/shop typecheck` green.

## Wave 4 — Request routing, CSRF, and the customer home probe

The two highest-risk edits in the phase (`main.ts`, `csrf-origin.middleware.ts`) land here,
after there is a real `/api/public/health` route to point the assertions at.

| Task | Title | Depends on |
|------|-------|-----------|
| 07 | Shop HomePage: health ping + temporary geolocation probe | 04 (endpoint contract), 01 |
| 08 | `main.ts`: `/api/*` passthrough first + host-based static root | 03 (`express` dep), 06 (`shop-dist` layout) |
| 09 | CSRF exact-origin list + `/api/admin/` + exclude `/api/public/` | 04 (`/api/public/*` must exist to be excluded) |

**Exit gate:** production-mode `Accept: text/html` on `/api/public/health` returns JSON ·
forged `…evil.com` origin returns 403 · POS reload of `/orders` still returns the POS shell.

## Wave 5 — App shell and edge configuration

| Task | Title | Depends on |
|------|-------|-----------|
| 10 | Shop app shell: router (5 routes) + global styles | 05, 07 (all five page components must exist) |
| 11 | `Caddyfile`: `order.{$DOMAIN}` site block | — (independent of the API code) |

**Exit gate:** `grep -rE '/dashboard|/kitchen' apps/shop/dist/assets/*.js` empty ·
route `/` JS ≤ 150KB gzip · `caddy validate` green with two site blocks and the correct
`Permissions-Policy` per block.

## Wave 6 — Local verification harness and deferred owner actions

| Task | Title | Depends on |
|------|-------|-----------|
| 12 | Local prod-mode routing/bundle/turbo verification script | 01–11 |
| 13 | Local CSRF/cookie/image security verification script | 01–11 |
| 14 | Deferred VPS runbook (manual owner action — nothing executed) | 11 |

**Exit gate:** both scripts exit 0 on this machine with no VPS access · `DEFERRED-VPS-CHECKS.md`
lists G-03, G-05, G-06, G-11 with commands, expected output and an empty sign-off table.

## Verification

**Everything below runs on this machine. No SSH, no `deploy.sh`, no `git push`, no
`docker-compose.prod.yml`.** Local `docker build` (image plumbing) and the dev
`docker-compose.yml` mysql service are the only container usage.

**One-shot entry point (after wave 5):**

```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
bash scripts/verify-phase07-routing.sh    # G-01, G-02, G-07, G-08, G-09
bash scripts/verify-phase07-security.sh   # G-10, G-04, G-12, G-03(static), G-11(config)
```

**Toolchain gotcha (verified on this machine):** the globally installed pnpm requires
Node ≥ 22.13 while the active runtime is Node **v20.11.0**, so bare `pnpm` crashes with
`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. Every command in this plan uses **`corepack pnpm`**
(`package.json` pins `pnpm@9.0.0`), which works.

**Production-mode reproduction recipe** (why local dev alone proves nothing — the F2 bug only
appears when `NODE_ENV=production` **and** `web-dist` exists):

```bash
corepack pnpm db:up                                  # dev docker-compose.yml mysql only
corepack pnpm build
rm -rf apps/api/web-dist apps/api/shop-dist
cp -R apps/web/dist  apps/api/web-dist
cp -R apps/shop/dist apps/api/shop-dist
(cd apps/api && NODE_ENV=production API_PORT=3099 \
  ALLOWED_ORIGIN='https://quanbalun.site,https://www.quanbalun.site,https://order.quanbalun.site' \
  node dist/main.js &)
```

**Per-goal verification map:**

| Goal | How it is verified | Where |
|------|--------------------|-------|
| G-01 | `Host:` matrix in prod mode; `docker run … ls shop-dist/index.html web-dist/index.html` | Task 08, 12, 13 |
| G-02 | `grep -rE '/dashboard\|/kitchen' apps/shop/dist/assets/*.js` → empty | Task 10, 12 |
| G-03 | grep `jwt.service.ts` → no `domain:` key, `sameSite: 'strict'`; shop has no `document.cookie` / `credentials: 'include'` — **browser half DEFERRED** | Task 13 §C, Task 14 D-4 |
| G-04 | `curl /api/public/health` 200 + `{"ok":true,…}`; CSRF matrix row 11 | Task 04, 12, 13 |
| G-05 | Client code exercised on `localhost` (secure context) — **production header half DEFERRED** | Task 07, 11, Task 14 D-3 |
| G-06 | **DEFERRED** — needs real Let's Encrypt cert | Task 14 D-1 |
| G-07 | Rows 7–9 of the routing matrix + manual localhost POS smoke (login/tables/kitchen/payment) | Task 08, 12 |
| G-08 | `corepack pnpm build` twice; dists differ; second run is a turbo cache hit | Task 10, 12 |
| G-09 | `curl -H 'Accept: text/html' /api/public/health` in **prod mode** → JSON | Task 08, 12 |
| G-10 | 12-row CSRF matrix incl. `https://order.quanbalun.site.evil.com` → 403 | Task 09, 13 |
| G-11 | `caddy validate` + `caddy adapt \| jq` header assertions — **wire half DEFERRED** | Task 11, 13 §E, Task 14 D-2 |
| G-12 | `pnpm install --frozen-lockfile` + local `docker build` + in-image `import('@order/utils')` | Task 03, 06, 13 §D |

**Manual (human) checks that stay local:** POS smoke on `http://localhost:5173`
(login → table map → kitchen → payment) and the geolocation prompt on
`http://localhost:5174`. Both are localhost-only; neither requires the VPS.

## Risks

| # | Risk | Impact | Mitigation / status |
|---|------|--------|---------------------|
| R-1 | **G-05, G-06 and the on-the-wire half of G-11 cannot be verified locally.** Real HTTPS, a real Let's Encrypt cert and a real browser permission prompt are required; `localhost` is already a secure context so a local geolocation success proves only client correctness, and the `Permissions-Policy` header is emitted by Caddy, not by our code. | Three criteria stay open at phase end | Marked **DEFERRED**, not faked. No local reverse proxy is invented to simulate them. Runbook = Task 14; config-level assertions (`caddy adapt` header diff) are the strongest honest local proxy and live in Tasks 11 + 13 §E. |
| R-2 | **G-03's browser half is deferred too** — cookie transmission can only be observed in DevTools against two real hosts. | Subdomain cookie leak would be caught late | Task 13 §C asserts the *cause* statically (`cookieOptions` has no `domain`, `sameSite: 'strict'`) and fails the build if anyone makes it domain-wide (M2.D-68). Browser observation = Task 14 D-4. |
| R-3 | **`main.ts` middleware is a single point of failure for the entire POS.** Removing `app.useStaticAssets(webDist)` (mandatory for host-based roots) and reordering the `/api` check touches every page load of a live restaurant. | Total POS outage if wrong | Task 08 pins the exact target code, enumerates the preserved behaviours, and its acceptance list contains 10 rows including the POS-reload cases; Task 12 automates all of them in production mode. Nothing is deployed, so a mistake stays local. |
| R-4 | **Repo has zero test files** (`find -name '*.spec.ts'` → 0) and no `vitest.config` anywhere, although `apps/api/package.json:11` declares `"test": "vitest run"`. FOUNDATION §9.7 mandates vitest + Playwright at 70% coverage. | Deviation from the architecture lock | Deliberate: phase 07 ships **shell verification harnesses** (Tasks 12–13) rather than standing up two test frameworks inside an infra phase. Log as OVERRIDE-DEBT against FOUNDATION §9.7; P08.D-60 already commits phase 08 to the first three real tests (routing table, error-envelope snapshot, CSRF matrix) — these scripts are their executable specification. |
| R-5 | **`packages/utils` is a new shared package not named in FOUNDATION §9.2/§9.3** (which lists `packages/schemas` + `packages/ui-kit`, and `ui-kit` does not exist on disk). | Architecture-lock drift | Justified by P08.D-59 (supersedes P08.D-51: `packages/ui` DROPPED, `packages/utils` is the only new package). Boundary rule `packages/* → apps/*` BANNED is respected — `packages/utils` has zero deps and imports nothing. Note for `/vg:project --update`. |
| R-6 | **`express` becomes a direct `apps/api` dependency.** pnpm does not hoist, so `express.static` is otherwise unresolvable — but a direct dep can drift from the version `@nestjs/platform-express` uses. | Duplicate express / subtle middleware bugs | Pinned as `^4.21.0`, which resolves to the already-locked `express@4.22.1` (`pnpm-lock.yaml:1792`); Task 03's acceptance asserts a single 4.22.x resolution. Alternative (hand-rolled `res.sendFile` static server) was rejected as more code and worse cache headers. |
| R-7 | **`Dockerfile` runtime stage deliberately omits `apps/shop/package.json`**, mirroring the existing `apps/web` treatment, while `pnpm install --frozen-lockfile --prod --filter @order/api...` runs against a lockfile that has both importers. | Image build failure discovered late | The `apps/web` precedent proves the pattern works today; Task 06's acceptance is a real local `docker build`, so the failure (if any) surfaces in wave 2, not on the VPS. |
| R-8 | **`ALLOWED_ORIGIN` is now a list compared exactly.** A missing `www.` entry, a trailing slash, or a `:port` mismatch turns into a hard 403 on POS mutations. | POS admin actions blocked | Task 09 trims whitespace and strips trailing slashes, normalises via `new URL().origin`, ships the 3-origin value in `.env.production.example`, and asserts all three real origins pass. `.env.example` carries `5173,5174` for dev. |
| R-9 | **`.env.production` on the VPS is not managed by this phase** — only `.env.production.example` is edited. The owner must copy the new `ALLOWED_ORIGIN` value across before any future deploy. | Post-deploy 403 storm | Called out in Task 14 Step 1 as an explicit pre-deploy checklist item. |
| R-10 | **The temporary "Chia sẻ vị trí" button is throwaway code** that could survive into production UI. | Dead code / confusing UX | `ShareLocationButton.tsx` carries a `TODO(phase-08): XOÁ` marker asserted by Task 07's acceptance criteria; SPECS Scope already states it is removed or replaced in phase 08. |
| R-11 | **`.claude/vg.config.md` chưa khai surface `shop`** — block `surfaces:` **có thật** ở dòng 742 (không bị comment như bản nháp đầu ghi sai), nhưng chỉ khai `web` với `paths: ["apps/web","apps/api"]`, so per-surface gates will not fire for `apps/shop`. | Review/test gates may skip the new app | Out of scope for phase 07 (a config/workflow change, not a SPECS criterion). Recorded here so `/vg:scope 08` picks it up — phase 08's DISCUSSION-LOG round 2 already answered "khai surface mới `shop`". |
| R-12 | **No fonts are loaded** (`--font-display` "Baloo 2" / `--font-body` "Be Vietnam Pro" fall back to system fonts) because remote font loading interacts with `Referrer-Policy` and the bundle budget. | Placeholder pages look off-brand | Accepted for an infra phase; font delivery is a phase-08 decision alongside the real lotteria-style screens. |
| R-13 | **TTI < 3s Slow-4G không được đo ở phase 07** — SPECS ràng buộc cả bundle ≤150KB gzip *và* TTI < 3s, nhưng PLAN chỉ kiểm bundle size. Bundle 140KB vẫn có thể fail TTI nếu có render-blocking resource hoặc long main-thread task. | Tưởng đã đạt ràng buộc hiệu năng trong khi chưa đo | Phase 07 chỉ **proxy** TTI qua bundle size; đo thật cần Lighthouse throttled trên app có nội dung thật → **defer sang phase 08**. Ghi nhận là gap, không im lặng. Thêm sau CrossAI blueprint-review 2026-07-29 (finding #4). |

## Goal coverage

| Goal | Tasks | Status |
|------|-------|--------|
| G-01 | 01, 03, 06, 08, 11, 12, 13 | Covered |
| G-02 | 01, 05, 07, 10, 12 | Covered |
| G-03 | 13, 14 | Covered (static locally; browser check DEFERRED) |
| G-04 | 04, 07, 09, 12, 13 | Covered |
| G-05 | 07, 11, 14 | Partial — **DEFERRED** (real HTTPS required) |
| G-06 | 11, 14 | **DEFERRED** (real cert required) |
| G-07 | 08, 09, 12 | Covered |
| G-08 | 01, 06, 10, 12 | Covered |
| G-09 | 04, 08, 12 | Covered |
| G-10 | 09, 13 | Covered |
| G-11 | 11, 13, 14 | Partial — config asserted locally, wire DEFERRED |
| G-12 | 02, 03, 06, 13 | Covered |

Every task carries at least one goal; no orphan tasks.

## ORG 6-dimension check

| # | Dimension | Status |
|---|-----------|--------|
| 1 | **Infra** | Task 11 adds a second Caddy site block; Task 06 rewires all three Docker stages. No new service, no new container — one API container keeps serving both frontends (M2.D-66). |
| 2 | **Env** | Task 09 updates `ALLOWED_ORIGIN` (3-origin list) in `.env.production.example` + `.env.example`. `DOMAIN` already exists. No new secret. `docker-compose.prod.yml` already passes both through — no change needed. |
| 3 | **Deploy** | **N/A this phase — deliberately DEFERRED (P08.D-72).** All changes are local commits on `feat/online-ordering`; Task 14 documents the owner-run `./deploy.sh` path plus the manual DNS A record prerequisite. |
| 4 | **Smoke** | Local: Tasks 12–13 (routing matrix, CSRF matrix, in-image module resolution). Post-deploy: Task 14 D-1..D-4 with expected output and failure diagnostics. |
| 5 | **Integration** | The whole phase is integration with a live POS: `main.ts` and `csrf-origin.middleware.ts` are shared by `apps/web`. G-07 rows in Task 12 plus a manual localhost POS smoke are the regression net. `/health`, `/orders`, `/uploads/` and `GlobalExceptionFilter` are explicitly left byte-unchanged. |
| 6 | **Rollback** | Code-only: `git revert` of the phase-07 commits. No DB migration, no schema change (`synchronize: true`, M2.D-07), no data mutation, nothing deployed to roll back yet. The `order.` DNS record is harmless if left in place. Documented in Task 14 §8. |

## Tasks

Layer-1 files: `.vg/phases/07-ha-tang-trang-khach/PLAN/task-01.md` … `task-14.md`.
The blocks below are those files concatenated verbatim, in wave order.

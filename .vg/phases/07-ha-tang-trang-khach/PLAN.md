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

### Task 01 — Scaffold `apps/shop` as a pnpm workspace package
<!-- vg-binding: SPECS:success-criteria -->
<wave>1</wave>
<implements-decision>M2.D-64</implements-decision>
<file-path>apps/shop/package.json</file-path>
<file-path>apps/shop/tsconfig.json</file-path>
<file-path>apps/shop/index.html</file-path>
<file-path>apps/shop/vite.config.ts</file-path>
<file-path>apps/shop/src/main.tsx</file-path>
<goals-covered>G-01,G-02,G-08</goals-covered>
<design-ref>no-asset:phase-07-no-design-manifest-scaffold-only</design-ref>
<!-- design-ref rationale: design system source is apps/shop/DESIGN.md + src/styles/tokens.css; lotteria mobile refs still missing (phase 08) -->
<estimated-loc>115</estimated-loc>

Covers goal: G-01, G-02, G-08

**Description:** Turn `apps/shop/` (currently only `DESIGN.md` + `src/styles/tokens.css`,
zero code) into a real Vite + React 19 + TS workspace package `@order/shop` that builds to
`apps/shop/dist`. Deliberately minimal dependency set so the customer bundle can never pull
POS code (M2.D-64) and stays inside the 150KB gzip route budget (FOUNDATION §9.6 `fe_route_kb`).
`src/main.tsx` in this task is a **one-screen placeholder mount** so the package is buildable
from wave 1 onward; Task 10 replaces it with the real router shell.

**Read first:**
- `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/tsconfig.json` (patterns to mirror)
- `apps/shop/DESIGN.md` frontmatter + `apps/shop/src/styles/tokens.css` (design system already committed)
- `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`

**Steps:**
1. `apps/shop/package.json` — `"name": "@order/shop"`, `private`, `"type": "module"`, scripts
   `dev` (`vite`), `build` (`tsc --noEmit && vite build`), `typecheck` (`tsc --noEmit`), `preview`.
   Dependencies: `react ^19.0.0`, `react-dom ^19.0.0`, `react-router-dom ^7.0.0`,
   `@order/schemas workspace:*` (M2.D-64 — share types, never copy).
   devDependencies: `@types/react ^19`, `@types/react-dom ^19`, `@vitejs/plugin-react ^4.3.0`,
   `typescript ^5.7.0`, `vite ^6.0.0`.
   **Do NOT add** `axios`, `xlsx`, `zxcvbn` — POS-only deps; shop uses native `fetch`.
2. `apps/shop/tsconfig.json` — copy `apps/web/tsconfig.json` verbatim (extends
   `../../tsconfig.base.json`, `jsx: react-jsx`, `noEmit`, `types: ["vite/client"]`,
   include `src/**/*` + `vite.config.ts`).
3. `apps/shop/index.html` — `lang="vi"`; viewport
   `width=device-width, initial-scale=1, maximum-scale=1` (F-16 anti auto-zoom on iOS);
   `<meta name="theme-color" content="#cc3529">` (= `--brand-600`); title
   `Quán Bà Lùn — Đặt hàng`; `<div id="root"></div>`; `<script type="module" src="/src/main.tsx">`.
4. `apps/shop/vite.config.ts` — `plugins: [react()]`; `server.port: 5174`, `server.strictPort: true`
   (5173 belongs to `apps/web`); `build.outDir: 'dist'`. Dev proxy keys **`/api` and `/uploads` only**
   (repo fact: `apps/web/vite.config.ts` has no `/api` key, so the shop needs its own) reusing the
   `bypass` on `Accept: text/html` pattern from `apps/web/vite.config.ts` so browser reloads of
   client routes return `index.html` instead of proxying.
5. `apps/shop/src/main.tsx` — placeholder mount only: `createRoot` + `<StrictMode>` +
   a single `<main>` with text `Trang khách đang được dựng — phase 07`. Import
   `./styles/tokens.css`. Add `// TODO(task-10): thay bằng BrowserRouter + App shell`.
6. **No edit to `pnpm-workspace.yaml` or `turbo.json`** — `packages: ["apps/*", "packages/*"]`
   already globs `apps/shop`, and `turbo.json` tasks are name-based (`build`/`dev`/`typecheck`),
   so registration is automatic. SPECS phrasing "thêm vào pnpm-workspace.yaml + turbo.json" is
   already satisfied by the existing globs — prove it in the verify step, do not add redundant entries.

**Acceptance criteria:**
- [ ] `corepack pnpm ls -r --depth -1` lists `@order/shop` at `apps/shop`.
- [ ] `corepack pnpm --filter @order/shop build` exits 0 and produces `apps/shop/dist/index.html`
      plus at least one hashed file in `apps/shop/dist/assets/`.
- [ ] `apps/shop/dist` and `apps/web/dist` are separate directories; neither build overwrites the other.
- [ ] `apps/shop/package.json` dependency list contains no POS-only package (`axios`, `xlsx`, `zxcvbn`).
- [ ] `apps/shop/index.html` contains `maximum-scale=1`.
- [ ] `apps/shop/vite.config.ts` has proxy keys `/api` and `/uploads` and `port: 5174`.

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
# NOTE: global pnpm needs Node>=22.13 but this machine runs Node v20.11.0 →
# always drive pnpm through corepack (package.json pins pnpm@9.0.0).
corepack pnpm install
corepack pnpm ls -r --depth -1 | grep '@order/shop'
corepack pnpm --filter @order/shop build
ls apps/shop/dist/index.html apps/shop/dist/assets/ | head
grep -c 'maximum-scale=1' apps/shop/index.html
grep -E '"(axios|xlsx|zxcvbn)"' apps/shop/package.json && echo 'FAIL: POS dep leaked' || echo 'OK: no POS dep'
```

**Notes:** 5 files is above the usual 1–3 per task, but they are one indivisible package
skeleton (a manifest without tsconfig/index.html/entry cannot build, so splitting would
create a wave that fails its own verify step).

### Task 02 — `packages/utils` buildable skeleton + `apiOk` success-envelope helper
<!-- vg-binding: SPECS:success-criteria -->
<!-- vg-binding: INTERFACE-STANDARDS:error-shape -->
<wave>1</wave>
<implements-decision>M2.D-64</implements-decision>
<file-path>packages/utils/package.json</file-path>
<file-path>packages/utils/tsconfig.json</file-path>
<file-path>packages/utils/src/index.ts</file-path>
<goals-covered>G-12</goals-covered>
<estimated-loc>60</estimated-loc>

Covers goal: G-12

**Description:** Create the **build plumbing** for the single new workspace package the
customer surface needs (`packages/utils`). Downstream context P08.D-59 supersedes P08.D-51:
`packages/ui` was explicitly DROPPED, so **exactly one** new package is created here, not two.
Phase 08 fills it with the remaining shared helpers; phase 07 ships only the one helper that
lets the plumbing be proven end-to-end (`apiOk`), because a package that nothing imports
cannot demonstrate "no `ERR_MODULE_NOT_FOUND`" (G-12).

**Read first:**
- `packages/schemas/package.json` + `packages/schemas/tsconfig.json` (mirror these exactly — the
  Dockerfile copies `dist` by hand and expects the same layout)
- `.vg/phases/07-ha-tang-trang-khach/INTERFACE-STANDARDS.md` → `## API Standard` success envelope
- `.vg/phases/08-public-menu-checkout/CONTEXT.md` § P08.D-59

**Steps:**
1. `packages/utils/package.json` — byte-for-byte structural copy of
   `packages/schemas/package.json` with `"name": "@order/utils"`: `private`, `"type": "module"`,
   `main: dist/index.js`, `types: dist/index.d.ts`, the same `exports` map, scripts
   `build: tsc` + `typecheck: tsc --noEmit`, `devDependencies: { typescript: ^5.7.0 }`.
   **Zero runtime dependencies** — the package must be importable from both `apps/api` (Node ESM)
   and `apps/shop` (browser bundle).
2. `packages/utils/tsconfig.json` — copy `packages/schemas/tsconfig.json` verbatim
   (`outDir: dist`, `rootDir: src`, include `src/**/*`).
3. `packages/utils/src/index.ts` — export the success envelope contract quoted from
   INTERFACE-STANDARDS `## API Standard` (verbatim key set, do not paraphrase):

   ```ts
   /** INTERFACE-STANDARDS.md § API Standard — success envelope. */
   export type ApiOk<T> = {
     ok: true;
     data: T;
     message?: string;
     meta?: unknown;
     request_id?: string;
   };

   export function apiOk<T>(data: T, message?: string): ApiOk<T> {
     return message === undefined ? { ok: true, data } : { ok: true, data, message };
   }
   ```
   Add a header comment: this package is the shared-helper home per P08.D-59; phase 08 adds
   money/phone/slug helpers here.
4. Do **not** add an error-envelope builder. Errors keep flowing through the existing
   `GlobalExceptionFilter` legacy compact shape `{ error: { code, message, request_id, ts_ms,
   field_errors } }`, which INTERFACE-STANDARDS permits via `legacy_compact_error_shape`.
   Touching the filter would change every `apps/web` error path (G-07 regression risk).

**Acceptance criteria:**
- [ ] `corepack pnpm --filter @order/utils build` exits 0 and emits `packages/utils/dist/index.js`
      **and** `packages/utils/dist/index.d.ts` (the `.d.ts` matters — `apps/api` typechecks against it).
- [ ] `packages/utils/package.json` has zero `dependencies` block (or an empty one).
- [ ] `apiOk({ a: 1 })` deep-equals `{ ok: true, data: { a: 1 } }` — no `message` key when omitted.
- [ ] Package layout matches `packages/schemas` (same manifest fields, same `exports` map shape)
      so the hand-maintained Dockerfile COPY lines in Task 06 can be a literal analogue.

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
corepack pnpm install
corepack pnpm --filter @order/utils build
ls packages/utils/dist/index.js packages/utils/dist/index.d.ts
node --input-type=module -e "
const { apiOk } = await import('./packages/utils/dist/index.js');
const v = apiOk({ a: 1 });
if (JSON.stringify(v) !== '{\"ok\":true,\"data\":{\"a\":1}}') { console.error('FAIL', v); process.exit(1); }
console.log('OK', JSON.stringify(v));
"
diff <(jq -S 'keys' packages/schemas/package.json) <(jq -S 'keys' packages/utils/package.json) || echo 'manifest key sets differ — review'
```

### Task 03 — Declare `@order/utils` + `express` as real `apps/api` dependencies and refresh the lockfile
<!-- vg-binding: SPECS:success-criteria -->
<wave>1</wave>
<implements-decision>M2.D-66</implements-decision>
<file-path>apps/api/package.json</file-path>
<file-path>pnpm-lock.yaml</file-path>
<design-ref>no-asset:backend-manifest-task-no-ui-surface</design-ref>
<goals-covered>G-12,G-01</goals-covered>
<estimated-loc>12</estimated-loc>

Covers goal: G-12, G-01

**Description:** Two undeclared-dependency landmines have to be defused before any code in
wave 2/3 can run. (1) `apps/api` will import `@order/utils` (Task 04) — without a
`workspace:*` entry pnpm creates no symlink and the runtime image dies with
`ERR_MODULE_NOT_FOUND` (exactly the failure G-12 forbids). (2) `apps/api/src/main.ts` will need
`express.static` for host-based static roots (Task 08) — `express@4.22.1` exists in
`pnpm-lock.yaml` only as a transitive of `@nestjs/platform-express`, and **pnpm does not hoist**,
so `import express from 'express'` is unresolvable from `apps/api` today. `main.ts:5` already
does a type-only `import type { ... } from 'express'` against that undeclared package.

**Read first:**
- `apps/api/package.json` (dependency block)
- `pnpm-lock.yaml:1792` (`express@4.22.1` — the version already resolved in the tree)
- `Dockerfile:19` and `:60` (`pnpm install --frozen-lockfile` — the lockfile must be committed in sync)

**Steps:**
1. Add to `apps/api/package.json` `dependencies` (alphabetical position, keep style):
   - `"@order/utils": "workspace:*"` (next to the existing `"@order/schemas": "workspace:*"`)
   - `"express": "^4.21.0"` — range that resolves to the already-locked `4.22.1`, so **no new
     version enters the tree** and `@nestjs/platform-express` keeps sharing the same instance.
     Must be a `dependencies` entry (not `devDependencies`): the runtime stage installs
     `--prod --filter @order/api...`.
2. Run `corepack pnpm install` and **commit the regenerated `pnpm-lock.yaml`**. The lockfile
   also gains importers for `apps/shop` and `packages/utils` from Tasks 01–02; all three changes
   land in this one lockfile revision.
3. Do not touch `apps/web/package.json` (SPECS Out of Scope: no `apps/web` behaviour change).

**Acceptance criteria:**
- [ ] `apps/api/node_modules/express/package.json` exists and reports version `4.22.x`
      (single resolution, no duplicate express in the tree).
- [ ] `apps/api/node_modules/@order/utils` is a symlink to `../../../packages/utils`.
- [ ] `corepack pnpm install --frozen-lockfile` exits 0 — proves the committed lockfile matches
      the manifests, i.e. `Dockerfile:19` will not hit `ERR_PNPM_OUTDATED_LOCKFILE`.
- [ ] `pnpm-lock.yaml` importers section contains `apps/shop` and `packages/utils`.

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
corepack pnpm install
node -e "console.log(require('./apps/api/node_modules/express/package.json').version)"
ls -l apps/api/node_modules/@order/
corepack pnpm install --frozen-lockfile && echo 'LOCKFILE IN SYNC'
grep -E '^  (apps/shop|packages/utils):' pnpm-lock.yaml
corepack pnpm ls -r --depth 0 --filter @order/api 2>/dev/null | grep -E 'express|@order/utils'
```

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
- [x] ~~With MySQL stopped the same call still returns 200 with `"status":"degraded","db":"down"`~~
      **KHÔNG ĐẠT ĐƯỢC — tiêu chí này sai, đã kiểm chứng 2026-07-29.**
      `TypeOrmModule.forRoot` chặn bootstrap tới khi kết nối được DB. Chạy thử với
      `MYSQL_PORT=9999`: TypeORM retry 9 lần (mặc định 10, mỗi lần 3s) rồi **process chết** —
      endpoint không bao giờ được gọi tới. Kết quả `curl` là `000` (connection refused),
      không phải 200.
      **Hệ quả rộng hơn:** nhánh `db: 'down'` / `status: 'degraded'` trong
      `apps/api/src/modules/health/health.controller.ts` là **code chết** kể từ phase 01.
      Uptime monitor theo dõi `/health` khi MySQL sập sẽ nhận connection-refused, không phải
      200 kèm `degraded`. Muốn health probe thật sự sống khi DB chết thì phải bỏ
      `TypeOrmModule.forRoot` khỏi đường bootstrap (ví dụ `retryAttempts: 0` +
      lazy connect) — **việc của Milestone 1, không thuộc phase 07**.
      Nhánh try/catch trong `PublicController` vẫn giữ nguyên: nó đúng về mặt code và sẽ hoạt
      động ngay khi bootstrap không còn phụ thuộc DB.
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

### Task 05 — Four placeholder customer pages (`/cart`, `/checkout`, `/o/:token`, `/history`)
<!-- vg-binding: SPECS:success-criteria -->
<wave>2</wave>
<implements-decision>M2.D-64</implements-decision>
<file-path>apps/shop/src/pages/CartPage.tsx</file-path>
<file-path>apps/shop/src/pages/CheckoutPage.tsx</file-path>
<file-path>apps/shop/src/pages/OrderTrackPage.tsx</file-path>
<file-path>apps/shop/src/pages/HistoryPage.tsx</file-path>
<goals-covered>G-02,G-01</goals-covered>
<design-ref>no-asset:phase-07-no-design-manifest-placeholder-pages</design-ref>
<!-- design-ref rationale: placeholders styled from apps/shop/src/styles/tokens.css only; real lotteria-style screens are phase 08 -->
<estimated-loc>150</estimated-loc>
<test_ids>
  <id kind="link" value="cart-back-link">Back-to-menu link on /cart</id>
  <id kind="link" value="checkout-back-link">Back-to-menu link on /checkout</id>
  <id kind="link" value="order-track-back-link">Back-to-menu link on /o/:token</id>
  <id kind="link" value="history-back-link">Back-to-menu link on /history</id>
</test_ids>

Covers goal: G-02, G-01

**Description:** Ship the four non-home placeholder routes named in SPECS Scope so the shop
bundle has a real route surface to build and grep against (G-02) — but zero ordering logic
(phase 08 owns cart/checkout/tracking). Written before the router (Task 10) so the shell can
import files that already exist.

**Read first:**
- `apps/shop/DESIGN.md` §1 (mobile context, 44px tap floor) and §2 (colour discipline)
- `apps/shop/src/styles/tokens.css` (variable names: `--bg-page`, `--bg-surface`,
  `--text-strong`, `--text-muted`, `--brand-600`, `--font-display`, `--font-body`,
  `--fs-base`, `--fs-lg`, `--sp-4`, `--r-card`, `--tap-min`, `--gutter`)
- `.vg/phases/07-ha-tang-trang-khach/SPECS.md` § Scope → placeholder route list

**Steps:**
1. One default-exported… no — **named export** per FOUNDATION §9.8 (`export function CartPage()`),
   `PascalCase.tsx` naming, explicit return type `JSX.Element`.
2. Each page renders: an `<h1>` with `font-family: var(--font-display)`, one sentence
   `Chức năng này sẽ có ở phase 08.`, and a back link to `/` (react-router `<Link>`) with
   `min-height: var(--tap-min); min-width: var(--tap-min); display:inline-flex; align-items:center`
   and the `data-testid` declared above.
3. **No hardcoded hex / px colours** — every colour and radius through `var(--token)`
   (DESIGN.md: "Không hardcode màu hex hay px trong .tsx"). Inline `style` objects are fine at
   this stage; a CSS-module/class system is a phase-08 decision.
4. `OrderTrackPage` reads `const { token } = useParams<{ token: string }>()` and renders only a
   masked form (`token.slice(0, 4) + '…'`) using `var(--font-mono)`. Never render the raw token
   in text — the URL is the secret (this is why Task 11 sets `Referrer-Policy: no-referrer`).
5. Absolutely no import from `apps/web`, no string `/dashboard`, no string `/kitchen`, no
   `import ... from '@order/schemas'` unless actually used (keeps bundle lean).
6. Font sizes only from the closed scale (`--fs-*`); minimum body size 16px (`--fs-base`) so
   iOS Safari does not auto-zoom.

**Acceptance criteria:**
- [ ] Four files exist, each exporting a named component, each with the declared `data-testid` link.
- [ ] `grep -rn '#[0-9a-fA-F]\{3,6\}' apps/shop/src/pages/` returns nothing (no raw hex).
- [ ] `grep -rn 'dashboard\|kitchen' apps/shop/src/` returns nothing.
- [ ] `corepack pnpm --filter @order/shop typecheck` exits 0.
- [ ] `/o/:token` page never prints the full token (grep the source for `{token}` used bare).
- [ ] Every interactive element's computed min tap area is ≥ 44×44 CSS px (`--tap-min`).

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
corepack pnpm --filter @order/shop typecheck
grep -rn '#[0-9a-fA-F]\{3,6\}' apps/shop/src/pages/ && echo 'FAIL: hardcoded hex' || echo 'OK: tokens only'
grep -rniE 'dashboard|kitchen' apps/shop/src/ && echo 'FAIL: POS route leaked' || echo 'OK'
grep -c 'data-testid' apps/shop/src/pages/*.tsx
grep -rn 'tap-min' apps/shop/src/pages/ | wc -l     # expect >= 4
```

### Task 06 — Dockerfile: add `apps/shop` + `packages/utils` to all three stages, emit `shop-dist`
<!-- vg-binding: SPECS:success-criteria -->
<wave>2</wave>
<implements-decision>M2.D-66</implements-decision>
<implements-decision>M2.D-64</implements-decision>
<file-path>Dockerfile</file-path>
<design-ref>no-asset:dockerfile-task-no-ui-surface</design-ref>
<goals-covered>G-12,G-01,G-08</goals-covered>
<estimated-loc>16</estimated-loc>

Covers goal: G-12, G-01, G-08

**Description:** The Dockerfile enumerates workspace manifests **by hand**, so a new workspace
package that is not added to every stage fails the image build with `ERR_PNPM_OUTDATED_LOCKFILE`
(deps stage) or `ERR_MODULE_NOT_FOUND` (runtime stage) — before the app even starts. Mirror the
existing `packages/schemas` treatment for `packages/utils`, and the existing `apps/web`
treatment for `apps/shop`, so the customer bundle lands at `apps/api/shop-dist` next to
`web-dist` for the host-based static selection in Task 08.

**Read first:** `Dockerfile` in full — specifically `:13-16` (deps manifests), `:30-33`
(builder node_modules), `:39-42` (build order), `:55-57` (runtime manifests), `:63`
(`packages/schemas/dist`), `:66` (api dist), `:69` (`apps/web/dist` → `apps/api/web-dist`).

**Steps:**
1. **deps stage** — after `COPY packages/schemas/package.json ./packages/schemas/` add:
   ```dockerfile
   COPY apps/shop/package.json ./apps/shop/
   COPY packages/utils/package.json ./packages/utils/
   ```
   Both are mandatory here: `pnpm install --frozen-lockfile` validates every importer in
   `pnpm-lock.yaml` that is present, and a missing manifest for a locked importer is the
   `ERR_PNPM_OUTDATED_LOCKFILE` trigger.
2. **builder stage** — after the existing `node_modules` COPY lines add:
   ```dockerfile
   COPY --from=deps /app/apps/shop/node_modules ./apps/shop/node_modules
   COPY --from=deps /app/packages/utils/node_modules ./packages/utils/node_modules
   ```
3. **builder build order** — packages before apps (`turbo`/pnpm filters do not infer order here
   because the RUN lines are explicit):
   ```dockerfile
   RUN pnpm --filter @order/schemas build && pnpm --filter @order/utils build
   RUN pnpm --filter @order/api build && pnpm --filter @order/web build && pnpm --filter @order/shop build
   ```
4. **runtime stage manifests** — add `COPY packages/utils/package.json ./packages/utils/` only.
   Do **not** add `apps/shop/package.json`: the runtime stage deliberately omits
   `apps/web/package.json` too (it installs `--prod --filter @order/api...` and only serves the
   built static output). Mirroring the proven `apps/web` treatment keeps the install graph
   identical to what already works in production.
5. **runtime artifacts** — after the `packages/schemas/dist` COPY add:
   ```dockerfile
   COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
   ```
   and after the `web-dist` COPY add:
   ```dockerfile
   COPY --from=builder /app/apps/shop/dist ./apps/api/shop-dist
   ```
6. Do not change `WORKDIR /app/apps/api`, `CMD`, or the uploads `mkdir` — `main.ts` resolves
   `web-dist`/`shop-dist` relative to `process.cwd()`.
7. `docker-compose.prod.yml` needs **no change** for this task (same single `api` service, same
   Caddy mount); env changes are Task 09.

**Acceptance criteria:**
- [ ] `docker build -t ordbl-phase07 .` succeeds locally with no `ERR_PNPM_OUTDATED_LOCKFILE`.
- [ ] In the built image both `/app/apps/api/web-dist/index.html` and
      `/app/apps/api/shop-dist/index.html` exist and differ (different `<title>`).
- [ ] In the built image `/app/packages/utils/dist/index.js` exists and
      `import('@order/utils')` resolves from `/app/apps/api` (no `ERR_MODULE_NOT_FOUND`).
- [ ] `/app/apps/api/dist/main.js` exists (api build unaffected).
- [ ] Image contains no `apps/web/node_modules` / `apps/shop/node_modules` bloat in the runtime stage.

**Verify (local, no VPS — build only, nothing is deployed):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
docker build -t ordbl-phase07 .
docker run --rm ordbl-phase07 sh -c 'ls -1 web-dist/index.html shop-dist/index.html ../../packages/utils/dist/index.js dist/main.js'
docker run --rm ordbl-phase07 sh -c 'grep -o "<title>[^<]*" web-dist/index.html shop-dist/index.html'
docker run --rm ordbl-phase07 node --input-type=module -e "
await import('@order/utils'); await import('@order/schemas'); console.log('module resolve OK');
"
```

### Task 07 — Shop HomePage: same-origin health ping + temporary "Chia sẻ vị trí" probe
<!-- vg-binding: SPECS:success-criteria -->
<!-- vg-binding: INTERFACE-STANDARDS:error-shape -->
<wave>3</wave>
<implements-decision>M2.D-64</implements-decision>
<implements-decision>M2.D-69</implements-decision>
<file-path>apps/shop/src/lib/api.ts</file-path>
<file-path>apps/shop/src/components/ShareLocationButton.tsx</file-path>
<file-path>apps/shop/src/pages/HomePage.tsx</file-path>
<edits-endpoint>GET /api/public/health</edits-endpoint>
<goals-covered>G-05,G-04,G-02</goals-covered>
<design-ref>no-asset:phase-07-no-design-manifest-temp-geolocation-probe</design-ref>
<!-- design-ref rationale: home placeholder + throwaway geolocation probe, replaced by the lotteria-style menu in phase 08 -->
<estimated-loc>170</estimated-loc>
<test_ids>
  <id kind="button" value="home-health-check-btn">Calls GET /api/public/health same-origin</id>
  <id kind="button" value="home-share-location-btn">Temporary Geolocation permission probe (M2.D-69)</id>
  <id kind="link" value="home-cart-link">Link to /cart placeholder</id>
</test_ids>

Covers goal: G-05, G-04, G-02

**Description:** The home placeholder carries the two probes this infra phase exists for: a
same-origin call to `/api/public/health` (proves no CORS is needed from `order.<domain>`,
M2.D-67 + G-04) and a **throwaway** "Chia sẻ vị trí" button whose only purpose is to detect the
`Permissions-Policy: geolocation=()` trap on production (M2.D-69 + G-05). Both are explicitly
temporary: phase 08 replaces the home page with the real menu and the real address flow.

**Read first:**
- `.vg/phases/07-ha-tang-trang-khach/INTERFACE-STANDARDS.md` § Frontend Error Handling Standard
  (message priority `error.user_message` → `error.message` → `message` → network fallback)
- `apps/api/src/common/filters/global-exception.filter.ts` (the actual error body FE must parse)
- `apps/shop/src/styles/tokens.css`, `apps/shop/DESIGN.md` §1–§2
- `Caddyfile:23` (`Permissions-Policy "geolocation=(), ..."` — the bug this probe detects)

**Steps:**
1. `apps/shop/src/lib/api.ts`
   - Native `fetch` only (no axios — bundle budget F-16); helper
     `getPublicJson<T>(path: string): Promise<T>`; always `credentials: 'omit'`
     (the customer surface must never send cookies — M2.D-68 defence in depth) and
     `headers: { Accept: 'application/json' }`.
   - Relative URL (`/api/public/health`) so dev goes through the Vite `/api` proxy and prod is
     same-origin on `order.<domain>`.
   - Error mapping helper `messageFromError(body: unknown): string` implementing the
     INTERFACE-STANDARDS priority chain: `error.user_message` → `error.message` → `message` →
     network fallback. Never surface `Response.statusText` / `HTTP 500` text.
   - Network fallback copy in Vietnamese (`Không có mạng — kiểm tra kết nối rồi thử lại.`) per
     FOUNDATION §9.4 (`i18n: vi only`); note in a comment that this is the localized form of
     INTERFACE-STANDARDS `network_fallback`.
2. `apps/shop/src/components/ShareLocationButton.tsx`
   - Header comment: `// TODO(phase-08): XOÁ — nút tạm chỉ để verify Permissions-Policy (M2.D-69).`
   - `navigator.geolocation.getCurrentPosition(ok, err, { timeout: 10000 })`; on success show
     `lat.toFixed(4)`, `lng.toFixed(4)`; on `err.code === err.PERMISSION_DENIED` show
     `Quyền vị trí bị chặn — kiểm tra Permissions-Policy trên máy chủ.` (this exact hint is the
     production diagnosis for G-05); handle `!('geolocation' in navigator)` separately.
   - Loading state disables the button while pending, cleared in `finally`
     (INTERFACE-STANDARDS `loading_rule`). Button min 44×44 (`--tap-min`).
3. `apps/shop/src/pages/HomePage.tsx`
   - Named export `HomePage`; heading + one line of copy; the health-check button rendering
     `data.status` / `data.db` / `data.uptime_s` from the `{ok:true,data:{…}}` envelope;
     `<ShareLocationButton />`; `<Link to="/cart">` placeholder link.
   - Errors render through `messageFromError` into an inline banner using
     `--danger-600` / `--danger-100`, never `console.log` only.
   - Token-only styling, no raw hex.

**Acceptance criteria:**
- [ ] Clicking `home-health-check-btn` in dev shows `status: ok, db: up` parsed from
      `data`, not from the raw response object.
- [ ] Stopping MySQL then clicking shows `degraded / down` (still 200, no error banner).
- [ ] Killing the API then clicking shows the Vietnamese network fallback — not
      `Failed to fetch`, not `500`, not `Internal Server Error`.
- [ ] Clicking `home-share-location-btn` on `http://localhost:5174` (a secure context) prints
      lat/lng after the browser prompt; denying shows the Permissions-Policy hint copy.
- [ ] `credentials: 'omit'` present in `api.ts`; no `document.cookie` anywhere in `apps/shop/src`.
- [ ] `grep -rniE 'dashboard|kitchen' apps/shop/src` still empty.
- [ ] The temporary button carries a `TODO(phase-08)` removal marker.

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
corepack pnpm db:up
corepack pnpm --filter @order/api dev & sleep 8
corepack pnpm --filter @order/shop dev &                  # http://localhost:5174
# Browser: open http://localhost:5174 → click both buttons; then deny location and re-click.
curl -s -H 'Accept: application/json' http://localhost:5174/api/public/health | jq .   # via Vite proxy
grep -n "credentials: 'omit'" apps/shop/src/lib/api.ts
grep -rn 'TODO(phase-08)' apps/shop/src/components/ShareLocationButton.tsx
grep -rn 'document.cookie' apps/shop/src/ && echo 'FAIL' || echo 'OK: no cookie access'
kill %1 %2
```

**Note on G-05:** localhost is a secure context, so a green result here proves only that the
client code is correct. The header that actually breaks it lives in `Caddyfile` (Task 11) and can
only be confirmed on real HTTPS — G-05 stays **DEFERRED** (Task 14, `## Risks`).

### Task 08 — `main.ts`: `/api/*` passthrough as first statement + host-based static root
<!-- vg-binding: SPECS:success-criteria -->
<!-- vg-binding: INTERFACE-STANDARDS:error-shape -->
<wave>3</wave>
<implements-decision>M2.D-66</implements-decision>
<implements-decision>M2.D-65</implements-decision>
<file-path>apps/api/src/main.ts</file-path>
<design-ref>no-asset:api-middleware-task-no-ui-surface</design-ref>
<goals-covered>G-01,G-09,G-07</goals-covered>
<estimated-loc>70</estimated-loc>

Covers goal: G-01, G-09, G-07

**Description:** One container, two frontends. Rewrite the production static block in `main.ts`
so (a) `/api/*` is handed to the router **before** anything else — today the `wantsHtml` branch
(`main.ts:50-55`) runs first and `apiPrefixes` (`main.ts:46`) has no `/api`, so every
`GET /api/public/*` returns the POS `index.html` **in production only**; and (b) the static root
is chosen per request from the `Host` header (`order.` prefix → `shop-dist`, everything else →
`web-dist`, M2.D-66). This is the highest-regression-risk task in the phase: every POS page load
goes through this middleware.

**Read first:** `apps/api/src/main.ts:33-61` line by line, plus
`apps/web/src/App.tsx:29-66` (the POS routes that depend on the SPA fallback: `/orders`,
`/kitchen`, `/menu`, `/tables`, `/history`, `/dashboard`, `/admin/*`).

**Steps:**
1. **Remove** `app.useStaticAssets(webDist)` (`main.ts:41`). This is mandatory, not cosmetic:
   a global static root serves `web-dist/index.html` and `web-dist/assets/*` for **every** host,
   so `order.<domain>/` would keep getting the POS shell no matter what the middleware decides.
2. Keep `app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' })`
   (`main.ts:35`) **above** the new middleware — that ordering is what keeps
   `order.<domain>/uploads/menu/<file>` working (G-11) once Caddy proxies the whole subdomain.
3. Add `import express from 'express';` (dependency declared in Task 03) and replace the block
   with exactly this shape:
   ```ts
   const webDist = join(process.cwd(), 'web-dist');
   const shopDist = join(process.cwd(), 'shop-dist');
   if (process.env.NODE_ENV === 'production' && existsSync(webDist)) {
     const hasShop = existsSync(shopDist);
     const webStatic = express.static(webDist, { index: false });
     const shopStatic = express.static(shopDist, { index: false });
     const apiPrefixes = ['/auth', '/admin', '/setup', '/health', '/menu', '/menu-groups', '/tables', '/orders', '/uploads'];
     app.use((req: Request, res: Response, next: NextFunction) => {
       // MUST stay the first statement: /api/* never gets the SPA shell (F2, G-09).
       if (req.path === '/api' || req.path.startsWith('/api/')) return next();
       // uploads are served by useStaticAssets above; never rewrite them to index.html.
       if (req.path === '/uploads' || req.path.startsWith('/uploads/')) return next();
       if (req.method !== 'GET') return next();
       const isShopHost = hasShop && (req.headers.host ?? '').toLowerCase().startsWith('order.');
       const dist = isShopHost ? shopDist : webDist;
       const serveStatic = isShopHost ? shopStatic : webStatic;
       if (req.path.includes('.')) return serveStatic(req, res, next);   // hashed assets, favicon
       const wantsHtml = (req.headers.accept || '').includes('text/html');
       if (wantsHtml) return res.sendFile(join(dist, 'index.html'));
       if (apiPrefixes.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
       res.sendFile(join(dist, 'index.html'));
     });
   }
   ```
4. Behaviour contracts to preserve verbatim: the `wantsHtml` SPA fallback for POS routes that
   collide with API names (the `main.ts:43-45` bug fix comment must survive, re-worded, not
   deleted); `app.set('etag', false)`; body-parser limits; middleware registration order
   (request-id → CSRF → pipes → filter) untouched.
5. `hasShop === false` (e.g. an older image without `shop-dist`) must degrade to `web-dist`
   for every host — never 500, never blank.
6. Keep `apiPrefixes` exactly as it is. Do **not** add `'/api'` to it: the passthrough above
   already covers `/api/*`, and mutating the array would change POS fallback behaviour.
7. Reject nothing new at this layer — error bodies keep coming from `GlobalExceptionFilter`
   (INTERFACE-STANDARDS legacy compact shape), so a missing asset still ends as a router 404
   JSON, not an HTML error page.

**Acceptance criteria (production mode, `NODE_ENV=production`, both dists staged):**
- [ ] `GET /` with `Host: order.quanbalun.site` + `Accept: text/html` → shop `index.html`
      (`<title>Quán Bà Lùn — Đặt hàng</title>`).
- [ ] `GET /` with `Host: quanbalun.site` and with `Host: www.quanbalun.site` → POS
      `index.html` (`<title>Order Quán Bà Lùn</title>`).
- [ ] `GET /api/public/health` with `Accept: text/html` → **JSON** `{"ok":true,...}` (G-09).
- [ ] `GET /api/public/health` with `Accept: application/json` → same JSON, 200.
- [ ] `GET /orders` with `Accept: text/html` and `Host: quanbalun.site` → POS `index.html`
      (POS reload behaviour unchanged, G-07).
- [ ] `GET /orders` with `Accept: application/json` → API JSON/401, not HTML (G-07).
- [ ] `GET /health` → JSON unchanged.
- [ ] A shop hashed asset (`/assets/<hash>.js` with `Host: order.…`) returns 200 `application/javascript`;
      the same path with `Host: quanbalun.site` returns 404 (roots are truly separate).
- [ ] `GET /uploads/menu/does-not-exist.jpg` → 404, **not** `index.html`.
- [ ] With `shop-dist` deleted, `Host: order.…` still returns the POS shell instead of an error.

**Verify (local, no VPS):** Task 12's script automates the whole matrix; the minimal manual form:
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
corepack pnpm db:up
corepack pnpm build
rm -rf apps/api/web-dist apps/api/shop-dist
cp -R apps/web/dist apps/api/web-dist && cp -R apps/shop/dist apps/api/shop-dist
(cd apps/api && NODE_ENV=production API_PORT=3099 node dist/main.js &) ; sleep 8
curl -s -H 'Host: order.quanbalun.site' -H 'Accept: text/html' localhost:3099/ | grep -o '<title>[^<]*'
curl -s -H 'Host: quanbalun.site'       -H 'Accept: text/html' localhost:3099/ | grep -o '<title>[^<]*'
curl -s -H 'Accept: text/html' localhost:3099/api/public/health | head -c 120; echo
curl -s -H 'Accept: text/html' -H 'Host: quanbalun.site' localhost:3099/orders | grep -o '<title>[^<]*'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3099/uploads/menu/nope.jpg
pkill -f 'node dist/main.js'
```

### Task 09 — CSRF: exact-origin allow-list, `/api/admin/` coverage, `/api/public/` exclusion
<!-- vg-binding: SPECS:success-criteria -->
<!-- vg-binding: INTERFACE-STANDARDS:error-shape -->
<wave>3</wave>
<implements-decision>M2.D-67</implements-decision>
<implements-decision>M2.D-68</implements-decision>
<file-path>apps/api/src/common/middleware/csrf-origin.middleware.ts</file-path>
<file-path>.env.production.example</file-path>
<file-path>.env.example</file-path>
<goals-covered>G-10,G-04,G-07</goals-covered>
<estimated-loc>85</estimated-loc>

Covers goal: G-10, G-04, G-07

**Description:** Fix a live subdomain-takeover-class hole and widen coverage. Verified today:
`csrf-origin.middleware.ts:35` uses `origin.startsWith(allowed)`, and
`'https://quanbalun.site.evil.com'.startsWith('https://quanbalun.site') === true` — an attacker
domain passes. Also `pathRequiresCheck` (`:10`) only covers `/admin/` and `/auth/`, so
`PUT /api/admin/settings` (phase 08) would ship unchecked. Turn `ALLOWED_ORIGIN` into a
comma-separated list compared by **exact origin equality**, extend coverage to `/api/admin/`, and
explicitly exclude `/api/public/` so header-less `curl` testing keeps working (phase 08 depends on it).

**Read first:**
- `apps/api/src/common/middleware/csrf-origin.middleware.ts` (whole file, 43 lines)
- `apps/api/src/modules/auth/jwt.service.ts:53-61` (`cookieOptions` — host-only, `sameSite: 'strict'`,
  **do not touch**: M2.D-68)
- `apps/api/src/common/filters/global-exception.filter.ts` (`CSRF_ORIGIN_MISMATCH` → friendly VN copy)
- `docker-compose.prod.yml` (`ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}` already passed through — no compose change needed)

**Steps:**
1. Parse the list once per request from env (env is read at request time today; keep that so
   tests can change it between boots):
   ```ts
   function parseAllowedOrigins(raw: string | undefined): string[] {
     return (raw ?? 'http://localhost:5173')
       .split(',')
       .map((s) => s.trim().replace(/\/+$/, ''))
       .filter(Boolean);
   }
   ```
2. Normalize the incoming header to an origin, then compare with `===` semantics
   (`Array.prototype.includes`) — never `startsWith`:
   ```ts
   function originOf(value: string): string | null {
     try { return new URL(value).origin; } catch { return null; }
   }
   ```
   `Origin` is already an origin; `Referer` carries a path — `new URL(referer).origin` strips it,
   which is precisely why exact matching is now safe for both headers.
3. `pathRequiresCheck` — order matters, most specific first:
   ```ts
   if (path.startsWith('/api/public/')) return false;   // curl has no Origin header (phase 08 tests)
   if (path.startsWith('/api/admin/')) return true;     // was uncovered
   if (path.startsWith('/admin/')) return true;
   if (path.startsWith('/auth/')) { /* /auth/login + /auth/recover stay exempt — unchanged */ }
   return false;
   ```
   Preserve the existing `/auth/login` + `/auth/recover` exemptions verbatim (POS login must keep
   working — G-07) and their explanatory comments.
4. Error responses keep `code: 'CSRF_ORIGIN_MISMATCH'` so `GlobalExceptionFilter` maps it to the
   existing Vietnamese copy (INTERFACE-STANDARDS: legacy compact error shape, stable `error.code`).
   Change the message to a generic form — do **not** echo the request Origin or the allow-list back
   to the caller (reflection + config disclosure).
5. `.env.production.example` — replace the `ALLOWED_ORIGIN` guidance with the 3-origin list and a
   comment that exact matching means the scheme+host+port must match character for character:
   `ALLOWED_ORIGIN=https://quanbalun.site,https://www.quanbalun.site,https://order.quanbalun.site`
   (`www.` is a real site block in `Caddyfile:5`, so omitting it would break POS on `www.`).
   Keep the existing `DOMAIN=` key untouched.
6. `.env.example` — local list: `ALLOWED_ORIGIN=http://localhost:5173,http://localhost:5174`
   (5174 = shop dev server from Task 01).
7. Do not touch `jwt.service.ts`. Cookies stay host-only with no `domain` attribute (M2.D-68) —
   Task 13 asserts this rather than changing it.

**Acceptance criteria (production mode, `ALLOWED_ORIGIN` = the 3-origin list):**
- [ ] `POST /admin/users` with `Origin: https://order.quanbalun.site.evil.com` → **403**
      `CSRF_ORIGIN_MISMATCH` (the `startsWith` hole is closed).
- [ ] Same request with each of the three real origins → **not 403** (401/404 is fine — it means
      the origin check passed and routing/auth took over).
- [ ] `PUT /api/admin/settings` with a forged origin → **403**; with a real origin → **404**
      (route does not exist yet in phase 07 — the 403→404 flip is the proof the path is now covered).
- [ ] `POST /api/public/anything` with **no** `Origin` and no `Referer` → not 403 (404 expected).
- [ ] `POST /auth/login` with no `Origin` → not 403 (unchanged exemption; POS login unaffected).
- [ ] `POST /admin/users` with `Referer: https://quanbalun.site/admin/users` (no `Origin`) → not 403.
- [ ] `POST /orders` from the POS origin → unchanged behaviour (not in the checked path set, G-07).
- [ ] Trailing-slash and whitespace tolerance: `ALLOWED_ORIGIN=" https://quanbalun.site/ "`
      still matches `https://quanbalun.site`.
- [ ] 403 body contains no request Origin echo and no allow-list contents.

**Verify (local, no VPS):** Task 13's script automates the matrix; the minimal manual form:
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
node -e "console.log('https://quanbalun.site.evil.com'.startsWith('https://quanbalun.site'))"   # true = the old bug
node -e "console.log(new URL('https://quanbalun.site.evil.com').origin === 'https://quanbalun.site')"  # false = fixed
corepack pnpm db:up && corepack pnpm --filter @order/api build
(cd apps/api && NODE_ENV=production API_PORT=3099 \
  ALLOWED_ORIGIN='https://quanbalun.site,https://www.quanbalun.site,https://order.quanbalun.site' \
  node dist/main.js &) ; sleep 8
curl -s -o /dev/null -w 'evil=%{http_code}\n' -X POST -H 'Origin: https://order.quanbalun.site.evil.com' localhost:3099/admin/users
curl -s -o /dev/null -w 'real=%{http_code}\n' -X POST -H 'Origin: https://order.quanbalun.site'          localhost:3099/admin/users
curl -s -o /dev/null -w 'apiadmin-evil=%{http_code}\n' -X PUT -H 'Origin: https://x.evil.com' localhost:3099/api/admin/settings
# CrossAI finding #5: /api/public/ping KHONG ton tai -> 404 tu router, khong chung minh
# duoc CSRF exclusion. Dung endpoint that tu Task 04.
curl -s -o /dev/null -w 'public-noorigin=%{http_code}\n' \
  -X POST -H 'Content-Type: application/json' -d '{}' localhost:3099/api/public/health
curl -s -o /dev/null -w 'login-noorigin=%{http_code}\n' -X POST localhost:3099/auth/login
pkill -f 'node dist/main.js'
```

### Task 10 — Shop app shell: router with all 5 routes + global styles
<!-- vg-binding: SPECS:success-criteria -->
<wave>4</wave>
<implements-decision>M2.D-64</implements-decision>
<file-path>apps/shop/src/main.tsx</file-path>
<file-path>apps/shop/src/App.tsx</file-path>
<file-path>apps/shop/src/styles/global.css</file-path>
<goals-covered>G-02,G-01,G-08</goals-covered>
<design-ref>no-asset:phase-07-no-design-manifest-router-shell-only</design-ref>
<!-- design-ref rationale: shell is a token-driven placeholder; the lotteria-style header/rail/sticky-CTA shell is phase 08 -->
<estimated-loc>140</estimated-loc>
<test_ids>
  <id kind="link" value="shell-nav-home-link">Bottom nav → /</id>
  <id kind="link" value="shell-nav-cart-link">Bottom nav → /cart</id>
  <id kind="link" value="shell-nav-history-link">Bottom nav → /history</id>
</test_ids>

Covers goal: G-02, G-01, G-08

**Description:** Replace the Task 01 placeholder mount with the real shell: `BrowserRouter` +
the five routes named in SPECS (`/`, `/cart`, `/checkout`, `/o/:token`, `/history`) + a catch-all,
plus the global stylesheet that imports `tokens.css`. This is what makes the built bundle contain
a route table — the artefact G-02 greps — and it must contain **only** customer routes.

**Read first:**
- `apps/web/src/main.tsx` (mount pattern to mirror) — but **not** `apps/web/src/App.tsx` route
  guards: the shop has no auth, no `RoleGate`, no `HomeRedirect`.
- `apps/shop/src/pages/*.tsx` (Tasks 05 + 07 — all five components already exist)
- `apps/shop/src/styles/tokens.css` (`--bg-page`, `--font-body`, `--fs-base`, `--tap-min`,
  `--safe-bottom`, `--sticky-cta-h`, `--z-sticky-cta`, `--focus-outline`, `--focus-offset`)
- `apps/shop/DESIGN.md` §1 (sticky bottom action must respect `env(safe-area-inset-bottom)`)

**Steps:**
1. `apps/shop/src/styles/global.css`
   - First line `@import './tokens.css';` (tokens must load before any rule that consumes them).
   - `*, *::before, *::after { box-sizing: border-box; }`; `html { -webkit-text-size-adjust: 100%; }`
     (iOS zoom guard); `body { margin: 0; background: var(--bg-page); color: var(--text-body);
     font-family: var(--font-body); font-size: var(--fs-base); line-height: var(--lh-normal); }`.
   - `h1, h2 { font-family: var(--font-display); line-height: var(--lh-tight); }`.
   - `:focus-visible { outline: var(--focus-outline); outline-offset: var(--focus-offset); }`
     (keyboard/assistive users — mobile-only design still needs a focus ring).
   - `body { padding-bottom: calc(var(--sticky-cta-h) + var(--safe-bottom)); }` so the bottom nav
     never covers content.
   - No `@font-face` and no Google Fonts `<link>` in this phase: remote font loading is a
     phase-08 performance/`Referrer-Policy` decision. The token font stacks fall back to
     system fonts — acceptable for placeholders.
2. `apps/shop/src/App.tsx` — named export `App`; `<Routes>` with
   `/` → `HomePage`, `/cart` → `CartPage`, `/checkout` → `CheckoutPage`,
   `/o/:token` → `OrderTrackPage`, `/history` → `HistoryPage`, `*` → an inline
   `NotFound` ("Không tìm thấy trang" + link home). Static imports (not `React.lazy`) — 5 tiny
   placeholders, code splitting is a phase-08 concern once real screens exist.
   Below `<Routes>` render a 3-link bottom nav (`position: fixed; bottom: 0`), each link
   `min-height: var(--tap-min)`, carrying the `data-testid` values declared above.
3. `apps/shop/src/main.tsx` — replace the placeholder body with `StrictMode` + `BrowserRouter` +
   `<App />`, importing `./styles/global.css` (drop the direct `tokens.css` import — `global.css`
   pulls it in). Keep the `#root not found` throw pattern from `apps/web/src/main.tsx`.
   Remove the `TODO(task-10)` marker.
4. Route strings must stay customer-only. No `/dashboard`, `/kitchen`, `/menu`, `/tables`,
   `/admin/*`, `/setup`, `/login` — the whole point of M2.D-64 is that the public JS reveals
   nothing about the POS route surface.

**Acceptance criteria:**
- [ ] `corepack pnpm --filter @order/shop build` exits 0; `apps/shop/dist/index.html` +
      hashed assets emitted.
- [ ] `grep -rE '/dashboard|/kitchen' apps/shop/dist/assets/*.js` → **no match** (G-02).
- [ ] Route strings present in the bundle are only `/`, `/cart`, `/checkout`, `/o/`, `/history`.
- [ ] Largest JS chunk of route `/` is ≤ 150KB **gzipped** (FOUNDATION §9.6 `fe_route_kb`).
- [ ] Dev: all five routes render; a hard reload on `/o/abc123` still renders (dev SPA fallback).
- [ ] `apps/web/dist` untouched by the shop build; `corepack pnpm build` at root builds both apps
      and the second consecutive run reports full turbo cache hits (G-08).
- [ ] No `<link href="https://fonts.…">` in `index.html` (no third-party request from the
      customer page in this phase).

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
corepack pnpm build                       # both apps via turbo
grep -rE '/dashboard|/kitchen' apps/shop/dist/assets/*.js && echo 'FAIL: POS route in bundle' || echo 'OK: clean bundle'
for f in apps/shop/dist/assets/*.js; do printf '%s %s bytes gzip\n' "$f" "$(gzip -c "$f" | wc -c)"; done
grep -o '<title>[^<]*' apps/shop/dist/index.html apps/web/dist/index.html
grep -c 'fonts.googleapis\|fonts.gstatic' apps/shop/dist/index.html    # expect 0
corepack pnpm build | tail -5             # expect ">>> FULL TURBO" / cache hits, no rebuild
corepack pnpm --filter @order/shop dev &  # manual: visit /, /cart, /checkout, /o/abc123, /history
```

### Task 11 — `Caddyfile`: second site block `order.{$DOMAIN}` with `geolocation=(self)` + `no-referrer`
<!-- vg-binding: SPECS:success-criteria -->
<wave>4</wave>
<implements-decision>M2.D-65</implements-decision>
<implements-decision>M2.D-69</implements-decision>
<implements-decision>M2.D-66</implements-decision>
<file-path>Caddyfile</file-path>
<goals-covered>G-11,G-05,G-06,G-01</goals-covered>
<estimated-loc>32</estimated-loc>

Covers goal: G-11, G-05, G-06, G-01

**Description:** Add the customer subdomain as its own Caddy site block, proxying to the very
same `api:3001` container (one container, host-based static selection happens in `main.ts`,
M2.D-66). The block differs from the apex block in exactly two headers: `geolocation=(self)`
instead of `geolocation=()` (the apex block's `Permissions-Policy` at `Caddyfile:23` blocks the
Geolocation API outright — M2.D-69), and `Referrer-Policy: no-referrer` so the secret
`/o/<order_token>` URL never leaks in a `Referer` header to any third-party asset.

**Read first:** `Caddyfile` (single site block, 28 lines), `docker-compose.prod.yml` caddy service
(mounts `./Caddyfile` read-only, receives `DOMAIN` env, ports 80/443/443-udp),
`.env.production.example:8` (`DOMAIN=`).

**Steps:**
1. Leave the existing `{$DOMAIN}, www.{$DOMAIN}` block **byte-identical** — it keeps
   `Permissions-Policy "geolocation=(), camera=(self), microphone=()"` and
   `Referrer-Policy "strict-origin-when-cross-origin"`. Any edit there is an `apps/web`
   behaviour change (SPECS Out of Scope).
2. Append a new block:
   ```caddyfile
   # Trang khách (M2.D-65). Cùng container api:3001 — main.ts chọn shop-dist theo Host.
   order.{$DOMAIN} {
       log {
           output stdout
           format console
       }

       reverse_proxy api:3001 {
           header_up X-Real-IP {remote_host}
           header_up X-Forwarded-For {remote_host}
           header_up X-Forwarded-Proto {scheme}
       }

       header {
           Strict-Transport-Security "max-age=31536000; includeSubDomains"
           X-Frame-Options "DENY"
           X-Content-Type-Options "nosniff"
           # /o/<order_token> là bí mật nằm trong URL — không rò qua Referer.
           Referrer-Policy "no-referrer"
           # M2.D-69: apex chặn geolocation=(); trang khách BẮT BUỘC (self).
           Permissions-Policy "geolocation=(self), camera=(), microphone=()"
       }

       encode zstd gzip
   }
   ```
3. `/uploads/*` needs **no** `handle` block: the whole subdomain is reverse-proxied, so
   `order.<domain>/uploads/menu/<file>` reaches `useStaticAssets('uploads', {prefix:'/uploads/'})`
   in the API (which is why Task 08 keeps that registration above the new middleware). Add a
   one-line comment recording this so nobody "optimises" it into a `file_server` later.
4. Header-inheritance check: Caddy site blocks do not inherit from each other, so every header the
   customer surface needs must be listed in the new block (HSTS included — the apex block's
   `includeSubDomains` only instructs browsers; the subdomain still serves its own header and
   still needs a valid cert).
5. No change to `docker-compose.prod.yml`: the caddy service already mounts this file and takes
   `DOMAIN`. **No deploy** — the file change is local-only (P08.D-72).

**Acceptance criteria:**
- [ ] `caddy validate` passes with `DOMAIN=quanbalun.site`.
- [ ] Adapted JSON shows **two** server routes/hosts groups: `quanbalun.site`+`www.quanbalun.site`
      and `order.quanbalun.site`.
- [ ] In the adapted config the `order.` block has `Permissions-Policy: geolocation=(self), …`
      and `Referrer-Policy: no-referrer`.
- [ ] The apex block still has `geolocation=()` and `strict-origin-when-cross-origin` (unchanged).
- [ ] Both blocks proxy to upstream `api:3001`; the `order.` block has no `file_server` and no
      separate `/uploads` handler.
- [ ] `git diff Caddyfile` shows additions only — zero modified lines inside the apex block.

**Verify (local, no VPS — Caddy is only validated, never started against the server):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -e DOMAIN=quanbalun.site \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -e DOMAIN=quanbalun.site \
  caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null \
  | jq -r '.apps.http.servers[].routes[].match[].host[]' | sort
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -e DOMAIN=quanbalun.site \
  caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null \
  | jq '..|objects|select(.header?)|.header' | grep -E 'geolocation|Referrer-Policy'
git diff --stat Caddyfile
```

**Note on G-06 / G-11:** the real assertions (`curl -I https://order.<domain>` → valid
Let's Encrypt cert, HTTP/2, `Referrer-Policy: no-referrer` on the wire, and a real
`/uploads/menu/<file>` image) require the deployed VPS and DNS. They are **DEFERRED** to Task 14.

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

### Task 13 — Local security/plumbing verification script: CSRF matrix + host-only cookie + image build
<!-- vg-binding: SPECS:success-criteria -->
<!-- vg-binding: INTERFACE-STANDARDS:error-shape -->
<wave>5</wave>
<implements-decision>M2.D-67</implements-decision>
<implements-decision>M2.D-68</implements-decision>
<file-path>scripts/verify-phase07-security.sh</file-path>
<goals-covered>G-10,G-04,G-12,G-03,G-11</goals-covered>
<estimated-loc>180</estimated-loc>

Covers goal: G-10, G-04, G-12, G-03, G-11

**Description:** Second half of the local verification harness: the CSRF origin matrix (including
the forged `…evil.com` origin that passes today), the static assertion that JWT cookies stay
host-only (M2.D-68 — the reason the admin token never reaches the customer subdomain), the Docker
image plumbing check for `packages/utils` (G-12), and the Caddy config assertions that can be made
without a server (G-11 config half). Everything runs on this machine; nothing is deployed.

**Read first:** `apps/api/src/common/middleware/csrf-origin.middleware.ts` (post-Task-09),
`apps/api/src/modules/auth/jwt.service.ts:53-61`, `apps/api/src/common/filters/global-exception.filter.ts`
(`CSRF_ORIGIN_MISMATCH` copy), `Dockerfile` (post-Task-06), `Caddyfile` (post-Task-11).

**Steps:**
1. Same harness conventions as `verify-phase07-routing.sh`: `set -euo pipefail`, repo-root `cd`,
   `pass()/fail()` counters, `trap` cleanup, non-zero exit on any failure, explicit
   "never touches the VPS" preamble.
2. **Section A — exact-origin unit proof** (no server needed):
   ```bash
   node -e "process.exit('https://quanbalun.site.evil.com'.startsWith('https://quanbalun.site') ? 0 : 1)"  # documents the old bug
   node -e "process.exit(new URL('https://quanbalun.site.evil.com').origin === 'https://quanbalun.site' ? 1 : 0)"  # documents the fix
   ```
3. **Section B — live CSRF matrix.** Boot the built API in production mode, port 3099,
   `ALLOWED_ORIGIN='https://quanbalun.site,https://www.quanbalun.site,https://order.quanbalun.site'`
   (mysql via local `docker compose up -d mysql`). Assert:

   | # | Request | Expect | Goal |
   |---|---|---|---|
   | 1 | `POST /admin/users`, `Origin: https://order.quanbalun.site.evil.com` | 403 + `error.code == CSRF_ORIGIN_MISMATCH` | G-10 |
   | 2 | `POST /admin/users`, `Origin: https://quanbalun.site` | ≠ 403 | G-10 |
   | 3 | `POST /admin/users`, `Origin: https://www.quanbalun.site` | ≠ 403 | G-10 |
   | 4 | `POST /admin/users`, `Origin: https://order.quanbalun.site` | ≠ 403 | G-10 |
   | 5 | `POST /admin/users`, `Referer: https://quanbalun.site/admin/users` (no Origin) | ≠ 403 | G-10 |
   | 6 | `POST /admin/users`, no Origin & no Referer | 403 (unchanged rule) | G-10 |
   | 7 | `PUT /api/admin/settings`, forged origin | 403 | G-10 |
   | 8 | `PUT /api/admin/settings`, real origin | 404 (path now checked, route not built yet) | G-10 |
   | 9 | `POST /api/public/ping`, no Origin (curl) | ≠ 403 → 404 | G-10, G-04 |
   | 10 | `POST /auth/login`, no Origin | ≠ 403 | G-07 |
   | 11 | `GET /api/public/health`, `Origin: https://order.quanbalun.site` | 200 `{"ok":true,…}` | G-04 |
   | 12 | 403 body from row 1 | contains `error.code` + `error.message` + `request_id`; contains **no** allow-list and no echoed Origin | INTERFACE-STANDARDS error shape |
   Parse bodies with `jq -r '.error.code'` — this also freezes the legacy compact error envelope
   that phase 08 (P08.D-60) will snapshot.
4. **Section C — host-only cookie assertion (G-03 static half).** Grep
   `apps/api/src/modules/auth/jwt.service.ts`: must contain `sameSite: 'strict'`, must contain
   `httpOnly: true`, must **not** contain any `domain:` key in `cookieOptions`. Also grep the whole
   `apps/api/src` for `domain: '.` → must be empty. This is a guard against a future "fix" that
   makes the token domain-wide (M2.D-68 forbids it). Also assert `apps/shop/src` contains no
   `credentials: 'include'` and no `document.cookie`.
5. **Section D — image plumbing (G-12).** `docker build -t ordbl-phase07 .` (local build only),
   then in the image assert: `web-dist/index.html`, `shop-dist/index.html`,
   `../../packages/utils/dist/index.js`, `dist/main.js` all exist; the two `index.html` titles
   differ; `node --input-type=module -e "await import('@order/utils'); await import('@order/schemas')"`
   prints no `ERR_MODULE_NOT_FOUND`. Also assert `corepack pnpm install --frozen-lockfile` exits 0
   before the build (the `ERR_PNPM_OUTDATED_LOCKFILE` precondition).
6. **Section E — Caddy config assertions (G-11 config half).** `caddy validate` then `caddy adapt`
   via `docker run --rm caddy:2-alpine` with `DOMAIN=quanbalun.site`; assert host set contains all
   three hosts, the `order.` block carries `no-referrer` + `geolocation=(self)`, and the apex block
   still carries `geolocation=()`.
7. Final summary + explicit DEFERRED list (G-05, G-06, on-the-wire G-11, DevTools half of G-03)
   pointing at `DEFERRED-VPS-CHECKS.md`.

**Acceptance criteria:**
- [ ] `bash scripts/verify-phase07-security.sh` exits 0 after Tasks 01–11 and prints all 12 CSRF
      rows plus sections C/D/E as PASS with observed values.
- [ ] Row 1 fails the script if the forged origin ever returns anything other than 403 (i.e. the
      script would have caught today's bug).
- [ ] Section C fails if anyone adds `domain:` to `cookieOptions`.
- [ ] Section D fails if `packages/utils` is dropped from any Dockerfile stage.
- [ ] Script contains no `ssh`, no `deploy.sh`, no `git push`, no `docker-compose.prod.yml`.
- [ ] Total runtime under ~10 minutes on this machine (docker build dominates).

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
bash scripts/verify-phase07-security.sh ; echo "exit=$?"
grep -nE 'ssh |deploy\.sh|git push|docker-compose\.prod' scripts/verify-phase07-security.sh \
  && echo 'FAIL: script touches production' || echo 'OK: local-only'
grep -n "domain:" apps/api/src/modules/auth/jwt.service.ts && echo 'FAIL: cookie went domain-wide' || echo 'OK: host-only'
```

### Section E — `/uploads/` end-to-end với ảnh thật (thêm sau CrossAI finding #6)

Ma trận routing chỉ kiểm `/uploads/menu/nope.jpg` → 404 không phải HTML. Nó chứng minh path
không bị SPA fallback nuốt, nhưng **không** chứng minh `useStaticAssets` serve được file thật
với đúng content-type. Bổ sung test local:

```bash
# tao anh PNG 1x1 that (khong dung fixture ao)
mkdir -p apps/api/uploads/menu
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' \
  > apps/api/uploads/menu/__vg-test.png

# API o che do production, host order.
CT=$(curl -s -o /dev/null -w '%{content_type}' -H 'Host: order.quanbalun.site' \
       localhost:3099/uploads/menu/__vg-test.png)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: order.quanbalun.site' \
       localhost:3099/uploads/menu/__vg-test.png)
[ "$CODE" = "200" ] || { echo "FAIL /uploads: code=$CODE"; exit 1; }
case "$CT" in image/png*) : ;; *) echo "FAIL /uploads: content-type=$CT"; exit 1 ;; esac
echo "OK /uploads/menu/__vg-test.png -> 200 image/png"

# don sach
rm -f apps/api/uploads/menu/__vg-test.png
```

**Vẫn DEFERRED:** chặng Caddy → API (`https://order.<domain>/uploads/...`) cần cert thật,
xem Task 14. Test này chỉ chứng minh chặng API → filesystem.

### Task 14 — Deferred owner actions: DNS A record + HTTPS-only verification runbook (NOT executed)
<!-- vg-binding: SPECS:success-criteria -->
<wave>5</wave>
<manual>true</manual>
<implements-decision>M2.D-65</implements-decision>
<implements-decision>M2.D-69</implements-decision>
<implements-decision>M2.D-68</implements-decision>
<file-path>.vg/phases/07-ha-tang-trang-khach/DEFERRED-VPS-CHECKS.md</file-path>
<goals-covered>G-03,G-05,G-06,G-11</goals-covered>
<estimated-loc>110</estimated-loc>

Covers goal: G-03, G-05, G-06, G-11

**Description:** Write the runbook for the four success criteria that are **physically
unverifiable on this machine** — they need the real DNS record, a real Let's Encrypt cert and a
real browser on HTTPS. **The executor writes this document and nothing else.** It must not run
`./deploy.sh`, `git push`, `ssh`, or `docker compose -f docker-compose.prod.yml up`: the owner
forbade touching the production server (P08.D-72). The DNS change is a manual owner action at the
registrar, outside code entirely.

**Read first:** `.vg/phases/07-ha-tang-trang-khach/SPECS.md` § Success criteria (AC-Q3, AC-Q5,
AC-Q6 + the 2026-07-29 `Referrer-Policy` / `/uploads/` addendum), `DEPLOY.md`, `Caddyfile`
(post-Task-11), `.env.production.example` (post-Task-09).

**Steps — the document must contain, in order:**
1. **Header banner:** "KHÔNG DEPLOY trong phase 07 (P08.D-72). Tài liệu này chỉ để chủ quán chạy
   TAY sau khi tự quyết định deploy." Plus the state this phase leaves behind: all code/config
   changes are local commits on `feat/online-ordering`, nothing has been pushed or deployed.
2. **Step 0 — owner action, not automatable:** add DNS `A` record
   `order.quanbalun.site` → VPS IP at the registrar; wait for propagation; verify with
   `dig +short order.quanbalun.site` matching `dig +short quanbalun.site`. Note that
   `Caddyfile`'s apex HSTS uses `includeSubDomains`, so the subdomain **must** have a valid cert
   before any browser will load it over plain HTTP — there is no HTTP-only fallback path.
3. **Step 1 — deploy (owner decides when):** reference `./deploy.sh` + `.env.deploy` +
   `/deploy-vps` skill and the two env keys that must be set in `.env.production` first:
   `DOMAIN=quanbalun.site` and the 3-origin `ALLOWED_ORIGIN` from Task 09. State plainly that no
   task in this plan runs it.
4. **Deferred check D-1 → G-06 (AC-Q6):**
   `curl -I https://order.quanbalun.site` → expect `HTTP/2 200`, valid cert (add
   `curl -vI` cert-issuer line and `openssl s_client -connect order.quanbalun.site:443 -servername order.quanbalun.site` as the fallback probe).
5. **Deferred check D-2 → G-11:** the same `curl -I` must show `Referrer-Policy: no-referrer`
   **and** `Permissions-Policy: geolocation=(self), …`; and
   `curl -I https://order.quanbalun.site/uploads/menu/<một-file-thật>` → `200` with
   `content-type: image/*`. Include the command to list a real filename from the VPS uploads
   volume (owner runs it), and the expected failure mode if `main.ts` middleware ordering
   regressed (HTML instead of the image).
6. **Deferred check D-3 → G-05 (AC-Q5):** on a real phone browser open
   `https://order.quanbalun.site/`, tap "Chia sẻ vị trí", accept the permission prompt, expect
   lat/lng. Document both failure signatures: silent no-op / immediate `PERMISSION_DENIED` with no
   prompt ⇒ `Permissions-Policy` still `geolocation=()` (check which site block served the
   request); prompt appears but times out ⇒ device GPS, not our config.
7. **Deferred check D-4 → G-03 (AC-Q3):** log in to the POS at `https://quanbalun.site`, then open
   `https://order.quanbalun.site` in the same browser profile, DevTools → Network → any request →
   Request Headers must contain **no** `ssp_token` cookie. Cross-reference the local static half of
   this check (Task 13 Section C asserts `cookieOptions` has no `domain`).
8. **Rollback note:** if any deferred check fails, the recovery path is `git revert` of the phase-07
   commits + redeploy — the phase adds no DB migration, no schema change (`synchronize: true`,
   M2.D-07) and no data mutation, so rollback is code-only. The `order.` DNS record can stay.
9. **Sign-off table:** one row per deferred goal (G-03, G-05, G-06, G-11) with columns
   Check / Command / Expected / Observed / Date / Result, left blank for the owner to fill.

**Acceptance criteria:**
- [ ] `DEFERRED-VPS-CHECKS.md` exists with the banner, Step 0 (DNS), Step 1 (deploy reference),
      D-1..D-4, rollback note and an empty sign-off table.
- [ ] Every deferred check states the exact command, the expected output **and** the diagnostic
      meaning of each failure mode.
- [ ] The document explicitly names G-03, G-05, G-06, G-11 as DEFERRED and cross-links the local
      partial coverage (Task 11 config assertions, Task 13 Section C/E).
- [ ] No command in the document is executed by this task — the file is documentation only.
- [ ] Verified by grep that the executor ran nothing: no new entries in shell history is not
      checkable, so instead assert the working tree contains no deploy artefacts and
      `git log origin/main..HEAD` shows nothing pushed.

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
test -f .vg/phases/07-ha-tang-trang-khach/DEFERRED-VPS-CHECKS.md && echo 'runbook present'
grep -c 'G-03\|G-05\|G-06\|G-11' .vg/phases/07-ha-tang-trang-khach/DEFERRED-VPS-CHECKS.md
grep -n 'KHÔNG DEPLOY' .vg/phases/07-ha-tang-trang-khach/DEFERRED-VPS-CHECKS.md
git status --short          # expect only phase-07 files, no deploy side effects
git log --oneline -1        # expect the last commit is local; nothing pushed
```

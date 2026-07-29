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

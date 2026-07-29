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

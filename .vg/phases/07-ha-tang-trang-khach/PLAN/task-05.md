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

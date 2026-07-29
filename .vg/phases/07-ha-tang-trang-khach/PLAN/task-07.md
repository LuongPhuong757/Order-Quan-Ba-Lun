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

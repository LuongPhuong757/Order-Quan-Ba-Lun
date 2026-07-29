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

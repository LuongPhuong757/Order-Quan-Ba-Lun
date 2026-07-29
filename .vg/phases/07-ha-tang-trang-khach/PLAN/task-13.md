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

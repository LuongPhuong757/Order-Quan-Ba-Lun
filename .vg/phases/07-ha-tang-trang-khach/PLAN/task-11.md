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

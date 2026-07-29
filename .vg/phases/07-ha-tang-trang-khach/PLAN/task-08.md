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

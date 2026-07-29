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

> **HOÃN 2026-07-29 (chủ quán chốt).** Chưa sửa Dockerfile và chưa `docker build`.
> Lý do: chủ quán muốn kiểm mọi thứ ở local trước, và task này chỉ chứng minh được giá trị
> khi thực sự build image. **Phải làm trước Task 08** — Task 08 cần `shop-dist` tồn tại trong
> image mới kiểm được static-theo-Host ở chế độ production.
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

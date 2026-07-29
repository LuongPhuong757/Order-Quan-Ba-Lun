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

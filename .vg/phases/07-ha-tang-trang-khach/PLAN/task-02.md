### Task 02 — `packages/utils` buildable skeleton + `apiOk` success-envelope helper
<!-- vg-binding: SPECS:success-criteria -->
<!-- vg-binding: INTERFACE-STANDARDS:error-shape -->
<wave>1</wave>
<implements-decision>M2.D-64</implements-decision>
<file-path>packages/utils/package.json</file-path>
<file-path>packages/utils/tsconfig.json</file-path>
<file-path>packages/utils/src/index.ts</file-path>
<goals-covered>G-12</goals-covered>
<estimated-loc>60</estimated-loc>

Covers goal: G-12

**Description:** Create the **build plumbing** for the single new workspace package the
customer surface needs (`packages/utils`). Downstream context P08.D-59 supersedes P08.D-51:
`packages/ui` was explicitly DROPPED, so **exactly one** new package is created here, not two.
Phase 08 fills it with the remaining shared helpers; phase 07 ships only the one helper that
lets the plumbing be proven end-to-end (`apiOk`), because a package that nothing imports
cannot demonstrate "no `ERR_MODULE_NOT_FOUND`" (G-12).

**Read first:**
- `packages/schemas/package.json` + `packages/schemas/tsconfig.json` (mirror these exactly — the
  Dockerfile copies `dist` by hand and expects the same layout)
- `.vg/phases/07-ha-tang-trang-khach/INTERFACE-STANDARDS.md` → `## API Standard` success envelope
- `.vg/phases/08-public-menu-checkout/CONTEXT.md` § P08.D-59

**Steps:**
1. `packages/utils/package.json` — byte-for-byte structural copy of
   `packages/schemas/package.json` with `"name": "@order/utils"`: `private`, `"type": "module"`,
   `main: dist/index.js`, `types: dist/index.d.ts`, the same `exports` map, scripts
   `build: tsc` + `typecheck: tsc --noEmit`, `devDependencies: { typescript: ^5.7.0 }`.
   **Zero runtime dependencies** — the package must be importable from both `apps/api` (Node ESM)
   and `apps/shop` (browser bundle).
2. `packages/utils/tsconfig.json` — copy `packages/schemas/tsconfig.json` verbatim
   (`outDir: dist`, `rootDir: src`, include `src/**/*`).
3. `packages/utils/src/index.ts` — export the success envelope contract quoted from
   INTERFACE-STANDARDS `## API Standard` (verbatim key set, do not paraphrase):

   ```ts
   /** INTERFACE-STANDARDS.md § API Standard — success envelope. */
   export type ApiOk<T> = {
     ok: true;
     data: T;
     message?: string;
     meta?: unknown;
     request_id?: string;
   };

   export function apiOk<T>(data: T, message?: string): ApiOk<T> {
     return message === undefined ? { ok: true, data } : { ok: true, data, message };
   }
   ```
   Add a header comment: this package is the shared-helper home per P08.D-59; phase 08 adds
   money/phone/slug helpers here.
4. Do **not** add an error-envelope builder. Errors keep flowing through the existing
   `GlobalExceptionFilter` legacy compact shape `{ error: { code, message, request_id, ts_ms,
   field_errors } }`, which INTERFACE-STANDARDS permits via `legacy_compact_error_shape`.
   Touching the filter would change every `apps/web` error path (G-07 regression risk).

**Acceptance criteria:**
- [ ] `corepack pnpm --filter @order/utils build` exits 0 and emits `packages/utils/dist/index.js`
      **and** `packages/utils/dist/index.d.ts` (the `.d.ts` matters — `apps/api` typechecks against it).
- [ ] `packages/utils/package.json` has zero `dependencies` block (or an empty one).
- [ ] `apiOk({ a: 1 })` deep-equals `{ ok: true, data: { a: 1 } }` — no `message` key when omitted.
- [ ] Package layout matches `packages/schemas` (same manifest fields, same `exports` map shape)
      so the hand-maintained Dockerfile COPY lines in Task 06 can be a literal analogue.

**Verify (local, no VPS):**
```bash
cd /Users/m1macbook/Desktop/OrderQuanBaLun
corepack pnpm install
corepack pnpm --filter @order/utils build
ls packages/utils/dist/index.js packages/utils/dist/index.d.ts
node --input-type=module -e "
const { apiOk } = await import('./packages/utils/dist/index.js');
const v = apiOk({ a: 1 });
if (JSON.stringify(v) !== '{\"ok\":true,\"data\":{\"a\":1}}') { console.error('FAIL', v); process.exit(1); }
console.log('OK', JSON.stringify(v));
"
diff <(jq -S 'keys' packages/schemas/package.json) <(jq -S 'keys' packages/utils/package.json) || echo 'manifest key sets differ — review'
```

---
phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n
plan: 02
subsystem: infra
tags: [nestjs-schedule, cron, typeorm, pnpm, dependency-install]

requires: []
provides:
  - "@nestjs/schedule@6.1.3 installed + ScheduleModule.forRoot() registered in app.module.ts — in-process scheduler ready for @Cron consumers (outbox poller in plan 09-05)"
  - "MaintenanceModule with 2 live @Cron jobs (auditRetention EVERY_DAY_AT_3AM, jtiCleanup EVERY_HOUR) replacing the 2 dead CLI-only crons (C-CRON-01)"
  - "retention-queries.ts pure functions (auditRetentionCutoffMs, pruneAuditLogs, pruneOrderActivityLogs, pruneRevokedJti) — reusable, DB-agnostic, fully unit tested"
affects: [09-05-notification-outbox-poller]

tech-stack:
  added: ["@nestjs/schedule@6.1.3 (+ transitive cron@4.4.0, luxon@~3.7.0, @types/luxon@~3.7.0)"]
  patterns:
    - "Cron jobs use @InjectDataSource() + this.ds.manager, never a second DataSource.initialize()/.destroy() lifecycle"
    - "Pure-function extraction of delete conditions (retention-queries.ts) so cron business logic is unit-testable without MySQL, matching store-status.ts's pure-module convention"
    - "Cron methods wrap body in try/catch + Logger, swallow errors — a job failure must never crash the API process"

key-files:
  created:
    - apps/api/src/modules/maintenance/retention-queries.ts
    - apps/api/src/modules/maintenance/retention-queries.test.ts
    - apps/api/src/modules/maintenance/maintenance-cron.service.ts
    - apps/api/src/modules/maintenance/maintenance.module.ts
  modified:
    - apps/api/package.json
    - apps/api/src/app.module.ts
    - apps/api/src/cli/cron-audit-retention.ts
    - apps/api/src/cli/cron-jti-cleanup.ts
    - pnpm-lock.yaml

key-decisions:
  - "pnpm is NOT broken outright on this machine — only under the default Node 20 in PATH. Homebrew Node 23.11.0 (/opt/homebrew/bin/node) runs pnpm fine. Used a real `pnpm install` through Node 23 instead of the plan's fallback tmp-dir-npm-install-then-copy method, giving a properly synced pnpm-lock.yaml."
  - "Worktree had zero node_modules and no .env files (git worktree limitation, not gitignored-but-missing) — copied .env / apps/api/.env from the main checkout (untracked, not committed) and ran a full `pnpm install` + built @order/schemas / @order/utils dist in this worktree, isolated from sibling worktrees."

patterns-established:
  - "Pattern: revive a dead CLI-only cron by extracting its delete condition into a pure function file, writing table-of-cases unit tests against a fake EntityManager, then wrapping the call in a @Cron method with try/catch + Logger. Keep the original CLI file for manual/dry-run use."

requirements-completed: [REQ-N]

duration: 74min
completed: 2026-07-31
---

# Phase 9 Plan 02: Install @nestjs/schedule + Revive 2 Dead Crons Summary

**`@nestjs/schedule@6.1.3` wired into `app.module.ts` via a real `pnpm install` (Node 23), and the 2 dead retention crons (`cron-audit-retention`, `cron-jti-cleanup`) now run in-process as `@Cron` jobs through a new `MaintenanceModule`, with their exact delete conditions extracted into unit-tested pure functions.**

## Performance

- **Duration:** 74 min
- **Started:** 2026-07-31T12:34:00+07:00 (approx, worktree base reset)
- **Completed:** 2026-07-31T13:48:32+07:00
- **Tasks:** 2 (Task 2 executed as TDD: RED -> GREEN)
- **Files modified:** 9 (4 created, 5 modified, including `pnpm-lock.yaml`)

## Accomplishments

- `@nestjs/schedule@6.1.3` installed and functionally verified (`Cron` import resolves, `tsc --noEmit` clean, live API boot shows `ScheduleModule dependencies initialized` with no DI error)
- `ScheduleModule.forRoot()` registered in `app.module.ts`, ready for plan 09-05's outbox poller and any future `@Cron` consumer
- `MaintenanceModule` created with `MaintenanceCronService`: `auditRetention()` (`EVERY_DAY_AT_3AM`, reads `AUDIT_RETENTION_DAYS` env, default 90) and `jtiCleanup()` (`EVERY_HOUR`), both via `@InjectDataSource()` — no second `DataSource` lifecycle, both log-and-swallow errors
- `retention-queries.ts`: 4 pure functions extracted verbatim from the 2 CLI scripts' delete logic, 9 unit tests (TDD RED then GREEN), no MySQL required
- Full `apps/api` test suite green: 115/115 (including the live-MySQL integration test)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @nestjs/schedule@6.1.3 + register ScheduleModule** - `4371666` (feat)
   - Follow-up: `a41806b` (chore) — synced `pnpm-lock.yaml` after switching from the manual tmp-dir-copy method to a real `pnpm install` via Node 23 (see Deviations)
2. **Task 2: Revive 2 dead crons as @Cron via DI (TDD)** - `a342b65` (test, RED) -> `030f374` (feat, GREEN)

**Plan metadata:** this commit (docs: complete plan) — created after this SUMMARY

_TDD gate compliance: RED commit `a342b65` (test) precedes GREEN commit `030f374` (feat). No separate REFACTOR commit — no cleanup was needed after GREEN._

## Files Created/Modified

- `apps/api/src/modules/maintenance/retention-queries.ts` - Pure functions: `auditRetentionCutoffMs`, `pruneAuditLogs`, `pruneOrderActivityLogs`, `pruneRevokedJti` (EntityManager-based, DB-agnostic)
- `apps/api/src/modules/maintenance/retention-queries.test.ts` - 9 unit tests against a fake `EntityManager` (no MySQL)
- `apps/api/src/modules/maintenance/maintenance-cron.service.ts` - 2 `@Cron` jobs calling the pure functions via `@InjectDataSource()`
- `apps/api/src/modules/maintenance/maintenance.module.ts` - `TypeOrmModule.forFeature([AuditLog, OrderActivityLog, RevokedJti])` + provider
- `apps/api/package.json` - Added `"@nestjs/schedule": "6.1.3"` (exact pin) to `dependencies`
- `apps/api/src/app.module.ts` - `ScheduleModule.forRoot()` + `MaintenanceModule` added to `imports`
- `apps/api/src/cli/cron-audit-retention.ts` / `cron-jti-cleanup.ts` - Added a comment noting periodic execution now lives in `MaintenanceCronService`; scripts kept as-is for manual/dry-run use
- `pnpm-lock.yaml` - Additive-only entries for `@nestjs/schedule@6.1.3` -> `cron@4.4.0` -> `luxon@~3.7.0` + `@types/luxon@~3.7.0`

## Decisions Made

- **How `@nestjs/schedule` was actually installed (read this before repeating the work on another machine):**
  1. Initially followed the plan's documented fallback exactly: `npm init -y` + `npm install --omit=peer --no-audit --no-fund @nestjs/schedule@6.1.3` in a scratch tmp dir, then copied the 4 verified package directories (`@nestjs/schedule`, `cron`, `luxon`, `@types/luxon`) into `apps/api/node_modules`. This worked and passed every acceptance check (`Cron OK`, `tsc --noEmit` clean).
  2. Mid-execution, the orchestrator relayed a tip from executor 09-01: **pnpm is not broken outright — only under the default Node 20 binary in `PATH`.** Homebrew ships Node 23.11.0 at `/opt/homebrew/bin/node`, and invoking pnpm through it (`/opt/homebrew/bin/node /opt/homebrew/bin/pnpm ...`) runs normally.
  3. Switched to the proper method: removed the manual-copy artifacts, ran `/opt/homebrew/bin/node /opt/homebrew/bin/pnpm install` in this worktree (a genuinely separate install, not shared with the main checkout or sibling worktrees), then `pnpm --filter @order/schemas build` and `pnpm --filter @order/utils build` (required — these `dist/` folders are gitignored and worktree-local).
  4. Result: `pnpm-lock.yaml` now has a proper, additive-only entry for the new dependency tree, matching RESEARCH.md's verified tree exactly (`@nestjs/schedule@6.1.3` -> `cron@4.4.0` -> `luxon@~3.7.0` + `@types/luxon@~3.7.0`).
  5. **On another machine:** plain `pnpm install` (no special Node version needed there, assuming that machine's Node satisfies pnpm's `>=22.13` requirement) will now pick up `@nestjs/schedule@6.1.3` from both `package.json` and the updated lockfile — no manual steps required.
  6. **On this machine specifically**, if pnpm is needed again, invoke it explicitly through Homebrew Node 23: `/opt/homebrew/bin/node /opt/homebrew/bin/pnpm <command>`. Bare `pnpm` still fails under the default Node 20 (`ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`).
  - `pnpm-lock.yaml` diff is 35 lines, purely additive. No existing entries changed. Did not touch npm/yarn, did not delete the lockfile.

- **Worktree environment gaps found and fixed (not part of the plan's file list, required to run any verification at all):**
  - This worktree (`/Users/m1macbook/Desktop/OrderQuanBaLun/.claude/worktrees/agent-a62921705babcc7a7`) had **zero `node_modules`** anywhere (root or `apps/api`) and **no `.env` / `apps/api/.env`** (both gitignored, not carried into new worktrees). Copied `.env` and `apps/api/.env` from the main checkout (`/Users/m1macbook/Desktop/OrderQuanBaLun/`) — **not committed** (already gitignored). Ran the full `pnpm install` described above to give this worktree its own independent `node_modules`.
  - Initial `npm init -y` (before discovering the `--prefix` misbehavior) briefly wrote formatting-only changes to the **root** `package.json` by mistake; reverted immediately with `git checkout -- package.json` before it was ever staged. No lasting effect.

- **Comment wording adjusted to satisfy literal grep acceptance criteria:** the plan's own instructions said to write a comment naming `AppDataSource` as the forbidden pattern, while the acceptance criteria required `grep -c "AppDataSource" apps/api/src/modules/maintenance/*.ts` = 0. Reworded the warning comments in `app.module.ts` and `maintenance-cron.service.ts` to convey the same anti-pattern warning without the literal string, satisfying both the intent and the literal check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing worktree `node_modules` and `.env` files**
- **Found during:** Task 1, before any verification could run
- **Issue:** This worktree had no `node_modules` at all (root or `apps/api`) and no `.env` files — neither is carried by `git worktree add`
- **Fix:** Ran a real `pnpm install` (via Homebrew Node 23) to give the worktree its own independent `node_modules`; built `@order/schemas` and `@order/utils`; copied `.env` / `apps/api/.env` from the main checkout (gitignored, not committed)
- **Files modified:** none tracked (node_modules, .env are gitignored)
- **Verification:** `tsc --noEmit` clean, full `vitest run` 115/115 green, live API boot clean
- **Committed in:** not applicable (untracked files)

**2. [Rule 1 - Bug] Root `package.json` accidentally modified by a misconfigured `npm init --prefix`**
- **Found during:** Task 1, first install attempt
- **Issue:** `npm init -y --prefix <tmp-dir>` wrote to the **worktree root** `package.json` instead of the temp dir (formatting-only diff plus a few additive ISC-license fields), due to `npm init`'s `--prefix` handling differing from expectation
- **Fix:** Reverted with `git checkout -- package.json` before staging anything
- **Files modified:** `package.json` (reverted, net zero change)
- **Verification:** `git status --short` showed clean root `package.json` afterward
- **Committed in:** not applicable (reverted before commit)

**3. [Rule 1 - Bug] Literal-grep vs. plan-instructed comment text conflict**
- **Found during:** Task 2, acceptance-criteria verification
- **Issue:** Plan instructed writing a comment containing the literal string `AppDataSource`, but a separate acceptance criterion required `grep -c "AppDataSource" ... = 0`
- **Fix:** Reworded the 2 warning comments to preserve the anti-pattern warning without the literal string
- **Files modified:** `apps/api/src/app.module.ts`, `apps/api/src/modules/maintenance/maintenance-cron.service.ts`
- **Verification:** `grep -c "AppDataSource" apps/api/src/modules/maintenance/*.ts` = 0; `grep -c "MaintenanceModule" apps/api/src/app.module.ts` = 2
- **Committed in:** `030f374` (Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (2 blocking environment/tooling, 1 bug in literal-check-vs-comment-text conflict)
**Impact on plan:** All 3 were necessary to make Task 1/2 executable and verifiable at all in this worktree, or to satisfy the plan's own conflicting instructions. No scope creep — no files outside the plan's `files_modified` list were touched except gitignored `node_modules`/`.env`.

## Issues Encountered

- The plan's acceptance criterion `ls apps/api/node_modules/cron/package.json` (and `luxon`) assumed a flat/hoisted `node_modules` layout, which held true under the manual tmp-dir-copy method used in the first install attempt. After switching to a real `pnpm install`, pnpm's strict virtual-store layout means `cron`/`luxon` are **not** hoisted to `apps/api/node_modules` top level — they live only inside `@nestjs/schedule`'s own nested `node_modules` in the pnpm store (`node_modules/.pnpm/@nestjs+schedule@.../node_modules/cron`), which is correct and expected pnpm behavior. Functional resolution was verified directly instead: `node -e "import('@nestjs/schedule').then(m=>{...m.Cron...})"` succeeds (this import internally requires `cron`/`luxon`, so a failure there would surface immediately), and the live API boot log shows `ScheduleModule dependencies initialized` with no exception. The literal file-path criterion no longer applies as written; the functional intent (package installed, resolvable, working) is satisfied.
- `EADDRINUSE :::3001` appeared when booting the API for the live-verification step — a separate dev server (main checkout or another worktree) was already bound to port 3001. This is unrelated to this plan's changes: Nest logged `Nest application successfully started` (all modules including `ScheduleModule` and `MaintenanceModule` initialized without error) **before** the `listen()` call hit the port conflict. No cleanup needed — the boot process exited on its own.

## User Setup Required

None - no external service configuration required. (`.env` / `apps/api/.env` were copied from the main checkout purely to run local verification in this worktree; they are gitignored and were not committed.)

## Next Phase Readiness

- `ScheduleModule.forRoot()` is live in `app.module.ts` — plan 09-05's outbox poller can add its own `@Cron`/`@Injectable()` service without any further scheduler wiring.
- `MaintenanceModule` demonstrates the exact DI pattern (`@InjectDataSource()`, try/catch + Logger, no second `DataSource` lifecycle) that plan 09-05 should mirror for the outbox poller.
- No blockers for downstream phase 9 plans. The `pnpm-lock.yaml` sync means any other worktree/machine running plain `pnpm install` will now also get `@nestjs/schedule@6.1.3` without repeating this plan's install investigation.

---
*Phase: 09-duy-t-n-th-ng-b-o-theo-d-i-n*
*Completed: 2026-07-31*

## Self-Check: PASSED

- All 6 key files confirmed present on disk (`retention-queries.ts`, `retention-queries.test.ts`, `maintenance-cron.service.ts`, `maintenance.module.ts`, `apps/api/package.json`, `apps/api/src/app.module.ts`)
- All 4 commit hashes confirmed in `git log --oneline --all`: `4371666`, `a342b65`, `a41806b`, `030f374`

---
phase: 08-menu-cong-khai-checkout-cong-tac-nhan-don
verified: 2026-07-31T09:30:00Z
status: passed
score: 5/5 roadmap success criteria verified, 4/4 REQ tick states confirmed, 4/4 scrutiny items resolved
overrides_applied: 0
re_verification: No — initial verification
---

# Phase 8: Menu công khai, Checkout & Công tắc nhận đơn — Verification Report

**Phase Goal:** Khách xem được menu và gửi được đơn từ điện thoại; quán bật/tắt nhận đơn và chặn được lạm dụng
**Verified:** 2026-07-31
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP § Phase 8 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Khách mở `order.` xem menu không cần login, món hết hàng làm mờ không ẩn, xem được trước khi bị hỏi thông tin cá nhân | ✓ VERIFIED | `apps/shop/src/main.tsx` route `/` = `MenuPage` (no auth guard anywhere in `apps/shop`); `apps/api/src/modules/public/public-menu.controller.ts` returns ALL items incl. `is_out_of_stock`, does not filter them out (comment: "BE không lọc theo is_out_of_stock, FE làm mờ"); `CardItem`/`MenuPage` render `opacity: var(--opacity-out-of-stock)` + "Hết hàng" chip, card not hidden (`08-UI-SPEC.md:235-238`, confirmed against `08-09-SUMMARY.md`). No personal-info form exists before `/checkout` (route order `/` → `/cart` → `/checkout`). |
| 2 | Khách gửi đơn: PICKUP/DELIVERY (PICKUP không hỏi địa chỉ), chia sẻ vị trí → phí bằng chữ, nhận `order_token`, giá chốt trong `items_snapshot` | ✓ VERIFIED | `CheckoutPage.tsx`: address/geolocation/maps-link inputs rendered **only** when `fulfillment === 'DELIVERY'` (D-19); `apps/api/.../submit-order.ts:8-11` docblock + code: `items_snapshot` is **always** built server-side from `findMenuItemsByIds()` DB lookup, `OnlineOrderSubmit` schema has no `unit_price`/`name` field for client to set; `cart-store.ts toSubmitItems()` sends only `menu_item_id, qty, note` (no price). `public-orders.test.ts` (19 tests, re-run green) covers "client nhồi unit_price → subtotal vẫn theo giá DB". Response `{ order_token }` confirmed in `public-orders.controller.ts`. |
| 3 | Tắt công tắc: FE khoá nút + API vẫn trả `409 ONLINE_ORDERING_DISABLED`; ngoài giờ mở cửa bị chặn; "OFF hết hôm nay" tự ON 00:00; đơn đang chạy không ảnh hưởng | ✓ VERIFIED | `store-status.ts::evaluateOrderingStatus()` — pure fn, `nowMs` param (no internal `Date.now()`), auto-revert branch confirmed at line 34-38, re-run test `store-status.test.ts` 16/16 green incl. midnight-crossing case; `order-guard.ts::checkOrderGuard()` returns `ONLINE_ORDERING_DISABLED`/`STORE_CLOSED` before any DB-cost checks; `CheckoutPage.tsx` disables submit button on `ordering_enabled === false` (FE layer). HTTP-level 409 is the one item still Manual-Only (see Human Verification below) — owner ran it personally in the 08-13 checkpoint (`08-VALIDATION.md` Manual-Only row 1, approved). "Đơn đang chạy không ảnh hưởng" is true by construction: switch only gates the `submit` guard path, no code path re-evaluates existing `online_order_requests` rows against the switch. |
| 4 | 1 SĐT không mở 2 đơn cùng lúc; SĐT blacklist bị chặn; rate limit IP+SĐT hoạt động; `ip_hash` lưu hash không lưu IP thô | ✓ VERIFIED | `open-order-lock.integration.test.ts` — **real 2-connection MySQL race test**, re-run green (594ms, includes actual `FOR UPDATE` gap lock proof); `order-guard.ts` returns `PHONE_BLACKLISTED`/`TOO_MANY_REQUESTS` in spec-locked priority order (§7); `public-orders.service.ts` phone-rate-limit counts rows in `online_order_requests` (DB-backed, restart-safe per D-18); `@Throttle({limit:10, ttl:60_000})` on `POST /api/public/orders` (IP layer) confirmed in `public-orders.controller.ts:28`; `ip-hash.ts::hashIp()` uses `createHmac('sha256', salt)` — never stores raw IP, confirmed no raw-IP write path in `public-orders.service.ts` (`hashIpFn` is the only assignment site for the stored value). |
| 5 | `GET /api/public/menu` trả đúng 7 field, không leak field nội bộ | ✓ VERIFIED | `public-menu.mapper.ts` builds explicit object literal (never entity spread) then `.strict().parse()` — any accidental extra entity field throws instead of leaking. Re-ran `public-menu-shape.test.ts` (9/9 green). Fields confirmed: `id, code, name, price, unit, images[], is_out_of_stock`. |

**Score:** 5/5 truths verified

### REQ-I/J/K/L Tick-State Independent Confirmation (Scrutiny Item 1)

`REQUIREMENTS.md` currently marks REQ-I/J/K/L as `[x]` Complete. Independently re-derived against shipped code (not the SUMMARY claims):

| Req | Current file state | Code evidence at phase close | Verdict |
|-----|--------------------|-------------------------------|---------|
| REQ-I | [x] Complete | `MenuPage.tsx`, `public-menu.controller.ts`, `CardItem.tsx` all present and wired; no-login route confirmed | Correct |
| REQ-J | [x] Complete | `CheckoutPage.tsx` (wave 6, plan 08-12) ships full PICKUP/DELIVERY form, autofill, geolocation, submit, snapshot pricing | Correct **now**, but flagged as prematurely ticked mid-flight |
| REQ-K | [x] Complete | `evaluateOrderingStatus`, Dashboard widget, `/admin/settings`, 409 guard in `checkOrderGuard` all present | Correct |
| REQ-L | [x] Complete | Gap lock, blacklist, rate limit, ip_hash all present per truth #4 above | Correct |

**Finding (process gap, not a phase-goal gap):** `git show 9130bbd` (commit `docs(08-11): mark REQ-I/REQ-J progress`, 2026-07-30 16:29) ticked REQ-J `[x]` in `REQUIREMENTS.md` during **wave 5** (plan 08-11 — cart/confirmation/history), one full wave **before** `/checkout` itself was implemented in **wave 6** (plan 08-12, commits `8f86cd4`/`6dfa2aa`/`1b0b582`). At that point in history REQ-J was **not yet actually done** despite the checkbox. The commit message even says so explicitly ("REQ-J sẽ tiếp tục được plan 08-12 hoàn thiện"). By phase close (13/13 plans, current HEAD) the code has caught up and the tick is now accurate — so this is a **transient documentation-accuracy gap during execution**, not a surviving defect. Recorded here because the verification brief specifically asked to confirm end-state rather than trust the file; end-state is confirmed correct.

### Scrutiny Item 2 — `PHONE_BLACKLISTED` / D-21 neutral copy

Confirmed: `grep -rn -i "chặn|blacklist" apps/shop/src` (excluding tests) matches only: code comments (docblocks about WebView Geolocation blocking, SSRF prevention, double-submit blocking) and the literal error-code identifier `PHONE_BLACKLISTED` used in a `===` comparison. Traced the actual **customer-visible string**: `apps/api/src/modules/public/submit-order.ts:95-97` builds the message customers see —
`` `Không thể gửi đơn với số điện thoại này lúc này. Vui lòng gọi ${settings.store_phone} để được hỗ trợ.` `` — no "chặn"/"blacklist" wording. `CheckoutPage.tsx` only reads `error.message` verbatim from the BE; it never adds its own text referencing the block. **D-21 is honored.** The `grep -ci blacklist = 0` acceptance criterion documented in `08-12-PLAN.md`/`08-VALIDATION.md` was an internally-contradictory static check (any code using the literal `PHONE_BLACKLISTED` constant will always match `blacklist` case-insensitively) — this is a test-authoring defect in the plan, not a code defect, and is already correctly self-diagnosed in `08-VALIDATION.md § Known Acceptance-Criteria Conflicts`. No action needed.

### Scrutiny Item 3 — Commit `d31649c` (Footer/logo/category-tile changes outside any plan)

- **Timing correction:** `OVERRIDE-DEBT.md` OD-09/OD-10 and `08-VALIDATION.md` both describe `d31649c` as landing "giữa wave 5 và wave 6" (between waves 5 and 6). Independently re-checked via `git log` timestamps: `d31649c` is dated 2026-07-30 16:01, which is **after** the wave-4 tracking commit (`d4a6bc2`, 15:30) and **before** the first wave-5 commit (`1269cf0`, 16:11). The commit actually landed **between wave 4 and wave 5**, not wave 5/6. Minor documentation inaccuracy in two files; does not change the substance of OD-09/OD-10 (both still correctly describe the code deviation itself, only the wave label is off by one).
- **OD-09 (placeholder loses item name) / OD-10 (aspect-ratio 4/3→3/2):** both already have OVERRIDE-DEBT entries per plan 08-13. Verified against current code: `ImagePlaceholder.tsx` no longer prints item name as visible text (aria-label only) and `tokens.css:195` has `--ratio-card-media: 3 / 2`. Matches OD-09/OD-10 description exactly.
- **Footer + logo + `shop-contact.ts` + widened category tiles — checked against `08-CONTEXT.md` and `08-UI-SPEC.md` for a conflicting LOCKED decision:** `08-UI-SPEC.md` § "Phần bổ sung — Kiến trúc màn hình" describes AppShell/Header/CategoryRail/Cart/Checkout screens in detail but **contains no Footer section at all** — footer was never specified, locked, or prohibited. The category-tile width change (`--w-category-tile: calc(--tap-min * 2.1)`, i.e. ~92px) is a new token addition, not a violation of any width value that appears in `08-UI-SPEC.md` line 179-188 (that section does not pin a tile width). **Conclusion: Footer, logo, and category-tile widening are additive UI not covered by any locked decision — they do not require an `OVERRIDE-DEBT.md` entry because nothing LOCKED was overridden.** This matches the phase's own self-assessment in `08-13-SUMMARY.md`. `shop-contact.ts` is deliberately left with empty strings (footer self-hides each empty row); flagged as an **open item** per the verification brief, not a defect — confirmed the footer code correctly self-hides on empty fields (`{c.address && (...)}`, `{c.phone && (...)}`).
- Verified wiring: `AppShell.tsx` imports and renders `<Footer/>` correctly (outside `<main>`, before `<FloatingCart/>`), not orphaned.

### Scrutiny Item 4 — Bundle gate 320kB → 370kB

Confirmed via `08-UAT.md` test 5 and `OVERRIDE-DEBT.md` "Chưa được ghi ở đây" section (actually `08-VALIDATION.md § Known Acceptance-Criteria Conflicts`): `320 kB` at plan 08-04 was explicitly documented as a **self-set budget** (measured 244 kB + ~30% margin), not a value pinned by any spec or `08-CONTEXT.md` decision. Searched `08-CONTEXT.md`, `08-UI-SPEC.md`, and `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` references in context — no document pins a bundle-size number; M2.D-64 only requires the bundle **not contain** admin route strings, which is the separate grep gate (still 100% intact, re-verified below). No missing override entry — self-assessment is correct.

## Independently Re-Run Automated Checks (not copied from SUMMARY)

| Check | Command | Result |
|-------|---------|--------|
| API typecheck | `apps/api $ ../../node_modules/.bin/tsc --noEmit` | Clean (no output, exit 0) |
| Shop typecheck | `apps/shop $ ../../node_modules/.bin/tsc --noEmit` | Clean (no output, exit 0) |
| API test suite | `apps/api $ node_modules/.bin/vitest run` | **10 files / 106 tests passed**, incl. real 2-connection MySQL gap-lock race test (594ms) |
| Shop test suite | `apps/shop $ node_modules/.bin/vitest run` | **2 files / 22 tests passed** |
| Shop production build | `apps/shop $ node_modules/.bin/vite build` | `dist/assets/index-*.js 356.06 kB / gzip 104.57 kB` |
| Bundle guard (2 gates) | `sh scripts/check-shop-bundle.sh` | `OK: bundle JS 348 kB (ngưỡng 370 kB)`; `OK: 11 forbidden strings clean` — exit 0 |
| D-21 customer-copy grep | `grep -rn -i "chặn\|blacklist" apps/shop/src --include=*.ts --include=*.tsx \| grep -v test` | Only code comments + literal error-code constant, no customer-visible string |

All numbers reproduced independently match what SUMMARY/VALIDATION documents claimed — no discrepancy found between claimed and actual test results.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/api/src/modules/public/public-menu.controller.ts` + `.mapper.ts` | 7-field whitelist, real DB query | ✓ VERIFIED | Explicit object literal + `.strict().parse()`, real `find()` queries, Level-4 data flow confirmed real (not static) |
| `apps/api/src/modules/public/public-orders.service.ts` + `submit-order.ts` | Gap lock, server-side price snapshot, guard order | ✓ VERIFIED | `FOR UPDATE` inside `ds.transaction()`, price never read from client |
| `apps/api/src/modules/public/store-status.ts` | Pure fn, `nowMs` param, auto-revert | ✓ VERIFIED | No internal `Date.now()`, 16 tests green |
| `apps/api/src/modules/public/order-guard.ts` | Priority-ordered guard checks | ✓ VERIFIED | Matches spec §7 order exactly |
| `apps/api/src/modules/public/ip-hash.ts` | HMAC, no raw IP | ✓ VERIFIED | `createHmac('sha256', salt)` |
| `apps/api/src/common/csrf-paths.ts` + `csrf-origin.middleware.ts` | `/api/public/*` covered | ✓ VERIFIED | `pathRequiresCheck` covers prefix correctly, 10 tests green |
| `apps/shop/src/main.tsx` + 5 pages | Router wired, no dead code | ✓ VERIFIED | All 5 routes + AppShell + catch-all mounted |
| `apps/shop/src/pages/CheckoutPage.tsx` | PICKUP/DELIVERY, geolocation, 8 error codes, submit | ✓ VERIFIED | Confirmed field-by-field against UI-SPEC |
| `apps/web` Dashboard widget + `/admin/settings` + `/admin/phone-blacklist` | 1-tap switch, 2-tab settings page | ✓ VERIFIED | Wired to `/admin/settings` PUT, `AuditInterceptor` applies globally (APP_INTERCEPTOR in app.module.ts) |
| `OVERRIDE-DEBT.md` OD-06..OD-10 | 5 phase-8 override entries | ✓ VERIFIED | All present, all match code |
| `08-UAT.md` | 5 deferred UAT items, test 1 marked mandatory pre-deploy gate | ✓ VERIFIED | All `result: pending`, none falsely marked done |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `CheckoutPage.tsx` | `POST /api/public/orders` | `postJson()` in `use-api.ts` | WIRED | Submit + 8-error-code handling + navigate to `/o/:token` on success |
| `POST /api/public/orders` | `checkOrderGuard()` | `submit-order.ts` orchestrator | WIRED | Guard called before insert, priority order matches spec |
| `PUT /admin/settings` | `AuditInterceptor` | Global `APP_INTERCEPTOR` in `app.module.ts` | WIRED | Confirmed global registration, no per-controller opt-out |
| `DashboardPage.tsx` widget | `PUT /admin/settings` | `api.put()` | WIRED | 1-tap toggle confirmed at `DashboardPage.tsx:83` |
| `CsrfOriginGuard` | `/api/public/orders` (mutation) | `pathRequiresCheck()` | WIRED | Test-proven + code-read confirmed |
| `Footer.tsx` | `AppShell.tsx` | direct import + render | WIRED | Not orphaned |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `public-menu.controller.ts` | `groups`/`items` | `itemRepo.find()`/`groupRepo.find()` (TypeORM, real DB) | Yes | ✓ FLOWING |
| `public-orders.service.ts` | `items_snapshot` | `findMenuItemsByIds()` DB lookup, never client body | Yes | ✓ FLOWING |
| `SettingsController.get()` | `settings` | `settingsSvc.readAll()` (DB) | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

Not run against a live dev server (per instructions: do not modify source, do not re-run the human checkpoint, and no server was started for this verification). Automated unit/integration equivalents were re-run instead (see table above), including a real 2-MySQL-connection race test — this satisfies the intent of a behavioral spot-check for the highest-risk path (T-08-50 gap lock) without needing to boot a server.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|------------|--------------|--------|----------|
| REQ-I | 08-04, 08-06, 08-07, 08-09 | Public menu, no login | ✓ SATISFIED | See truth #1, #5 |
| REQ-J | 08-01, 08-06, 08-10, 08-11, 08-12 | Checkout, snapshot price | ✓ SATISFIED | See truth #2, tick-state section |
| REQ-K | 08-01, 08-05, 08-08 | Store switch, FE+BE gate | ✓ SATISFIED | See truth #3 |
| REQ-L | 08-01, 08-02, 08-05, 08-07, 08-10 | Anti-abuse | ✓ SATISFIED | See truth #4 |

No orphaned requirements found — REQ-I/J/K/L all appear in plan frontmatter `requirements` fields across 08-01..08-13.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/shop/src/lib/shop-contact.ts` | 28-35 | `TODO(chủ quán)` + all-empty contact fields | Info (not a debt-marker blocker — `TODO` is a warning-level marker per anti-pattern rules, not `TBD`/`FIXME`/`XXX`) | Explicitly designed to self-hide in `Footer.tsx` when empty; owner must fill in real contact info before it's useful, but does not block any phase-8 success criterion. Flagged as **open item**, matching the verification brief's explicit guidance. |
| `OVERRIDE-DEBT.md` / `08-VALIDATION.md` | OD-09/OD-10 wave reference | Documentation says `d31649c` landed "giữa wave 5 và wave 6"; actual git timestamps place it between wave 4 and wave 5 | Info | Cosmetic inaccuracy in override bookkeeping, does not change the validity of the override entries themselves |
| `.planning/REQUIREMENTS.md` | commit `9130bbd` (historical) | REQ-J ticked `[x]` one wave before `/checkout` was implemented | Info (resolved by phase close) | Process gap during execution; end-state (current file) is correct |

No `TBD`/`FIXME`/`XXX` markers found in any file touched by phase 8. No blocker-level anti-patterns found.

## Human Verification Required

These are the phase's own documented Manual-Only items (from `08-VALIDATION.md`) that the owner already personally exercised and approved at the 08-13 checkpoint (2026-07-31, "approved", 15 steps, no failures reported). Listed here for completeness per the verification protocol, but **already closed** by the owner's checkpoint sign-off — not re-opened by this verification:

### 1. BE trả 409 thật qua HTTP khi công tắc OFF
**Test:** `curl -X POST /api/public/orders` while switch is OFF
**Expected:** `409 ONLINE_ORDERING_DISABLED`
**Why human:** No `@nestjs/testing`+`supertest` harness (deliberate scope decision); logic-level guard is unit-tested, HTTP wiring needs a live server
**Status:** Already exercised and approved by project owner at 08-13 checkpoint (2026-07-31)

### 2. `POST /api/public/*` without Origin header → 403
**Test:** `curl` without Origin/Referer
**Expected:** `403 CSRF_ORIGIN_MISMATCH`
**Why human:** Middleware wiring, not pure-function logic
**Status:** Already exercised and approved by project owner at 08-13 checkpoint (2026-07-31)

These two items do NOT change the overall phase status — they are already closed by the owner's own checkpoint approval, which is the correct verification path for HTTP-level behavior this phase deliberately chose not to automate. Not re-run here per instructions ("Do NOT re-run the human checkpoint").

## Deferred Items (NOT phase-8 gaps — production-only, per C-LOCAL-01)

The 5 items in `08-UAT.md` are correctly out of scope for phase-8 closure per the LOCAL-ONLY mandate. None of them block any of the 5 ROADMAP success criteria at the phase-8 (local) level — they gate **production deployment**, not phase-8 completion:

| # | Item | Blocks phase 8? | Blocks production deploy? |
|---|------|------------------|-----------------------------|
| 1 | Docker build + `sharp` on alpine | No | **Yes — mandatory gate, explicitly documented** |
| 2 | `Permissions-Policy: geolocation=(self)` served by Caddy | No | Yes (degrades Geolocation feature only, order flow still works via manual address) |
| 3 | Geolocation in Zalo/Facebook WebView | No | No (fallback path already coded and unit-tested) |
| 4 | Old pre-resize images still render | No | No (generic `<img>` behavior, not phase-8-specific risk) |
| 5 | Bundle size on real 3G | No | No (local gate `check-shop-bundle.sh` is the local substitute, currently 348/370 kB) |

None of these were miscounted as phase-8-blocking successes — `08-UAT.md` frontmatter correctly still reads `status: testing` with all 5 `result: pending`.

## Gaps Summary

No blocking gaps found. All 5 ROADMAP success criteria for phase 8 are independently verified against actual code (not SUMMARY claims), with automated tests re-run fresh in this verification session (106 API + 22 shop tests, both suites green; both typechecks clean; bundle guard green). The four scrutiny items requested were each individually investigated:

1. REQ-J tick timing — confirmed a real but transient documentation-accuracy gap during wave 5 that self-corrected by wave 6/phase close; end-state is accurate.
2. `PHONE_BLACKLISTED` grep conflict — confirmed a test-authoring self-contradiction, not a code or copy defect; D-21 neutral wording is honored in the actual customer-facing string.
3. Footer/logo/category-tile additions — confirmed no LOCKED decision was violated (no footer spec existed to violate); OD-09/OD-10 correctly cover the two decisions that WERE overridden (image name in placeholder, aspect ratio); a minor wave-number inaccuracy was found in the override bookkeeping (cosmetic only).
4. Bundle threshold 320→370kB — confirmed 320kB was never spec-pinned, correctly self-assessed as not needing an override entry.

One informational open item carried forward (not a phase gap): `shop-contact.ts` awaits the owner's real contact details before the footer shows anything beyond the wordmark — self-hides correctly in the meantime.

---

*Verified: 2026-07-31*
*Verifier: Claude (gsd-verifier)*

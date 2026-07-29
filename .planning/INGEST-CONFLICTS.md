## Conflict Detection Report

Ingest mode: new · Docs classified: 1 (SPEC ×1) · Precedence: ADR > SPEC > PRD > DOC (per-doc override: SPEC precedence 0)
Cross-ref cycle detection: run, depth 1, **no cycles** (all 20 cross-refs point at code files, external URLs, or deleted `.vg/` artifacts — none point at another classified doc).

### BLOCKERS (0)

None. No LOCKED-vs-LOCKED contradiction, no UNKNOWN/low-confidence doc, no ref cycle, no existing `.planning/` decision to contradict (mode `new`; PROJECT.md / REQUIREMENTS.md / ROADMAP.md / STATE.md all absent).

### WARNINGS (6)

[WARNING] Phase 07 success criteria are delegated to a deleted file
  Found: docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md:546 — "Success criteria: xem `.vg/ROADMAP.md` § Phase 07"; the same doc at :654-657 records that all `.vg/` artifacts were deleted from the working tree when VGFlow was dropped for GSD. Confirmed absent on disk.
  Impact: REQ-Q is the only requirement with no verifiable acceptance list in the ingested doc. Synthesis reconstructed it from the §12 infra checklist (spec:679-686) plus the five infra criteria mis-filed under Phase 08 (spec:571-575) — that reconstruction is inference, not the owner's original wording. Same gap applies to the original AC IDs `AC-Q1..AC-P5`, which lived in the deleted `.vg/REQUIREMENTS.md`.
  → Either approve the reconstructed REQ-Q criteria in `.planning/intel/requirements.md`, or recover the original via `git show <commit>:.vg/ROADMAP.md` and re-run ingest with it added to the manifest.

[WARNING] Design-ref prerequisite contradicts the "does not block phase 08" list
  Found: spec:161 (M2.D-71, LOCKED) requires the missing screenshots — homepage/banner, item detail, checkout step 2, **and the mobile versions** — to be captured "trước khi làm phase 08", saved to `docs/design-refs/lotteria/`, then processed via `/gsd:ui-phase`. spec:639 heads the open-items list "Việc còn để ngỏ (**không block phase 07/08**)" and then lists exactly those screenshots (item 7) and the unchosen brand colour (item 6) inside it. `docs/design-refs/lotteria/` does not exist.
  Impact: Phase 08 is the largest UI phase (REQ-I + REQ-J) and M2.D-71 calls the missing mobile refs "rủi ro lớn nhất vì khách gần như 100% vào bằng điện thoại". Routing phase 08 UI work now means designing mobile layouts with no reference, against a brand colour that is still Lotteria's `#E4453A` placeholder (spec:163 — "Cần logo quán để lấy màu chính").
  → Decide before routing phase 08: (a) supply the screenshots + logo/brand colour first, or (b) explicitly accept building phase 08 against `apps/shop/src/styles/tokens.css` placeholders and re-skin later. Phase 07 is unaffected either way.

[WARNING] Locked acceptance criteria require production verification, but all Milestone 2 work is LOCAL ONLY
  Found: spec:571-575 and spec:150/:154 require, as phase criteria: `order.quanbalun.site` serving `shop-dist` end-to-end, a DNS A record for `order.`, a Caddy-issued TLS cert, `Permissions-Policy: geolocation=(self)` proven by taking a real geolocation permission on HTTPS, and host-only cookie behaviour observed across two real hostnames in DevTools. User mandate for this ingest: no deploys, no pushes, no touching the production VPS.
  Impact: Five criteria under REQ-Q cannot be satisfied in-phase. If they are routed as normal blockers, phase 07 can never be marked complete; if they are dropped silently, M2.D-69's exact failure mode (geolocation silently dead in production while looking fine in Vite dev, since the header only exists via Caddy) ships unnoticed.
  → Approve carrying them as deferred UAT (recorded as `[PROD-UAT]` in `.planning/intel/requirements.md` and C-LOCAL-01 in `constraints.md`), with local substitutes as the in-phase gate: `Host:`-header curl for static routing, a unit test over the origin allow-list, a build-output grep for `/dashboard`+`/kitchen`, and Caddyfile/Dockerfile/compose diffs written but not applied.

[WARNING] Locked criteria demand automated tests; the repo has no API test harness
  Found: spec:603 (M2.D-23) "**assert trong test**"; spec:589 (M2.D-01) "test đếm doanh thu trước/sau khi có 5 đơn WAITING"; spec:587 (M2.D-06) "test bằng 2 request song song"; spec:584 (M2.D-33) "test bằng gọi API trực tiếp". Codebase reality (`.planning/codebase/TESTING.md:8-36`): exactly one test file exists repo-wide (`apps/web/src/lib/menu-search.test.ts`); `apps/api` has vitest installed and zero test files; no `vitest.config.ts` anywhere; no jsdom, no mocking library, no coverage tool, no CI.
  Impact: Writing the first `apps/api` test is a new pattern for this codebase, and the two highest-value ones cannot use mocks — M2.D-06 (row lock, concurrent confirm) and M2.D-01 (revenue query exclusion) need a real MySQL transaction, i.e. an integration harness. Left implicit, phase 09 will be planned as if these criteria were free.
  → Decide the harness up front: NestJS `Test.createTestingModule` + repository mocks for pure/unit paths, versus a real-MySQL integration harness (docker-compose `mysql` on host port 3307 already exists) for the concurrency and revenue tests. Budget it as explicit work in the first phase that needs it, and prefer extracting pure functions (`computeProgress`, Haversine, open-hours evaluation, origin allow-list parsing) so they are testable in the existing zero-config vitest style.

[WARNING] M2.D-67 as written leaves a prefix-spoofing hole open
  Found: spec:152 (M2.D-67, LOCKED) asks only that `ALLOWED_ORIGIN` become a comma-separated list. Codebase: `apps/api/src/common/middleware/csrf-origin.middleware.ts:26,35` reads one env value and validates with `origin.startsWith(allowed)`. Turning the value into a list while keeping `startsWith` means `https://quanbalun.site.evil.com` still passes the check, because there is no boundary after the prefix (`.planning/codebase/CONCERNS.md:46-56`).
  Impact: Milestone 2 is precisely the change that makes this matter — it adds a second origin and the first public mutation endpoints. Currently masked by `SameSite=Strict` on the JWT cookie (the middleware documents itself as defense-in-depth only), so this is not an active exploit today, but implementing M2.D-67 literally locks the weak comparison in.
  → Approve widening M2.D-67's scope so the comparison becomes exact host equality (parse with `new URL()`, compare `protocol + '//' + host` against each allow-list entry) rather than a prefix test. Recorded as C-SEC-01 in `constraints.md`. This is an extension of a LOCKED decision, not an override — it needs the owner's nod, not a spec rewrite.

[WARNING] The 15s notification-outbox poller has no runtime home
  Found: spec:507 requires `cron-notification-outbox.ts` every 15s, `cron-site-events-retention.ts` daily, `cron-daily-summary-email.ts` at 23:30. Codebase (`.planning/codebase/CONCERNS.md:13-17`): the two existing crons (`cron-audit-retention`, `cron-jti-cleanup`) are CLI scripts with no scheduler entry in `docker-compose.yml`, `docker-compose.prod.yml`, or `Caddyfile` — nothing in the deployed infrastructure invokes them.
  Impact: REQ-N's escalation ladder (SMS at 90s, auto-OFF at 1800s — M2.D-60) and G-2 ("tỉ lệ đơn bị bỏ quên > 5 phút = 0") depend entirely on that poller actually running. Shipping it as another unwired CLI script means the escalation silently never fires, which is the exact failure the owner asked for this feature to prevent.
  → Choose the mechanism before planning phase 09: in-process `@nestjs/schedule` (no infra change, works under the LOCAL-ONLY mandate, keeps single-container deploy) versus a compose sidecar/host crontab (requires touching production config, which is out of scope right now). Note this decision also fixes or leaves broken the two pre-existing unwired crons.

### INFO (12)

[INFO] Auto-resolved: M2.D-59 supersedes M2.D-41 — phone blacklist
  Note: spec:99 (M2.D-41) specifies a 24h TTL with cron auto-cleanup; spec:139 (M2.D-59, vòng 4) explicitly states "**Ghi đè M2.D-41**: bỏ TTL tự động 24h và bỏ `cron-blacklist-cleanup.ts`; bản ghi tồn tại cho tới khi admin xoá tay". Newer decision wins unambiguously — source of truth is M2.D-59. Column `expires_at` is retained (NULL = vĩnh viễn) for a future temporary-block feature, but no expiry cron is built (spec:302-303, :507). M2.D-41 is preserved verbatim in `.planning/intel/decisions.md` marked SUPERSEDED, not deleted.

[INFO] Auto-resolved: M2.D-60 supersedes M2.D-36 — auto-OFF threshold is 1800s
  Note: spec:89 (M2.D-36) sets auto-OFF at 5 phút; spec:140 (M2.D-60, vòng 4) states "**Ghi đè M2.D-36**: `escalate_autooff_after_s` mặc định `1800`" with the rationale that 5 minutes falsely trips during peak hours. Source of truth is M2.D-60 (1800s). M2.D-36's **90s SMS** rung remains fully in force ("SMS ở 90s giữ nguyên"), so M2.D-36 is only partially superseded. Confirmed consistent at spec:256 (seed default `1800`), spec:496, and spec:594.

[INFO] Auto-resolved: stale `300s` in the §7 pseudo-code
  Note: spec:469 still writes `L4 AUTOOFF → scheduled_at = now + 300s` inside the submit-flow pseudo-code, contradicting M2.D-60. The same section's prose two dozen lines later (spec:496) correctly says "Quá 1800s vẫn WAITING". Source of truth is M2.D-60 → **1800s**. Flagged loudly in `constraints.md` C-FLOW-01 and `decisions.md` M2.D-60 so implementers copying the pseudo-code verbatim do not reintroduce the 5-minute threshold.

[INFO] Auto-resolved: phase count — header says 3 phases, §9 says 4
  Note: spec:6 ("Phạm vi: 3 phase (07, 08, 09)") is leftover from rounds 1–3. spec:539 explicitly records the change: infra was split out in vòng 5, giving 4 phases — 07 hạ tầng → 08 menu/checkout → 09 duyệt đơn → 10 analytics. §9 wins; the header line is stale prose. Synthesized intel uses the 4-phase numbering throughout.

[INFO] Auto-resolved: `/m` route prefix dropped
  Note: spec:556 (Phase 08 criterion) still says "`/m` xem được menu không cần login", but spec:515 states "Vì là domain riêng nên **bỏ prefix `/m`** của bản spec cũ" per M2.D-64/M2.D-65, and the §8 route table (spec:519-523) uses `/`, `/cart`, `/checkout`, `/o/:token`, `/history` on `order.<domain>`. M2.D-64/65 win — customer routes carry no `/m` prefix. Corrected in `requirements.md` REQ-I.

[INFO] Phase 07 is recorded as done but is roughly one third implemented
  Note: spec:659 claims "phase 07 đã dựng `apps/shop` + `packages/utils` + 4 trang placeholder + `GET /api/public/health`" — all four verified present in the tree. The other five items of the §12 phase-07 checklist are NOT implemented: `main.ts:39` mounts only `web-dist` (no `Host`-header switch, M2.D-66); `Dockerfile` contains no `shop` build stage; `.env.example:25` `ALLOWED_ORIGIN` is a single value; `Caddyfile:23` has one site block with `geolocation=()` (no `order.{$DOMAIN}` block, M2.D-69); no DNS record. The spec's own claim is narrowly worded and therefore not false — but "phase 07 complete" would be. Recorded per-criterion in `requirements.md` REQ-Q.

[INFO] Five Phase-08 criteria actually belong to REQ-Q / phase 07
  Note: spec:571-575 lists `order.` vs apex static serving (M2.D-66), the admin-code bundle grep (M2.D-64), the host-only cookie check (M2.D-68), the CSRF origin check (M2.D-67), and production geolocation (M2.D-69) under Phase 08's success criteria, even though §9 assigns M2.D-64..69 to Phase 07 / REQ-Q (spec:544-546). Synthesis mapped them to REQ-Q, since that is where the owning decisions live. No content lost — this is a filing correction, not an override.

[INFO] Auto-resolved: §8-bis colour table vs `tokens.css`
  Note: spec:169-174 states that `apps/shop/src/styles/tokens.css` is "**nguồn sự thật khi code**" and that three colours in the §8-bis table were corrected for WCAG AA (`#888` → `#726865` at 5.19:1; brand red split into `#E4453A` for ≥24px bold/borders only, `#CC3529` for buttons and small text at 4.91:1, `#A82419` hover; body text `#1C1917`). The doc resolves its own conflict — tokens.css wins over the extraction table. Captured as C-UI-01.

[INFO] `free_ship_km` — "4–10 km" reading already settled in-doc
  Note: spec:643 records the owner's phrasing "4–10 km miễn phí, xa hơn thu phí" and the spec's interpretation "**miễn phí đến 10 km**", matching the seed default `free_ship_km = 10` (spec:252, M2.D-53). No contradiction to resolve; the doc asks only for a verbal re-confirmation during phase 08, and the value is a runtime setting changeable at `/admin/settings` without a deploy.

[INFO] Stale arithmetic in the risk table
  Note: spec:633 mitigates auto-OFF risk with "SMS đã bắn trước đó 3.5 phút" — arithmetic derived from the old 300s threshold (300s − 90s). Under M2.D-60 the actual gap is 28.5 minutes (1800s − 90s). Prose only; no behaviour depends on it.

[INFO] Dangling cross-references and missing bookkeeping file
  Note: 4 of the doc's 20 cross-refs cannot be resolved on disk — `.vg/ROADMAP.md`, `.vg/REQUIREMENTS.md` (deleted with VGFlow, recoverable only via `git show`), `docs/design-refs/lotteria/` (never created), and `OVERRIDE-DEBT.md` (required by spec:28 and spec:134 to record the M2.D-59 / M2.D-60 overrides — does not exist in the repo). The override chain is instead captured in `.planning/intel/decisions.md`. Also note `apps/shop/DESIGN.md` and `packages/schemas/src/public-orders.ts` are referenced as existing artifacts; only the former is a design export, the latter is target work for phase 08.

[INFO] `Referrer-Policy: no-referrer` for the `order.` block is in code comments but in no decision
  Note: `apps/shop/src/pages/OrderTrackPage.tsx:7-11` documents that `order_token` in the URL is the sole credential for an order ("HTTPS là lớp bảo vệ duy nhất") and that `Referrer-Policy: no-referrer` is planned for the `order.<domain>` Caddy block; the spec's vòng-5 decisions (M2.D-64..69) never mention it, so following the spec literally would drop it. Carried as constraint C-INFRA-03 alongside the M2.D-69 Caddy work, together with UI masking of the token and a note that HTTP access logs persist full token-bearing paths and are covered by no retention cron.

---

Report generated by `gsd-doc-synthesizer` · intel at `.planning/intel/` · entry point `.planning/intel/SYNTHESIS.md`

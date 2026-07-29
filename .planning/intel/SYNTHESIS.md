# Synthesis Summary

**Generated:** 2026-07-29 by `gsd-doc-synthesizer` · mode: `new` · precedence: ADR > SPEC > PRD > DOC
**Entry point for:** `gsd-roadmapper`. Read this first, then the per-type intel files below.

---

## Docs consumed

- 1 doc, 1 classification (`.planning/intel/classifications/MILESTONE-02-ONLINE-ORDERING-SPEC-493b2960.json`)
- Type breakdown: **SPEC ×1** (`docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md`, 685 lines, confidence `high`,
  `manifest_override: true`, per-doc `precedence: 0`)
- It is a **hybrid document**: §2 holds 71 ADR-style numbered decisions, §3 holds 9 PRD-style requirements, and
  §4–§8 hold SPEC-style schema/API/algorithm content. All three layers were extracted separately.
- Cross-ref cycle detection: run (DFS, three-colour), graph depth 1, **no cycles**. All 20 cross-refs target code
  files, external URLs, or deleted `.vg/` artifacts — none target another classified doc.
- Language: Vietnamese. All decision text is preserved **verbatim, untranslated**, in `decisions.md`.

## Decisions — 71, all LOCKED

- File: `.planning/intel/decisions.md`
- IDs `M2.D-01` … `M2.D-71`. Classification `locked` field is `false` (correct per the classifier rule that only an
  ADR with `Status: Accepted` sets it), but all 71 are treated as **LOCKED at synthesis level** on the doc's own
  authority: spec:677 "Mọi quyết định **M2.D-01..71** đã chốt, không cần hỏi lại", spec:3 "SPEC ĐÃ CHỐT (vòng 5)",
  spec:28 "**Không đổi** mà không ghi vào `OVERRIDE-DEBT.md`".
- Scope groups: data-architecture (7) · customer-flow (9) · progress-bar/G-1 (8) · store-switch (7) ·
  notification/G-2 (8) · anti-abuse (4) · order-edit-cancel (5) · distance-ship-fee (5) · analytics/G-4 (4) ·
  vòng 4 payment/ship/escalation (6) · vòng 5 subdomain-infra (6) · vòng 5 customer-UI (2)
- Two intra-document override chains, both auto-resolved (newer wins, INFO in the conflicts report):
  - **M2.D-59 supersedes M2.D-41** — phone blacklist is manual add/remove only; no 24h TTL, no `cron-blacklist-cleanup.ts`
  - **M2.D-60 supersedes M2.D-36 (auto-OFF threshold only)** — `escalate_autooff_after_s = 1800`, not 300. The 90s SMS
    rung of M2.D-36 stays in force. The §7 pseudo-code at spec:469 still says `300s` and is **stale — do not implement**.
- Superseded decisions are retained verbatim and clearly marked, never deleted.

## Requirements — 9

- File: `.planning/intel/requirements.md`
- `REQ-Q` (Shop Infra, phase 07) · `REQ-I` (Public Menu, 08) · `REQ-J` (Checkout, 08) · `REQ-K` (Store Switch, 08) ·
  `REQ-L` (Anti-abuse, 08) · `REQ-M` (Approval, 09) · `REQ-N` (Notification, 09) · `REQ-O` (Order Tracking, 09) ·
  `REQ-P` (Analytics, 10 — the only **should-have**; the other 8 are must-have)
- `REQ-A..H` belong to Milestone 1 and are out of scope.
- Acceptance criteria were lifted from the §9 phase success-criteria lists and mapped back to the owning REQ. The
  original AC IDs `AC-Q1..AC-P5` lived in the deleted `.vg/REQUIREMENTS.md` and are not recoverable from disk.
- 5 criteria are tagged `[PROD-UAT]` — unverifiable locally, deferred (see C-LOCAL-01).

## Constraints — 22

- File: `.planning/intel/constraints.md`
- From the SPEC (14): schema ×7 (`store_settings`, `online_order_requests`, `phone_blacklist`, `site_events`,
  `orders` column additions, `notification_outbox`, no-migrations rule) · api-contract ×3 (public endpoints + 9 new
  error codes, admin endpoints, the tracking response shape that must never leak per-item status) ·
  protocol ×3 (progress-% algorithm, confirm/reject + table-allocation flow, cron additions) · nfr ×1 (design tokens)
- From the codebase map, **not captured by the spec** (8): `C-SEC-01` CSRF exact-host equality ·
  `C-LOCAL-01` LOCAL-ONLY mandate + deferred UAT list · `C-TEST-01` no API test harness exists ·
  `C-INFRA-01` SSE is a new transport competing with existing 2s pollers for a 50-connection pool ·
  `C-INFRA-02` no CORS config, same-origin is load-bearing · `C-INFRA-03` `order_token` is a URL-borne bearer
  credential needing `Referrer-Policy: no-referrer` · `C-CONV-01` code conventions new modules must follow ·
  `C-DEP-01` `apps/shop` has no HTTP client yet

## Context topics — 8

- File: `.planning/intel/context.md`
- milestone goal · owner success criteria G-1..G-4 · 4-phase breakdown · what is already built (verified against the
  tree) · risks & mitigations · 8 open items · design-ref provenance · tooling/process history · user mandate overlay

## Conflicts — 0 blockers, 6 warnings, 12 auto-resolved

- Full detail: `.planning/INGEST-CONFLICTS.md`
- **Blockers: none.** No LOCKED-vs-LOCKED contradiction, no low-confidence classification, no ref cycle, no existing
  `.planning/` decision to contradict (mode `new`).
- **Warnings (need a call before routing):** phase 07 criteria delegated to a deleted `.vg/ROADMAP.md` · design-ref
  prerequisite contradicts the "not blocking phase 08" list (missing mobile refs + unchosen brand colour) ·
  production-only acceptance criteria vs the LOCAL-ONLY mandate · locked criteria demand automated tests with no
  harness in the repo · M2.D-67 as written leaves a prefix-spoofing hole · the 15s outbox poller has no runtime home.
- **Auto-resolved (INFO):** the two override chains · the stale `300s` pseudo-code · 3-vs-4 phase count · the dropped
  `/m` route prefix · phase 07 recorded done but ~1/3 implemented · 5 phase-08 criteria refiled to REQ-Q ·
  §8-bis colour table vs `tokens.css` · `free_ship_km` reading · stale risk-table arithmetic · dangling cross-refs and
  the missing `OVERRIDE-DEBT.md` · the unspecced `Referrer-Policy` plan.

## Per-type intel files

- `.planning/intel/decisions.md` — 71 locked decisions, Vietnamese verbatim, with scope + source line refs
- `.planning/intel/requirements.md` — 9 requirements with acceptance criteria and `[PROD-UAT]` tags
- `.planning/intel/constraints.md` — 22 constraints, SPEC-derived and codebase-derived
- `.planning/intel/context.md` — goals, phases, build status, risks, open items, process history
- `.planning/INGEST-CONFLICTS.md` — three-bucket conflict report
- Grounding source (read-only input, not produced here): `.planning/codebase/*` (7 files, map-codebase 2026-07-29)

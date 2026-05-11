
- id: OD-095
  logged_at: 2026-05-11T02:15:49Z
  command: vg:blueprint
  phase: "01"
  flag: skip-design-grounding
  reason: "Phase 01 greenfield no design assets (CONTEXT.md D-16..D-19 covers UI/UX inline). Design mockups defer to /vg:design-scaffold separate workflow when ready. Tracked at commit f77c7a0a41fd."
  git_sha: f77c7a0
  status: active

- id: OD-114
  logged_at: 2026-05-11T02:30:18Z
  command: vg:blueprint
  phase: "01"
  flag: skip-contracts-deep-sweep
  reason: "Phase 01 Solo dev hobbyist scope: skip Codex test-goal lane (no Codex CLI configured), Lens-Walk (no CRUD multi-resource exposure surface beyond 13 endpoints already detailed), Edge-Cases generator (28 decisions + 28 test goals already cover edge cases inline), CRUD-Surfaces expand, Flow-Detect. CONTEXT.md D-04..D-28 + API-CONTRACTS.md + TEST-GOALS.md G-01..G-28 collectively cover the same ground. Commit f77c7a0a41fd."
  git_sha: f77c7a0
  status: active

- id: OD-140
  logged_at: 2026-05-11T02:31:04Z
  command: vg:blueprint
  phase: "01"
  flag: skip-fe-contracts-rcrurdr-workflows
  reason: "Phase 01 Solo dev pragmatic: skip 2b6d_fe_contracts (Pass 2 FE contracts), 2b8_rcrurdr_invariants (CRUD lifecycle invariants generator), 2b9_workflows (Pass 3 workflow specs). PLAN.md + API-CONTRACTS.md + TEST-GOALS.md collectively encode FE + lifecycle + flow info inline. Sẽ re-run with --only=fe-contracts/rcrurdr-invariants/workflows when project scales. Commit f77c7a0a41fd."
  git_sha: f77c7a0
  status: active

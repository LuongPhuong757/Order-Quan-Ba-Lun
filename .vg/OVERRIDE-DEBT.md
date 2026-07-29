
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

- id: OD-M2-001
  logged_at: 2026-07-29
  command: milestone-02-spec-discussion
  phase: "07"
  flag: decision-override
  reason: "M2.D-59 ghi đè M2.D-41: blacklist SĐT bỏ TTL tự động 24h + bỏ cron-blacklist-cleanup.ts, chuyển sang thêm/xoá tay vĩnh viễn. Chủ quán chốt trực tiếp: admin đã chủ động thêm SĐT bom đơn thì tự xoá sau 24h là phản trực giác. Cột expires_at giữ lại (NULL = vĩnh viễn) để sau muốn chặn tạm thời."
  status: resolved

- id: OD-M2-002
  logged_at: 2026-07-29
  command: milestone-02-spec-discussion
  phase: "08"
  flag: decision-override
  reason: "M2.D-60 ghi đè M2.D-36: ngưỡng auto-OFF nhận đơn online 300s → 1800s (30 phút), và không tự ON lại. Lý do: 5 phút quá ngắn, giờ cao điểm admin bấm bill 5 phút là bình thường → tắt oan cả kênh online. SMS ở 90s vẫn giữ nên không bỏ lọt đơn. Chủ quán chốt trực tiếp."
  status: resolved

- id: OD-M2-003
  logged_at: 2026-07-29
  command: vg:specs
  phase: "07"
  flag: vg-core-patch
  reason: "Sửa .claude/scripts/vg-orchestrator/contracts.py — normalize_telemetry() làm mất field severity nên telemetry khai severity=warn bị nâng thành hard block, khiến /vg:specs không đóng được run trên nhánh approve. Đây là patch vào VG core (không phải bootstrap overlay) nên /vg:update có thể ghi đè. Đã báo upstream: https://github.com/vietdev99/vgflow/issues/217 — khi upstream fix thì bỏ patch này."
  status: active

- id: OD-M2-004
  logged_at: 2026-07-29
  command: vg:specs
  phase: "08"
  flag: vg-core-patch
  reason: "Sửa .claude/commands/vg/_shared/lib/phase-profile.sh — detect_phase_profile bỏ qua field profile: trong frontmatter SPECS.md, nên rule 6 (heuristic infra) xếp sai phase 08 (feature, 9 endpoint) thành infra. Hậu quả nếu không sửa: /vg:scope 08 rút gọn bỏ 5 vòng thảo luận, blueprint không sinh API-CONTRACTS/TEST-GOALS/CONTEXT, review chuyển sang infra-smoke. Patch: tôn trọng khai báo profile: như tín hiệu mạnh nhất (theo tiền lệ migration_plan: ở rule 5). Đây là patch vào VG core nên /vg:update có thể ghi đè. Đã báo upstream: https://github.com/vietdev99/vgflow/issues/218"
  status: active

- id: OD-M2-005
  logged_at: 2026-07-29
  command: vg:scope
  phase: "08"
  flag: vg-core-patch
  reason: "Sửa .claude/scripts/vg-orchestrator/contracts.py parse_for_phase() — contract pin lưu must_emit_telemetry dưới dạng chuỗi phẳng nên xoá mất severity và required_unless_flag; hệ quả là mọi telemetry khai severity=warn bị nâng thành hard block ngay sau khi close.md §2 ghi pin, làm /vg:scope không đóng được run trên project không có .vg/FORWARD-DEPS.md. Patch: pin vẫn đóng băng DANH SÁCH event bắt buộc, còn severity/required_unless_flag/min_count/must_pair_with đọc lại từ skill hiện tại — không đổi schema pin và tự sửa cho pin đã ghi. Gốc lỗi ở vg-contract-pins.py _parse_yaml_list_value() trả list[str]. Đã báo upstream: https://github.com/vietdev99/vgflow/issues/219"
  status: active

- id: OD-M2-006
  logged_at: 2026-07-29
  command: vg:blueprint
  phase: "07"
  flag: skip-goal-coverage-and-blueprint-completeness
  reason: "Bỏ 2 validator goal-coverage.py và verify-blueprint-completeness.py cho phase 07 vì cả hai BLOCK khi thiếu TEST-GOALS.md, trong khi profile=infra khai tường minh TEST-GOALS.md nằm trong phase_profile_skip_artifacts (cùng API-CONTRACTS.md, CONTEXT.md, RUNTIME-MAP.json). Nguồn mục tiêu của infra là các checkbox '## Success criteria' trong SPECS (G-01..G-12), PLAN.md đã map đủ 12 goal qua <goals-covered>. Gốc lỗi: _shared/blueprint/verify.md không có nhận biết profile, gọi 2 validator này không kèm guard. Cùng loại với issue #217/#218/#219 (contract/profile không được tôn trọng). Validator đã chạy và PASS: verify-artifact-schema (plan), plan-granularity, verify-decisions-trace. verify-foundation-architecture = WARN (subsection rỗng)."
  status: active

- id: OD-M2-007
  logged_at: 2026-07-29
  command: vg:blueprint
  phase: "07"
  flag: skip-design-discovery
  reason: "Phase 07 là hạ tầng thuần: apps/shop chỉ có trang placeholder để verify HTTPS + quyền geolocation, không có UI nghiệp vụ nào. Design thật (tokens.css + DESIGN.md + 4 ảnh ref Lotteria) đã có sẵn và thuộc phase 08. CẢNH BÁO ĐÃ BIẾT: Form B 'no-asset:greenfield-explicit-skip' sẽ trigger critical block ở /vg:accept 07 — phải xử lý ở đó, không phải bỏ qua."
  status: active

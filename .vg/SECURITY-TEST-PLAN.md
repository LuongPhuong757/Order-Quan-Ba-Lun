# Security Test Plan — OrderQuanBaLun

Generated: 2026-05-08T03:54:55Z
FOUNDATION §9 reference: .vg/FOUNDATION.md (§9.5 Security Baseline)
Last updated: 2026-05-08T03:54:55Z

---

## 1. Risk Classification

**Risk profile:** `MODERATE`

**Justification:**
POS có money handling (auto-pay 10h pending-review, payment ghi DB), audit log mandatory cho mọi mutation, no RBAC compensated by audit. Single-tenant 1 quán, không lưu thẻ tín dụng (payment ghi nhận nội bộ; VAT integration deferred sang Milestone 2). Risk thực sự là gian lận nội bộ + lộ lệ hoá đơn — moderate phù hợp.

**Implications:**
- DAST severity: High finding = WARN (không block deploy phase 1; revisit khi tích hợp VAT)
- Pen-test frequency: none (Phase 1) — depend on ZAP DAST + audit log review
- Incident response SLA: moderate=24hr (chủ quán liên hệ dev khi phát hiện bất thường)

---

## 2. DAST (Dynamic Application Security Testing)

**Tool:** `ZAP`
**Payload profile:** `owasp-top10-2021`
**Scan timeout:** `600 (10 phút — đủ cho POS surface)`
**Scan frequency:** every `/vg:test` step 5h

(N/A — DAST enabled)

---

## 3. Static Analysis (SAST)

Beyond VG's built-in validators (verify-goal-security / verify-security-baseline):
- `Semgrep + ESLint security plugin` for `TypeScript (NestJS + React)` — e.g., Semgrep for TypeScript, Bandit for Python
- Check frequency: on-commit via pre-commit (Semgrep CLI) + weekly CI

---

## 4. Pen-Test Strategy

**Approach:** `none`
**Scope:** (N/A pentest none)
**Vendor contact:** (N/A)
**Last test date:** (N/A)
**Next scheduled:** Re-evaluate when scaling to multi-tenant or integrating VAT (Milestone 2)

---

## 5. Bug Bounty (if applicable)

**Platform:** `none`
**Scope:** (N/A)
**Out of scope:** (N/A)
**Reward tier:**
- Critical: $(N/A)
- High: $(N/A)
- Medium: $(N/A)
- Low: $(N/A)
**Disclosure timeline:** (N/A)

---

## 6. Compliance Framework Mapping

**Framework:** `none (no GDPR — F-10; VAT integration treated as separate compliance event when activated)`

**Control list:**
Mapping for Phase 1 (none formal). Compensating practices: audit log retention 90d (FOUNDATION §9.5) + bcrypt password hash + cookie SameSite=Strict + ZAP DAST scan in /vg:test. Will re-evaluate when VAT integration phase begins (taxes / invoice retention have legal record-keeping rules in VN).
- CC6.1 (Logical access) → verify-authz-declared + FOUNDATION §9.5 session/identity
- CC7.2 (System monitoring) → FOUNDATION §9.5 audit log events
- A.12.4 (Logging/monitoring) → FOUNDATION §9.5 + deploy gate logs

---

## 7. Incident Response

**IR team contact:** Owner/dev (solo) — log issue trong audit log + manual investigation
**Escalation path:** {L1 → L2 → CTO within Xhrs}
**Public disclosure policy:** {immediate|7-day|30-day after fix}
**Post-mortem SLA:** {days to write post-mortem after incident closure}

---

## 8. Acceptable Residual Risk

**Threshold:** `{severity + max days}`

Examples:
- Critical severity: 0 days acceptable — must block ship
- High severity: 7 days acceptable with compensating control
- Medium severity: 30 days acceptable with scheduled fix
- Low severity: 90 days acceptable backlog

**Debt register integration:** security debt appended to `.vg/override-debt/register.jsonl` via `/vg:override-resolve`

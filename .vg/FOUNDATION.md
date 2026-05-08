# Foundation — OrderQuanBaLun

**Locked:** 2026-05-08T03:54:24Z
**Source:** first-time
**Source description:** Web ordering app cho quán ăn nhỏ — POS dine-in/takeaway/delivery. Solo dev, VPS hosting, MySQL, NestJS+React. No RBAC + audit log compensating control. VAT integration deferred.

## 1. Platform & Topology (8 dimensions)

**Namespace:** Tất cả FOUNDATION decisions dùng `F-XX` (project-level, stable across milestones). Per-phase decisions dùng `P{phase}.D-XX` ở `.vg/phases/*/CONTEXT.md`.

| # | Dimension | Value | Decision | Confidence |
|---|-----------|-------|----------|------------|
| 1 | Platform type | web-saas (single-tenant, 1 quán) | F-01 | confirmed (Round 4) |
| 2 | Frontend runtime | browser | F-02 | derived |
| 3 | Frontend framework | React + Vite | F-03 | confirmed (Round 4) |
| 4 | Backend topology | monolith with NestJS | F-04 | confirmed (Round 4) |
| 5 | Data layer | MySQL 8 (InnoDB) | F-05 | confirmed (Round 4) |
| 6 | Auth model | own login, capture actor for audit; **no RBAC** | F-06 | confirmed |
| 7 | Hosting | VPS (Hetzner / DO / Linode) | F-07 | confirmed (Round 4) |
| 8 | Distribution | mobile-first PWA primary, desktop secondary | F-16 supersedes F-08 | confirmed (drift fix 2026-05-08) |

## 2. Tech Stack (concrete choices)

- **Frontend** — React 19 + Vite + TypeScript (F-03)
- **Backend** — NestJS 10 + TypeScript + TypeORM (F-04)
- **Database** — MySQL 8 + InnoDB, charset `utf8mb4` (F-05)
- **Build/monorepo** — pnpm + Turborepo
- **Test** — Vitest (unit, FE+BE) + Playwright (E2E web) (§9.7)
- **Deploy** — rsync + pm2 (NestJS), GitHub Actions on push to main (§9.1)

## 3. Constraints

- **Scale:** ~50-200 đơn/ngày (medium tier, capacity tới <500), <20 nhân viên đồng thời (F-09)
- **Latency budget:** API p95 ≤ 500ms, p99 ≤ 1000ms (F-12)
- **Compliance:** VAT-invoice **deferred** sang phase riêng (Milestone 2). No GDPR. (F-10)
- **Team size:** Solo dev (F-11)
- **Budget tier:** bootstrapped — $20-40/tháng VPS mid-tier (F-13)
- **Backup:** weekly snapshot, retention 4 tuần (F-14, accepted with risk)
- **Timezone:** Asia/Ho_Chi_Minh (F-15)

## 4. Decisions

### F-01: Platform = web-saas (single-tenant)
**Reasoning:** Một quán, một chủ. Không có nhu cầu multi-tenant ở Milestone 1.
**Reverse cost:** HIGH — đổi sang multi-tenant = rewrite ~60-80% data layer + auth.
**Confirmed:** 2026-05-08 via Round 4.

### F-02: Frontend runtime = browser
**Reasoning:** "website" rõ ràng từ Round 1.
**Reverse cost:** LOW — implied.

### F-03: Frontend framework = React + Vite
**Reasoning:** Internal POS tool — không cần SEO. Vite dev fast, build nhanh, ecosystem React mạnh nhất ở VN.
**Reverse cost:** HIGH — đổi sang Next.js / Vue = rewrite UI ~70%.
**Confirmed:** 2026-05-08 via Round 4 (user override option A).

### F-04: Backend topology = monolith with NestJS
**Reasoning:** User override (Round 3.1) — NestJS opinionated với DI + decorator phù hợp project có audit log + module boundary rõ ràng. Monolith hợp lý cho 1 quán <500 đơn/ngày.
**Reverse cost:** HIGH — đổi sang Fastify/Express = rewrite controllers + DI; đổi sang microservices = re-architect deploy.
**Confirmed:** 2026-05-08 via Round 4.

### F-05: Database = MySQL 8 (InnoDB)
**Reasoning:** User override (Round 3.1) — phổ biến ở VN, hosting rẻ, tooling nhiều. JSON column adequate cho 3-cấp menu structure.
**Reverse cost:** HIGH — đổi sang Postgres/Mongo = data migration script + rewrite query layer.
**Confirmed:** 2026-05-08 via Round 4.

### F-06: Auth model = own login, no RBAC, audit log mandatory
**Reasoning:** User: "chưa cần phân quyền" (Round 1 ext §5). Compensating: audit log mandatory cho mọi mutation. Login bắt buộc để capture actor identity.
**Reverse cost:** MEDIUM — RBAC có thể add sau bằng middleware + role table; không phá schema chính.

### F-07: Hosting = VPS (Hetzner / DO / Linode)
**Reasoning:** User Round 3.2 — full control, deploy git+pm2+nginx, $5-15/tháng (sau bumped lên bootstrapped tier $20-40).
**Reverse cost:** HIGH — đổi sang cloud-managed (Vercel) = redeploy + CI/CD redo + DB migration.
**Confirmed:** 2026-05-08 via Round 4.

### F-08: Distribution = URL (web, responsive)
**Reasoning:** Implied from "website" + tablet/laptop staff usage.
**Reverse cost:** LOW.

### F-09: Scale = medium (<500 đơn/ngày, <20 staff đồng thời, delivery D2)
**Reasoning:** Round 3.3 — driver assigned + status (`đang ship` / `đã giao`). Không full GPS tracking.

### F-10: Compliance = VAT deferred, no GDPR
**Reasoning:** Round 3.4 → challenger #3 → user chose Defer. Phase 1 chỉ ghi payment trong DB. VAT integration sẽ là phase riêng (xem Q-01).

### F-11: Team size = solo
**Reasoning:** Round 5.1. Cost-aware models (executor=sonnet).

### F-12: Latency budget = p95 < 500ms (API)
**Reasoning:** Round 5.2 — POS feel-responsive cho nhân viên không lag.

### F-13: Budget tier = bootstrapped ($20-40/tháng)
**Reasoning:** Round 5.3 — VPS mid-tier (Hetzner CPX21 8GB) + backup storage.

### F-14: Backup = weekly only (accepted with risk)
**Reasoning:** Round 5.4 — user trade-off cho cost. Acknowledged: nếu DB crash giữa tuần có thể mất tới 6 ngày data.

### F-15: Timezone = Asia/Ho_Chi_Minh
**Reasoning:** Implied từ VN restaurant. Cần explicit để auto-pay 10h calculation đúng và báo cáo daily đúng cutoff.

### F-16 supersedes F-08: Distribution = mobile-first PWA primary, desktop secondary
**Reasoning:** User clarified ở /vg:specs 01 (post-approval): "mô hình này sử dụng trên điện thoại là chủ yếu". Áp dụng cho TẤT CẢ phase sau (FE convention).
**Reverse cost:** MEDIUM — FE component library + viewport / breakpoint convention re-thiết kế nếu sau cần desktop-primary. Schema dữ liệu không bị ảnh hưởng.
**Confirmed:** 2026-05-08 (drift fix at /vg:phase 01 entry).
**Implications:**
- §9.6 bundle FE route ≤ 150KB gzip (siết từ 300KB).
- §9.6 thêm Time-to-Interactive ≤ 3s trên Slow-4G.
- Mobile-first UX baseline: viewport meta, touch target 44×44px, native input types, bottom navigation, no hover-only interactions.
- Test harness phải có Playwright mobile device profile (iPhone SE + Galaxy A5x mặc định).

### F-17 supersedes §9.5 auth (LOCK update): JWT 7-day in cookie HttpOnly
**Reasoning:** User clarified ở /vg:specs 01 Q-clarification: dùng JWT thay vì cookie session. JWT 7 ngày phù hợp mobile UX (nhân viên không phải login lại mỗi ca).
**Reverse cost:** MEDIUM — đổi sang opaque cookie session sẽ phải bỏ JTI blacklist + thêm session table. Không phá DB schema chính.
**Confirmed:** 2026-05-08 (drift fix at /vg:phase 01 entry).
**Locked specifics (replaces §9.5 session block):**
- Mechanism: JWT signed (HS256 với strong secret từ `.env`, có thể chuyển RS256 sau).
- Payload: `{sub: user_id, name, iat, exp, jti}` — KHÔNG nhúng PII / role.
- Storage: cookie `HttpOnly + Secure + SameSite=Strict` (BANNED localStorage).
- Lifetime: 7 ngày (refresh-rotate defer sang phase sau).
- Revocation: `revoked_jwt_jti(jti, revoked_at_ms, expires_at_ms)` table; middleware kiểm tra blacklist mỗi request; cron daily xoá row đã expired.

## 5. Open Questions

- **Q-01 — VAT e-invoice timing & retry semantics**
  - Decision needed at: VAT-integration phase (Milestone 2)
  - Proposed default: Outbox pattern — record `invoice_request(status=PENDING, idempotency_key=payment_id)` tại payment-success event; worker retry exponential backoff; alert nếu PENDING > 30 phút; owner pending-review chỉ update logic nội bộ, không re-issue invoice.

## 6. Acknowledged Tradeoffs

- **No RBAC** — Why: quán nhỏ, chủ tin nhân viên. Compensating: audit log mandatory với actor + before/after, retention 90d. Revisit nếu mở chi nhánh hoặc nhân viên >20.
- **Auto-pay 10h** — Why: tránh bàn bỏ quên không thanh toán. Compensating: chỉ đánh dấu pending-review, owner duyệt end-of-day chốt thật.
- **Backup weekly only** — Why: cost trade-off. Mitigation: document recovery procedure, manual snapshot trước event cao điểm (Tết/lễ).

## 7. Drift Check

**Last check:** 2026-05-08
**Status:** ⚠ 2 drift resolved (2026-05-08 at /vg:phase 01 entry).
**Drift entries:**
- F-08 superseded by **F-16** (mobile-first PWA primary, desktop secondary). Source: /vg:specs 01 user clarification "mô hình này dùng trên điện thoại là chủ yếu". Closure mechanism: F-16 row above + companion §9.6 budget update.
- §9.5 auth-mechanism updated by **F-17** (JWT 7d in cookie HttpOnly, JTI blacklist on logout). Source: /vg:specs 01 Q-clarification round. Closure mechanism: F-17 entry above + §9.5 session block update + §9.1 auth update.

---

## 8. Companion artifacts

- `.vg/PROJECT.md` — identity + REQ-A..H + Milestone 1 scope.
- `.vg/SECURITY-TEST-PLAN.md` — DAST tool (ZAP) + risk profile (moderate) + pentest (none).
- `.claude/vg.config.md` — auto-derived workflow config (port, deploy command, model selection).

---

## 9. Architecture Lock

> Locked 2026-05-08T03:54:24Z via `/vg:project` Round 7.
> Section 9 is authoritative — every blueprint planner prompt injects this as `<architecture_context>`.
> Changes here require `/vg:project --update` + re-running affected phases' scope (CONTEXT drift detection).

### 9.1 Tech stack matrix

```yaml
language:
  frontend: TypeScript 5 + React 19
  backend:  TypeScript 5 + NestJS 10
db:
  primary:   MySQL 8 (InnoDB, utf8mb4)
  cache:     in-memory (no Redis at phase 1)
auth:
  session:   JWT (HS256) in cookie HttpOnly + Secure + SameSite=Strict   # F-17
  password:  bcrypt cost 10, length ≥ 8
  lifetime:  7 days (mobile UX — F-17 supersedes 12h)
  jti_blacklist: revoked_jwt_jti table (cron daily prunes expired)
deploy:
  api:       rsync + pm2 reload
  web:       static build → nginx
  ci:        GitHub Actions on push to main
```

### 9.2 Module boundary

- `apps/web → packages/ui-kit` (allowed)
- `apps/api → packages/schemas` (allowed — DTO/entity types share)
- `apps/web → apps/api` chỉ qua HTTP (BANNED direct import — keep boundary clear)
- `packages/* → apps/*` BANNED (always)

### 9.3 Folder convention

```
apps/api/src/modules/{feature}/
  ├── {feature}.controller.ts
  ├── {feature}.service.ts
  ├── {feature}.module.ts
  ├── entities/{feature}.entity.ts
  ├── dto/{feature}.dto.ts
  └── {feature}.spec.ts          # colocated unit test

apps/web/src/features/{feature}/
  ├── components/
  ├── hooks/
  ├── pages/
  └── {feature}.spec.tsx

apps/web/e2e/                     # Playwright, separate from feature dirs
packages/schemas/                  # shared zod / typeorm types
packages/ui-kit/                   # shared React components
```

### 9.4 Cross-cutting concerns

- **Logging:** `nestjs-pino` — structured JSON, redact password/token fields automatically.
- **Error handling:** throw + NestJS global exception filter + structured error response.
- **Async:** async/await consistently. Long jobs (auto-pay scan, daily report) → BullMQ deferred to phase có cron worker.
- **i18n:** `vi` only (Phase 1). Strings centralized cho key extraction sau.

### 9.5 Security baseline (LOCK ONCE — updated by F-17 on 2026-05-08)

```yaml
session:                                            # F-17 (was: cookie session 12h)
  mechanism:    JWT (HS256, signed with .env secret)
  storage:      cookie (HttpOnly + Secure + SameSite=Strict)   # KHÔNG localStorage
  lifetime_d:   7                                              # mobile UX
  jti_blacklist_table: revoked_jwt_jti                          # logout/change-password revoke
  jwt_payload:  ["sub", "name", "iat", "exp", "jti"]            # KHÔNG nhúng PII / role
cors:
  origins:      [explicit FE origin only]    # no wildcard with credentials
password:
  hash:         bcrypt
  cost:         10
  min_length:   8
2fa:            none                         # phase 1 — revisit if multi-tenant
audit_log:
  scope:        [cancel, edit, payment, transfer, auto_pay]
  fields:       [actor_id, actor_name, ip, ts_ms, before, after]
  retention_d:  90
tls:
  min_version:  "1.2"
  hsts_max_age: 31536000
  hsts_include_subdomains: true
headers:
  csp:               "default-src 'self'"
  x_frame_options:   DENY
  x_content_type:    nosniff
secret_management: ".env (owner-only, .gitignore)"
deps:
  lockfile:        pnpm-lock.yaml
  cve_scan:        pnpm audit on CI
backup:
  schedule:        weekly
  retention_w:     4
  encryption:      "AES-256 at rest (VPS disk encryption)"
compliance: [none]                # F-10: VAT deferred to Milestone 2
```

### 9.6 Performance baseline (updated by F-16 on 2026-05-08 — mobile-first)

```yaml
api:
  read_p95_ms:    250
  write_p95_ms:   500
  api_p99_ms:     1000
cache:
  strategy:       "in-memory LRU TTL 5m for menu (read-heavy)"
bundle:
  fe_route_kb:    150              # F-16: siết từ 300KB cho mobile 4G (gzip)
mobile:                            # F-16 NEW
  tti_slow_4g_s:  3                # Time-to-Interactive on Slow-4G (DevTools throttle)
  viewport_meta:  "width=device-width, initial-scale=1, maximum-scale=1"
  touch_target_px: 44              # min button/link tap area (Apple HIG)
  test_devices:   ["iPhone-SE-320x568", "Galaxy-A5x-412x915"]
  no_hover_only:  true             # mobile has no hover state
n_plus_one_max:   3                # warning when exceeded
cdn:              none             # phase 1 single VPS
```

### 9.7 Testing baseline

```yaml
unit_runner:        vitest
e2e_framework:      playwright
coverage_threshold: 70             # solo dev — pragmatic
mock_strategy:
  api_in_fe:        MSW
  db:               never_mock     # use MySQL test container
fixture_location:   apps/web/e2e/fixtures/
```

### 9.8 Model-portable code style

```yaml
imports:           explicit          # no wildcard *
exports:           named             # default export only for React.lazy / dynamic
type_annotations:  mandatory function signatures (params + return)
comment_density:   1 / ~10 SLOC, only WHY
import_ordering:   external → internal-package → relative
file_naming:
  service_util:    kebab-case.ts
  component:       PascalCase.tsx
  test:            "*.spec.ts(x)"
error_idiom:       throw + narrow catches    # NestJS standard
```

### 9.9 UI state conventions (v2.8.4 Phase J)

```yaml
list_view_state_in_url: true        # MANDATORY default — refresh giữ filter/sort/page
url_param_naming:       kebab        # status, sort-by, page-size
array_format:           csv          # ?tags=a,b,c
debounce_search_ms:     300
default_page_size:      20
```

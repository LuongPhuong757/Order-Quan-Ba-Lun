# Phase 01 — Foundation & Auth Infrastructure — CONTEXT

Generated: 2026-05-08
Source: /vg:scope structured discussion (5 rounds + Deep Probe)
Phase: 01-foundation-auth-audit
SPECS reference: `.vg/phases/01-foundation-auth-audit/SPECS.md`
FOUNDATION reference: `.vg/FOUNDATION.md`

## Decisions

**Namespace:** IDs are `P01.D-XX` (per-phase scope, distinct from project-level F-XX in FOUNDATION).

### P01.D-01: User stories cho Phase 01
**Category:** business
**Decision:** 5 user stories chính cho phase auth + audit:
- US-01: Owner tạo + reset password user
- US-02: Staff login + dùng dashboard
- US-03: Owner xem audit log + filter + export CSV
- US-04: User đổi password chính mình
- US-05: Hệ thống cron prune audit log > 90d + JTI expired
**Rationale:** Cover happy path cho cả owner (admin) lẫn staff (regular user) + maintenance jobs. Đủ cho Milestone 1 MVP.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-01: US-01 happy path → owner create user → user login OK (verification_strategy: automated E2E)
- TS-02: US-04 → user change own password → old JWT 401, new JWT works (automated integration)

### P01.D-02: Roles owner / staff (no fine-grained RBAC)
**Category:** business
**Decision:** 2 vai trò binary: `owner` (chủ quán, có `is_owner=true`) + `staff` (mọi nhân viên khác, `is_owner=false`). Không có role table / permission table.
**Rationale:** Đồng nhất F-06 (no RBAC at phase 1). Quán nhỏ, chủ tin nhân viên. Audit log compensating control truy vết khi cần.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-03: staff call /admin/* → 403 ADMIN_REQUIRED (automated integration)
- TS-04: owner call /admin/* → 200 (automated integration)

### P01.D-03: Business rules BR-1..7
**Category:** business
**Decision:** 7 business rules:
- BR-1: Audit log immutable (no UPDATE/DELETE endpoint, schema test)
- BR-2: JWT 7 ngày trong cookie HttpOnly + SameSite=Strict (F-17)
- BR-3: Failed login rate-limit 5 fail / 5 phút / IP → 401 + Retry-After:900
- BR-4: Logout = JTI vào `revoked_jwt_jti` blacklist
- BR-5: Mobile-first FE (F-16) — touch 44×44, viewport, bundle ≤ 150KB gzip
- BR-6: Admin endpoints check `is_owner=true` flag (binary, no RBAC table)
- BR-7: Mọi mutation ghi audit log với actor + IP + timestamp + before/after
**Rationale:** Khoá invariant nghiệp vụ làm baseline cho mọi endpoint mutation.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-05: schema test confirm no UPDATE/DELETE on audit_log (automated unit)
- TS-06: BR-3 rate-limit verify (automated integration with faketime)
- TS-07: BR-7 mutation auto-creates audit_log row (automated integration)

### P01.D-04: Owner self-recovery via 1-time recovery code
**Category:** technical
**Decision:** Khi /setup tạo owner đầu tiên → server random 16 ký tự code → hiển thị 1 lần trên UI cho owner save (in/screenshot/copy). DB lưu bcrypt hash của code. POST /auth/recover {code, new_password} → verify hash → update password + tv++. Code 1-time use (sau dùng → bcrypt hash đổi để code cũ vô hiệu).
**Rationale:** Owner là root account, không ai reset hộ. Mất code = lock-out (chấp nhận risk). Hash trong DB đảm bảo DB breach không lộ code.
**Quote source:** DISCUSSION-LOG.md#round-1-deep-probe-1
**Endpoints:**
- POST /auth/recover (auth: recovery_code, purpose: reset password owner khi quên)
**UI Components:**
- RecoverPage: form code + new_password
- SetupCompletePage: hiển thị 1-time code với cảnh báo "save ngay, sẽ không hiển thị lại"
**Test Scenarios:**
- TS-08: /recover với valid code → password reset + tv++ (automated integration)
- TS-09: /recover với code đã dùng → 401 RECOVERY_CODE_INVALID (automated integration)
- TS-10: code lưu là bcrypt hash, plaintext không tồn tại trong DB (automated unit)

### P01.D-05: First owner bootstrap qua web UI /setup
**Category:** technical
**Decision:** Khi DB users empty + request từ IP whitelisted (env `SETUP_ALLOWED_IP`) → render trang /setup với form {username, password}. Submit → tạo owner + sinh recovery code + redirect /login. Sau khi owner tồn tại → /setup trả 404.
**Rationale:** Web UI thân thiện hơn CLI script. IP gate chống setup race trên prod public.
**Quote source:** DISCUSSION-LOG.md#round-1-deep-probe-2
**Endpoints:**
- GET /setup (auth: none, purpose: render setup form khi DB empty + IP allowed)
- POST /setup (auth: none + IP gate, purpose: tạo owner đầu tiên + recovery code)
**UI Components:**
- SetupPage: form username + password + strength meter
**Test Scenarios:**
- TS-11: /setup khi DB empty + IP whitelisted → render form (automated integration)
- TS-12: /setup khi owner tồn tại → 404 (automated integration)
- TS-13: /setup race (2 concurrent requests) → exactly 1 owner created (automated concurrency)

### P01.D-06: Offboarding immediate revoke (disable user)
**Category:** technical
**Decision:** POST /admin/users/:id/disable → set users.is_active=false + tv++ → middleware kiểm tra is_active mỗi request (revoke immediate, không chờ JWT exp 7d).
**Rationale:** Nhân viên nghỉ ấm ức = rủi ro phá hoại. Đóng 7d window. Cùng cơ chế tv với password change.
**Quote source:** DISCUSSION-LOG.md#round-1
**Endpoints:**
- POST /admin/users/:id/disable (auth: OwnerGuard, purpose: vô hiệu hoá nhân viên ngay lập tức)
**UI Components:**
- UsersListPage: button "Disable" với confirm dialog
**Test Scenarios:**
- TS-14: disable user → JWT cũ 401 ngay request tiếp theo (automated integration)
- TS-15: disabled user re-login → 401 AUTH_INACTIVE_USER (automated integration)

### P01.D-07: Meta-audit (log audit log access)
**Category:** technical
**Decision:** Mỗi GET /admin/audit + GET /admin/audit/export.csv → ghi 1 row audit_log với action_kind = `audit.viewed` / `audit.exported` + filter params.
**Rationale:** Audit immutable nhưng nếu owner xem lén không log → mất tính răn đe. Phòng tranh chấp khi multi-owner sau.
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-16: owner GET /admin/audit → audit_log row "audit.viewed" với filter params (automated integration)

### P01.D-08: Token version mechanism (gộp revocation password-change + offboarding)
**Category:** technical
**Decision:** Thêm cột `users.token_version INT NOT NULL DEFAULT 0`. JWT payload chứa `tv` claim = token_version lúc issue. JwtAuthGuard verify `JWT.tv === users.token_version` → mismatch = 401 AUTH_TOKEN_REVOKED. Password change + admin reset password + admin disable user → tv++. Logout đơn lẻ vẫn dùng JTI blacklist.
**Rationale:** Một cơ chế revoke cho 3 use case (password change, reset, disable). Đóng Open Question từ R1 challenger #1.
**Quote source:** DISCUSSION-LOG.md#round-2-challenger-1
**Constraints:** payload `tv` claim mỗi lần issue JWT phải match DB tại thời điểm đó.
**Test Scenarios:**
- TS-17: change password → tv++ → JWT cũ 401 (automated integration)
- TS-18: reset password (admin) → tv++ → JWT cũ 401 (automated integration)
- TS-19: disable user → tv++ → JWT cũ 401 (automated integration, đã cover ở TS-14)

### P01.D-09: Error response envelope + code enum
**Category:** technical
**Decision:** Format chuẩn cho error response: `{error: {code: <string>, message: <vi-string>, request_id: <uuid>, ts_ms: <int>}}`. Code enum centralize ở `packages/schemas/src/errors.ts`: AUTH_INVALID_CRED, AUTH_RATE_LIMITED, AUTH_TOKEN_REVOKED, AUTH_TOKEN_EXPIRED, AUTH_INACTIVE_USER, ADMIN_REQUIRED, OWN_PASSWORD_WRONG, RECOVERY_CODE_INVALID, SETUP_ALREADY_DONE, VALIDATION_FAILED, INTERNAL_ERROR.
**Rationale:** FE dùng code cho i18n + audit_log query. Tránh parse message string fragile.
**Quote source:** DISCUSSION-LOG.md#round-2-expander-1
**Constraints:** Mọi endpoint MUST trả error theo envelope này. NestJS Global ExceptionFilter convert HttpException → envelope.
**Test Scenarios:**
- TS-20: trigger 401 → response shape khớp envelope (automated unit)
- TS-21: code enum đầy đủ trong packages/schemas (automated unit)

### P01.D-10: Trust proxy + request_id correlation
**Category:** technical
**Decision:** NestJS app.set('trust proxy', 1) — req.ip lấy từ X-Forwarded-For (nginx forward). Middleware nestjs-pino auto inject request_id (uuid) vào log + audit_log + response header X-Request-Id.
**Rationale:** Nginx loopback IP 127.0.0.1 vô hiệu F-13 forensic. Solo dev cần correlation_id để debug prod.
**Quote source:** DISCUSSION-LOG.md#round-2-expander-2,3
**Constraints:** Behind nginx; trust level 1 (single proxy).
**Test Scenarios:**
- TS-22: request qua nginx → audit_log.ip = real client IP (automated integration)
- TS-23: response header X-Request-Id matches log line + audit_log row (automated integration)

### P01.D-11: Migration test in CI before deploy
**Category:** technical
**Decision:** GitHub Actions workflow `.github/workflows/test-migration.yml`: dump prod schema (read-only, post Phase 01 deploy) → import vào DB tạm → chạy migration:run → verify schema. Fail → block deploy.
**Rationale:** Migration fail giữa chừng prod = lock login toàn site. Catch sớm.
**Quote source:** DISCUSSION-LOG.md#round-2-expander-4
**Test Scenarios:**
- TS-24: migration:run on clean DB → 5 tables created với schema khớp entity (automated CI)
- TS-25: migration:revert → schema rollback OK, không lock data (automated CI, từ P01.D-21)

### P01.D-12: CSRF protection cho /admin/* mutations
**Category:** technical
**Decision:** Cookie SameSite=Strict (F-17 đã LOCK) + middleware kiểm tra `Origin` / `Referer` header request POST/PUT/DELETE/PATCH match origin FE → OK. Nếu thiếu/khớp sai → 403.
**Rationale:** Phase 1 same-domain (P01.D-13) → SameSite Strict đủ chặn. Origin check thêm defense-in-depth.
**Quote source:** DISCUSSION-LOG.md#round-3-expander-1
**Constraints:** chỉ apply mutation methods, GET/HEAD safe-by-design.
**Test Scenarios:**
- TS-26: POST /admin/users from valid Origin → 200 (automated integration)
- TS-27: POST /admin/users from foreign Origin → 403 (automated integration)

### P01.D-13: CORS = same-domain (no CORS config needed)
**Category:** technical
**Decision:** VPS serve FE static qua nginx + API qua nginx reverse-proxy `/api/*`. FE và API cùng origin (vd `https://order-quan-balun.com`). Không cần CORS middleware.
**Rationale:** Đơn giản hoá deploy. Cookie auth + same-origin = no CORS preflight.
**Quote source:** DISCUSSION-LOG.md#round-3-expander-2
**Test Scenarios:**
- TS-28: nginx config kiểm tra reverse-proxy /api/* hoạt động (automated CI smoke)

### P01.D-14: OpenAPI spec + class-validator DTOs
**Category:** technical
**Decision:** Install `@nestjs/swagger` + `class-validator` + `class-transformer`. Decorate controller (@ApiTags, @ApiOperation) + DTO class (@IsString, @MinLength, @IsEmail). Spec serve `/api/docs` (dev only, disabled in prod). DTO validation auto trả 422 với error.code=VALIDATION_FAILED + field details.
**Rationale:** Contract giữa FE-BE + tự động validate input.
**Quote source:** DISCUSSION-LOG.md#round-3-expander-3
**Test Scenarios:**
- TS-29: invalid DTO field → 422 với envelope + field detail (automated integration)
- TS-30: /api/docs render OpenAPI spec (automated integration)

### P01.D-15: HTTP status code conventions
**Category:** technical
**Decision:** Locked mapping:
- 200 OK: GET / POST có data trả về
- 201 Created: POST tạo resource mới (admin create user, /setup)
- 204 No Content: idempotent mutation no-body (logout, disable)
- 400 Bad Request: malformed JSON / missing required header
- 401 Unauthorized: no token / invalid token / token revoked / expired / inactive user
- 403 Forbidden: token valid nhưng thiếu role (staff call /admin/*)
- 422 Unprocessable Entity: validation fail (DTO check)
- 429 Too Many Requests: rate-limit (login fail 5/5min)
**Rationale:** FE error handler switch(status) deterministic. Audit log status_code field nhất quán.
**Quote source:** DISCUSSION-LOG.md#round-3-expander-4
**Test Scenarios:**
- TS-31: mỗi endpoint trả đúng status code theo bảng (automated integration matrix)

### P01.D-16: Form validation UX = on-blur + inline error
**Category:** technical
**Decision:** Validate khi user blur (rời) field + show error message inline dưới field (red text 14px). Submit button disable khi có error. On-submit click → validate toàn bộ + show all errors.
**Rationale:** On-blur là chuẩn mobile, không bực mình.
**Quote source:** DISCUSSION-LOG.md#round-4-expander-1
**UI Components:**
- Form: validation hooks
- Input: error prop renders red border + message below
**Test Scenarios:**
- TS-32: blur empty field → inline error "Bắt buộc nhập" (automated E2E)
- TS-33: submit invalid form → all field errors shown (automated E2E)

### P01.D-17: Session expiry UX = re-login modal preserves state
**Category:** technical
**Decision:** Axios interceptor catch 401 → mở modal re-login (input password) → success → retry original request. Giữ state UI (filter, scroll position).
**Rationale:** Mất state trong UX 7d session = data loss + bực. Modal mượt hơn redirect.
**Quote source:** DISCUSSION-LOG.md#round-4-expander-2
**UI Components:**
- ReLoginModal: chỉ password (username read-only)
- AxiosClient: 401-interceptor singleton
**Test Scenarios:**
- TS-34: JWT expire mid-request → modal hiển thị → re-login → request retry success (automated E2E)
- TS-35: re-login fail → vẫn modal, không redirect (automated E2E)

### P01.D-18: Error message tone = friendly VN
**Category:** technical
**Decision:** Error messages thân thiện, conversational: "Ôi, sai mật khẩu rồi. Thử lại nhé!" / "Mạng chậm quá, thử lại sau vài giây nhé." / "Dữ liệu thiếu, bạn nhập tên vào nhé." Centralize ở `apps/web/src/i18n/errors.vi.ts`.
**Rationale:** Quán nhỏ, nhân viên không tech → cần thân thiện.
**Quote source:** DISCUSSION-LOG.md#round-4-expander-3
**Test Scenarios:**
- TS-36: trigger lỗi 401 → toast hiển thị message friendly VN, không "401 Unauthorized" (automated E2E)

### P01.D-19: Password input UX = show/hide + zxcvbn meter ở /setup
**Category:** technical
**Decision:** Mọi password input: button toggle 👁 (eye icon) show/hide. Caps Lock warning khi detect. Setup form (/setup) thêm zxcvbn strength meter (~20KB bundle, chấp nhận trade-off cho admin password).
**Rationale:** Mobile gõ password dễ sai, show/hide UX +. Setup là 1-time, password mạnh quan trọng.
**Quote source:** DISCUSSION-LOG.md#round-4-expander-4
**UI Components:**
- PasswordInput: toggle visibility + caps-lock detect
- StrengthMeter: zxcvbn integration (chỉ Setup form)
**Test Scenarios:**
- TS-37: click eye icon → password hiển thị plaintext (automated E2E)
- TS-38: caps lock on → warning hiển thị (automated E2E manual verification)
- TS-39: weak password ở /setup → meter red + warning (automated E2E)

### P01.D-20: E2E mobile = Playwright Chromium emulation + manual smoke
**Category:** technical
**Decision:** E2E test dùng Playwright Chromium với mobile device profiles iPhone SE (375×667) + Galaxy A5x (360×800). Chỉ Chromium (không Safari/WebKit). Document giới hạn rõ ràng. Bổ sung manual smoke checklist 5 phút trên iPhone thật trước mỗi release.
**Rationale:** Real-device farm vượt budget F-13. Chromium emulation OK cho 80% cases.
**Quote source:** DISCUSSION-LOG.md#round-5-challenger
**Test Scenarios:**
- TS-40: Playwright iPhone SE viewport → /login render đúng (automated E2E)
- TS-41: Playwright Galaxy A5x → /admin/audit table → card stack (automated E2E)
- TS-42: manual smoke checklist documented in RUNBOOK (manual)

### P01.D-21: Rollback drill + flaky test budget
**Category:** technical
**Decision:**
- Rollback drill: CI test chạy migration:run → migration:revert → migration:run lại. Verify schema state nhất quán.
- Flaky budget: max 2 retries per test. Test fail 3 lần → quarantine với tag @flaky. Weekly review @flaky tests.
**Rationale:** Migration revert quan trọng cho prod safety. Flaky budget tránh CI noise.
**Quote source:** DISCUSSION-LOG.md#round-5-expander-1,2
**Test Scenarios:**
- TS-43: migration:run → :revert → :run idempotent (automated CI, đã cover ở TS-25)
- TS-44: vitest config có retries: 2 (automated unit)

### P01.D-22: Load test deferred to Milestone 2
**Category:** technical
**Decision:** Phase 1 chỉ verify p95 < 500ms qua test đơn lẻ (1 user). Load test 100 user/s với k6 defer sang Milestone 2 (deploy/perf-tune phase) khi có traffic thực.
**Rationale:** Quán nhỏ <20 staff đồng thời, p95 đơn lẻ đủ baseline. Tránh setup k6 + scope creep.
**Quote source:** DISCUSSION-LOG.md#round-5-expander-3

### P01.D-23: Test data privacy rules
**Category:** technical
**Decision:**
- Rule 1: Mọi fixture dùng faker.js (`@faker-js/faker`) — tên giả, email giả, password generated.
- Rule 2: KHÔNG commit dump production data vào repo test.
- Rule 3: `.env.test` riêng biệt, không đụng `.env` prod. Pre-commit hook check.
- Document trong README.
**Rationale:** Tránh PII leak qua git history.
**Quote source:** DISCUSSION-LOG.md#round-5-expander-4
**Test Scenarios:**
- TS-45: pre-commit hook reject `.env` commits + fixture chỉ chứa faker data (automated CI)

### P01.D-24: Setup wizard exposure guard (race + lock-out)
**Category:** technical
**Decision:** /setup endpoint guard 2 lớp:
- (a) Server check `users.count() === 0` trong transaction (atomic)
- (b) Server check `req.ip === process.env.SETUP_ALLOWED_IP` (admin IP whitelist)
- Sau khi tạo owner thành công → /setup return 404 cho mọi request sau.
- DB constraint: chỉ 1 owner cho phép (UNIQUE WHERE is_owner=true) — phase 1 single owner.
**Rationale:** Đóng race condition + cấm setup từ public. Đối ứng P01.D-05 web UI.
**Quote source:** DISCUSSION-LOG.md#round-1-deep-probe-2
**Constraints:** SETUP_ALLOWED_IP env phải set trước first-deploy. Document trong RUNBOOK.
**Test Scenarios:**
- TS-46: /setup từ unauthorized IP → 403 + audit log "setup.blocked.ip" (automated integration)
- TS-47: /setup race 2 concurrent requests → exactly 1 owner (automated concurrency, đã cover TS-13)

### P01.D-25: Audit log async (EventEmitter / setImmediate)
**Category:** technical
**Decision:** NestJS interceptor `AuditInterceptor` capture mutation request → push event vào EventEmitter (built-in @nestjs/event-emitter) → handler async insert audit_log row. Response không block waiting INSERT.
**Rationale:** Performance F-12 (p95 < 500ms). Risk: process crash giữa lúc audit chưa flush → mất row. Acceptable cho phase 1 (Solo dev quán nhỏ). Phase sau add Bull job queue if needed.
**Quote source:** DISCUSSION-LOG.md#round-1-deep-probe-3
**Test Scenarios:**
- TS-48: 100 mutations / 1s → tất cả audit_log row được persist trong < 5s (automated integration with sleep)
- TS-49: process crash mid-audit → known data loss boundary (manual test, document RUNBOOK)

### P01.D-26: Rate limit data store = in-memory (@nestjs/throttler default)
**Category:** technical
**Decision:** Dùng `@nestjs/throttler` với default in-memory store. Restart VPS → reset state (acceptable). Phase 1 single-instance, không cần Redis/MySQL store.
**Rationale:** F-12 latency, F-13 budget. Tránh Redis infrastructure.
**Quote source:** DISCUSSION-LOG.md#round-1-deep-probe-4
**Test Scenarios:**
- TS-50: 5 fail logins → 401 + Retry-After 900s (automated integration with faketime, đã cover TS-06)
- TS-51: VPS restart → rate-limit state reset (manual test documented)

### P01.D-27: Email link friction acceptance
**Category:** technical
**Decision:** Cookie SameSite=Strict (F-17) → click link từ email future → cookie không gửi → redirect /login. Document trong RUNBOOK. Phase 1 chưa có email feature → no immediate impact.
**Rationale:** Giữ F-17 nguyên. Defer Lax-mode đổi đến phase email-integration nếu cần.
**Quote source:** DISCUSSION-LOG.md#round-1-deep-probe-5

### P01.D-28: Audit log access logging implementation detail
**Category:** technical
**Decision:** P01.D-07 audit-views = log `audit.viewed` cho GET /admin/audit + `audit.exported` cho /admin/audit/export.csv. Filter params + ts ghi vào audit_log.before_json={filter, page}, after_json=null.
**Rationale:** P01.D-07 nâng level từ "decision" → "implementation contract".
**Quote source:** DISCUSSION-LOG.md#round-1
**Test Scenarios:**
- TS-52: GET /admin/audit?actor=X&from=Y → audit_log row với action_kind=audit.viewed + before_json chứa filter (automated integration)

## Acknowledged tradeoffs

- **No fine-grained RBAC** (P01.D-02): F-06 carry-over. Compensating: audit log mandatory + meta-audit log access (P01.D-07).
- **Audit log async** (P01.D-25): process crash mid-audit → mất row khả thi. Acceptable cho Solo dev phase 1.
- **E2E Chromium-only** (P01.D-20): không catch Safari/WebKit specific bugs. Compensating: manual smoke 5 phút trên iPhone thật.
- **Rate limit in-memory** (P01.D-26): VPS restart reset state. Acceptable single-instance phase 1.
- **Email link friction** (P01.D-27): SameSite=Strict block cross-site cookie. Acceptable vì phase 1 không có email feature.
- **Recovery code lock-out risk** (P01.D-04): mất code = không recover được. Acceptable vì owner-pre-warned + bcrypt hash protection.

## Acknowledged gaps

- **Load test** (P01.D-22): Defer to Milestone 2. p95 đơn lẻ đủ baseline phase 1.
- **Real-device E2E** (P01.D-20): Defer to Milestone 2 (BrowserStack ~$30/mo vượt budget F-13).
- **Bull job queue cho audit** (P01.D-25): Defer khi traffic tăng > 100/s.
- **Refresh token rotation** (SPECS): Phase 1 dùng JWT đơn 7d, defer rotation.

## Open questions

- **Q-P01-01 — Recovery code retention sau dùng?** Hiện tại spec là "1-time use" (P01.D-04). Nhưng row `recovery_codes` sau khi used: delete (mất forensic) hay mark used=true (DB grow)? → quyết ở /vg:blueprint khi finalize schema.
- **Q-P01-02 — JWT signature key rotation strategy?** Hiện manual swap .env → all current users 401. No rolling rotation. Document trong RUNBOOK phase deploy. → quyết ở phase deploy/ops.
- **Q-P01-03 — Token version overflow?** INT 4 bytes = 2^31 increments. Không khả thi tới hạn nhưng nên BIGINT. → quyết ở /vg:blueprint schema.

## Summary

- Total decisions: 28 (P01.D-01 → P01.D-28)
- Endpoints noted: 13 (login, logout, me, change-password, recover, setup get/post, admin-users-create/list/reset/disable, admin-audit-list/csv, health)
- UI components noted: 10+ (Button, Input, Form, Modal, Table, Toast, EmptyState, Spinner, ErrorBoundary, AuthGuard, RecoverPage, SetupPage, UsersListPage, ReLoginModal, PasswordInput, StrengthMeter)
- Test scenarios noted: 52 (TS-01 → TS-52)

## Deferred Ideas

- Real-device E2E farm (Milestone 2 budget allow)
- Refresh token rotation (Milestone 2 if mobile app)
- Email reset password flow (Milestone 2 with SMTP)
- 2FA TOTP (Milestone 2 if multi-tenant)
- Bull queue cho audit (when traffic > 100 mutation/s)
- Load test với k6 (Milestone 2 perf-tune phase)
- Dark mode (Nice-to-have, future)
- WCAG AAA + extensive screen reader (Nice-to-have)
- PWA offline queue mutations (Nice-to-have)
- Pull-to-refresh + swipe gestures (Nice-to-have)

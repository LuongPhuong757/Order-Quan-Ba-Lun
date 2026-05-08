---
phase: "01"
profile: infra
platform: web-fullstack
status: approved
created_at: 2026-05-08
source: user-guided
---

## Goal

Cài đặt tầng nền tảng auth (đăng nhập / đăng xuất) + audit log infrastructure
cho toàn dự án OrderQuanBaLun. Mọi phase sau đều dựa vào tầng này để capture
actor identity, log mutation, và đảm bảo compliance no-RBAC compensating
control (FOUNDATION F-06).

## Scope

### In Scope

#### API Auth
- `POST /auth/login` — issue JWT (mobile-friendly, lưu trong cookie HttpOnly).
- `POST /auth/logout` — invalidate JTI (đưa vào blacklist).
- `GET /auth/me` — whoami (FE auth-guard dùng).
- `POST /auth/change-password` — đổi mật khẩu cho chính user (sau khi login).

#### Token mechanism
- **JWT signed** (HS256 với strong secret từ `.env`, sau có thể chuyển RS256 nếu cần).
- Payload tối thiểu: `{sub: user_id, name, iat, exp, jti}` — KHÔNG nhúng PII / role.
- **Storage**: cookie `HttpOnly + Secure + SameSite=Strict` (KHÔNG localStorage để chống XSS đọc).
- **Lifetime**: **7 ngày** (mobile UX — nhân viên không phải login lại mỗi ca). Refresh-rotate defer sang phase sau.
- **Revocation**: bảng `revoked_jwt_jti(jti VARCHAR(64) PRIMARY KEY, revoked_at_ms BIGINT, expires_at_ms BIGINT)` — middleware kiểm tra blacklist mỗi request. Cron daily xoá row đã `expires_at_ms < now()`.

#### Admin user management
- `POST /admin/users` — owner tạo account (username + password ban đầu) cho nhân viên.
- `GET /admin/users` — list user.
- `POST /admin/users/:id/reset-password` — owner generate password tạm cho user (staff hỏi miệng owner).
- `DELETE /admin/users/:id` — disable user (soft delete, giữ history audit).
- Seed script: 1 owner account khi init DB (username `admin`, password `admin123` — bắt đổi password lần đầu login).

#### FE pages (mobile-first)
- `/login` — form username + password, single-column, button full-width, height 44px.
- `/dashboard` — placeholder sau login (sẽ điền feature ở phase 02-06), header có nút logout.
- `/admin/users` — list + create + reset password (chỉ owner truy cập).
- `/admin/audit` — audit log viewer với filter actor / action_kind / date range, export CSV (chỉ owner).
- `auth-guard` HOC/middleware FE: route nào không có `GET /auth/me` valid → redirect `/login`.

#### Audit log
- Table `audit_log(id BIGINT PK, actor_id, actor_name, ip, ts_ms, action_kind, target_kind, target_id, before_json, after_json)`.
- Index: `(actor_id, ts_ms)` + `(action_kind, ts_ms)` + `(target_kind, target_id)`.
- **Middleware**: NestJS Interceptor capture POST/PUT/PATCH/DELETE → ghi `audit_log` row với before/after diff. ASYNC (không block response chính).
- **Retention**: cron daily 03:00 ICT xoá row `ts_ms < now() - 90 days`.
- **Immutable**: không có endpoint UPDATE/DELETE audit_log. Schema test confirm.
- **Viewer UI** với filter + export CSV.

#### Security baseline (LOCK §9.5 + drift compensation)
- Password: bcrypt cost 10, length ≥ 8.
- Cookie: HttpOnly + Secure + SameSite=Strict.
- TLS 1.2+ HSTS (1 năm).
- Rate-limit login: 5 fail / 5 phút / IP → block 15 phút.
- CORS whitelist origin FE (không wildcard với credentials).
- JWT signing key trong `.env`, không commit, rotate manual.

## Out of Scope

- Self-service signup public (không có `/signup` cho khách).
- 2FA / OAuth / SSO (defer khi cần multi-tenant).
- Email-based password reset (admin reset tay → đỡ SMTP infrastructure).
- RBAC / role-permission table (F-06: phase 1 mọi nhân viên cùng quyền).
- Refresh token rotation (Phase 01 dùng JWT đơn lifetime 7 ngày).

## Constraints

### ⚠ FOUNDATION drift (cần re-lock TRƯỚC /vg:specs 02)

1. **§9.5 auth mechanism + lifetime**: LOCK hiện tại = "session cookie, lifetime 12h". User clarified ở /vg:specs Q-clarification → đổi sang **JWT lưu trong cookie HttpOnly, lifetime 7 ngày**. Compensating: KHÔNG dùng localStorage, blacklist JTI khi logout/change-password.
2. **F-08 Distribution + §9.6 performance**: LOCK hiện tại = "URL (web, responsive) — PWA optional later" + "bundle FE route ≤ 300KB". User clarified post-approval → **mobile chính**. Cần re-lock:
   - F-08 → "mobile-first PWA primary, desktop secondary"
   - §9.6 bundle FE login/admin route → ≤ **150KB gzip** (siết cho 4G mobile)
   - §9.6 thêm budget Time-to-Interactive ≤ 3s trên Slow-4G

→ User MUST run `/vg:project --update` cho cả 2 mục trên TRƯỚC `/vg:specs 02`. Gate ở /vg:build sẽ block với reason `foundation_drift_unresolved` nếu skip.

### Mobile-first UX (NEW — chủ yếu dùng trên điện thoại)
- Viewport `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">` (chống auto-zoom khi focus input).
- Touch-friendly: button min `44×44px` (Apple HIG), input height ≥ 44px, font size ≥ 16px (chống iOS auto-zoom).
- Form layout single-column, label trên input (không inline).
- Native input types để mở đúng bàn phím di động (vd `type=password` trigger keychain autofill).
- Test trên Safari iOS + Chrome Android (real device hoặc Playwright mobile emulation).
- KHÔNG dùng hover-only interactions (mobile không có hover).
- Bottom navigation pattern cho dashboard (không sidebar trái).

### Performance baseline (mobile-aware)
- Login API p95 < 500ms (bcrypt verify chiếm ~80-150ms).
- API auth read (whoami) p95 < 250ms.
- Audit log INSERT phải async để không block response chính.
- FE bundle login route ≤ **150KB gzip** (siết hơn §9.6 generic).
- Time-to-Interactive < 3s trên Slow-4G (DevTools throttle).

### Architecture (FOUNDATION §9.1 + §9.3)
- BE module: `apps/api/src/modules/auth/` — controller / service / module / `entities/user.entity.ts` / `dto/login.dto.ts` / `auth.spec.ts`.
- BE module: `apps/api/src/modules/audit/` — `audit.interceptor.ts` / service / `entities/audit-log.entity.ts` / `audit.spec.ts`.
- BE module: `apps/api/src/modules/admin/` — `users.controller.ts` / `users.service.ts`.
- FE: `apps/web/src/features/auth/` — `pages/login.tsx` / `hooks/use-auth.ts` / `components/auth-guard.tsx`.
- FE: `apps/web/src/features/admin-users/` — `pages/users-list.tsx` / `pages/users-create.tsx`.
- FE: `apps/web/src/features/admin-audit/` — `pages/audit-log.tsx` / `components/filter-form.tsx`.

## Success criteria

- [ ] **Login flow happy path**: nhập đúng username + password → cookie set, redirect dashboard, `GET /auth/me` trả `{sub, name}`.
- [ ] **Login fail**: sai password → 401, audit log ghi `auth.login_failed`, rate-limit hoạt động sau 5 lần fail trong 5 phút.
- [ ] **Logout flow**: click logout → JTI vào `revoked_jwt_jti`, cookie clear, request tiếp theo dùng cookie cũ → 401.
- [ ] **Admin tạo user**: owner login → tạo user mới → user mới login được. Password ban đầu hash bcrypt cost 10. Audit log ghi `admin.user_created`.
- [ ] **Admin reset password**: owner click reset → tạo password mới → user cũ phải login lại. Audit log ghi `admin.password_reset`.
- [ ] **Change password (self)**: user đổi password → JTI cũ vào blacklist → force re-login. Audit log ghi `auth.password_changed`.
- [ ] **Audit log immutable**: KHÔNG có endpoint UPDATE/DELETE audit_log; schema test confirm.
- [ ] **Audit log middleware**: 1 mutation (vd tạo user) → 1 row audit_log với `before_json=null, after_json={sanitized user data}`.
- [ ] **Audit retention cron**: insert row giả lập `ts_ms < now() - 91 days` → cron next chạy → row biến mất.
- [ ] **Audit viewer UI**: owner login → filter actor + action_kind + date range → kết quả đúng. Export CSV → file ≥ 1 row.
- [ ] **JWT in cookie HttpOnly**: `Set-Cookie` header có `HttpOnly`, `Secure`, `SameSite=Strict`. JS `document.cookie` KHÔNG đọc được token.
- [ ] **JWT signed correctly**: token decode được bằng shared secret, payload đúng format, `exp` = now + 7 ngày.
- [ ] **No PII in JWT**: payload KHÔNG chứa email/phone/address.
- [ ] **No password leak**: response API + log + audit `before/after` KHÔNG bao giờ chứa password plaintext (test grep coverage).
- [ ] **Rate-limit login**: 5 fail trong 5 phút → 401 + `Retry-After: 900`.
- [ ] **Performance API**: login p95 < 500ms, whoami p95 < 250ms.
- [ ] **Mobile responsive**: login + admin pages render đúng trên iPhone SE (320×568) + Galaxy A5x (412×915), không scroll ngang, không cần zoom.
- [ ] **Mobile network**: login flow trên Slow-4G (DevTools throttle) < 3s tới Time-to-Interactive.
- [ ] **Touch target**: tất cả button/link ≥ 44×44px (Lighthouse audit).
- [ ] **JWT 7-day lifetime**: token issued at `T` có `exp = T + 7d`; sau 6 ngày vẫn login được; sau 8 ngày → 401 (expired).

## Dependencies

### Upstream (gate trước phase này)
- ⚠ **FOUNDATION §9.5 auth-mechanism + lifetime** — JWT 7d drift cần re-lock qua `/vg:project --update` TRƯỚC `/vg:build 01`. Gate `foundation_drift_unresolved` sẽ block.
- ⚠ **FOUNDATION F-08 + §9.6** — mobile-first drift cần re-lock TRƯỚC `/vg:specs 02` (vì FE convention sẽ áp dụng cho mọi phase sau).
- **vg.config.md** cần điền: `auth.jwt_secret_env: "JWT_SECRET"`, `auth.jwt_lifetime_days: 7`, `auth.cookie_name: "ssp_token"` ở /vg:scope.
- **MySQL 8** ready (chưa cần production VPS — local Docker compose đủ).

### Downstream (phase này gate cho)
- **Phase 02** (Menu Mgmt): cần `auth_guard` middleware + `actor_id` extract từ JWT.
- **Phase 03** (Table Mgmt): tương tự.
- **Phase 04, 05, 06**: dùng audit middleware đã build ở đây cho mọi mutation.

### External
- Không có third-party API ở Phase 01.
- VPS chưa setup → test local hoàn toàn (Docker compose: MySQL + NestJS + Vite + ngrok cho mobile real-device test).

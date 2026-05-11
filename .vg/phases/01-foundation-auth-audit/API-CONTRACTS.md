---
phase: "01"
created_at: 2026-05-08
endpoint_count: 13
profile: web-fullstack
schema_format: zod (FE) + class-validator (BE DTO)
---

# Phase 01 — API Contracts

All endpoints follow the standard **error envelope** (P01.D-09):

```ts
// packages/schemas/src/errors.ts
export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.enum([
      'AUTH_INVALID_CRED', 'AUTH_RATE_LIMITED', 'AUTH_TOKEN_REVOKED',
      'AUTH_TOKEN_EXPIRED', 'AUTH_INACTIVE_USER',
      'ADMIN_REQUIRED', 'OWN_PASSWORD_WRONG',
      'RECOVERY_CODE_INVALID', 'SETUP_ALREADY_DONE',
      'VALIDATION_FAILED', 'INTERNAL_ERROR'
    ]),
    message: z.string(),
    request_id: z.string().uuid(),
    ts_ms: z.number().int()
  })
});
```

HTTP status mapping (P01.D-15): 200 success-with-data · 201 resource-created · 204 idempotent-no-body · 400 malformed · 401 auth · 403 role · 422 validation · 429 rate-limit.

---

## E-01 POST /auth/login

**Decision:** P01.D-03 BR-2 + D-08 token_version
**Auth:** none (rate-limited 5 fail/5min/IP per D-26)

### Request
```ts
// packages/schemas/src/auth/login.dto.ts
export const LoginDto = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128)
});
export type LoginDto = z.infer<typeof LoginDto>;
```

### Response 200
```ts
export const LoginResponse = z.object({
  data: z.object({
    user: z.object({
      sub: z.string(),       // user_id
      name: z.string(),
      is_owner: z.boolean()
    })
  })
});
```
**Headers:** `Set-Cookie: ssp_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/`

### Errors
- 401 `AUTH_INVALID_CRED` — wrong username/password
- 401 `AUTH_INACTIVE_USER` — user is_active=false (P01.D-06)
- 429 `AUTH_RATE_LIMITED` + `Retry-After: 900` — 5 fails in 5min
- 422 `VALIDATION_FAILED` — DTO fail (P01.D-14)

### Side effects
- Failed login → audit_log row `auth.login_failed` (P01.D-25 async)
- Success → audit_log row `auth.login_success`

**Goals covered:** TS-01, TS-06, TS-22

---

## E-02 POST /auth/logout

**Decision:** P01.D-03 BR-4 + D-08
**Auth:** JWT (via cookie)

### Request: empty body

### Response 204: no body

**Side effects:**
- INSERT `revoked_jwt_jti(jti, revoked_at_ms, expires_at_ms)` from current JWT
- Clear `Set-Cookie: ssp_token=; Max-Age=0`
- audit_log `auth.logout`

### Errors
- 401 if no/invalid token

**Idempotent:** yes (logout twice = 204 both times)

**Goals covered:** TS-03 (logout flow)

---

## E-03 GET /auth/me

**Decision:** P01.D-08 (token_version verify)
**Auth:** JWT

### Response 200
```ts
export const WhoamiResponse = z.object({
  data: z.object({
    sub: z.string(),
    name: z.string(),
    is_owner: z.boolean()
  })
});
```

### Errors
- 401 `AUTH_TOKEN_REVOKED` — JTI in blacklist OR token_version mismatch
- 401 `AUTH_TOKEN_EXPIRED` — exp < now
- 401 `AUTH_INACTIVE_USER` — user.is_active=false

**Goals covered:** TS-01, TS-14, TS-17, TS-18, TS-19 (all token_version revocation cases)

---

## E-04 POST /auth/change-password

**Decision:** P01.D-08 (tv++ on change)
**Auth:** JWT

### Request
```ts
export const ChangePasswordDto = z.object({
  old: z.string().min(1),
  new: z.string().min(8).max(128)
});
```

### Response 200
```ts
{ data: { message: 'Password changed successfully' } }
```

### Errors
- 401 `OWN_PASSWORD_WRONG` — old password mismatch
- 422 `VALIDATION_FAILED` — new password too short

### Side effects
- UPDATE users SET password_hash = bcrypt(new), token_version = token_version+1
- audit_log `auth.password_changed`
- Current JTI added to blacklist (force re-login)
- Set new cookie with fresh JWT (tv updated)

**Goals covered:** TS-02, TS-17

---

## E-05 POST /auth/recover

**Decision:** P01.D-04 (recovery code) + D-08 (tv++)
**Auth:** recovery_code in body (no JWT required)

### Request
```ts
export const RecoverDto = z.object({
  code: z.string().length(16),
  new_password: z.string().min(8).max(128)
});
```

### Response 200
```ts
{ data: { message: 'Password reset via recovery code. Please login.' } }
```

### Errors
- 401 `RECOVERY_CODE_INVALID` — bcrypt verify fail OR code already used
- 422 `VALIDATION_FAILED`

### Side effects
- bcrypt verify against recovery_codes.code_hash
- UPDATE users SET password_hash = bcrypt(new_password), token_version++
- UPDATE recovery_codes SET used_at = now(), code_hash = '<expired_marker>' (1-time use per D-04)
- audit_log `auth.recovered`

**Goals covered:** TS-08, TS-09, TS-10

---

## E-06 GET /setup

**Decision:** P01.D-05 + D-24 (DB-empty + IP-whitelist guard)
**Auth:** none (gated by setup_status + req.ip whitelist)

### Response 200: HTML page (FE-rendered)

### Errors
- 404 `SETUP_ALREADY_DONE` — owner already exists
- 403 — req.ip not in SETUP_ALLOWED_IP env

**Goals covered:** TS-11, TS-46

---

## E-07 POST /setup

**Decision:** P01.D-05 + D-24
**Auth:** none + DB-empty check (atomic transaction) + IP-whitelist

### Request
```ts
export const SetupDto = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128)
});
```

### Response 201
```ts
export const SetupResponse = z.object({
  data: z.object({
    user_id: z.string(),
    recovery_code: z.string().length(16),  // shown 1× per D-04
    warning: z.string()  // "Save this code — it will not be shown again."
  })
});
```

### Errors
- 409 `SETUP_ALREADY_DONE` — race condition or repeat call
- 403 — IP not whitelisted
- 422 `VALIDATION_FAILED`

### Side effects
- TRANSACTION: INSERT users (is_owner=true, token_version=0) + INSERT recovery_codes (code_hash) + UNIQUE constraint check
- audit_log `setup.completed`

**Goals covered:** TS-11, TS-12, TS-13, TS-46, TS-47

---

## E-08 POST /admin/users

**Decision:** P01.D-02 (OwnerGuard) + audit
**Auth:** JWT + OwnerGuard (`is_owner=true`)

### Request
```ts
export const CreateUserDto = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128)  // owner-set initial password
});
```

### Response 201
```ts
{ data: { id: string, username: string, is_active: true, created_at: number } }
```

### Errors
- 403 `ADMIN_REQUIRED` — not is_owner
- 409 — username already exists
- 422 `VALIDATION_FAILED`

### Side effects
- INSERT users (is_owner=false, is_active=true, token_version=0)
- audit_log `admin.user_created` with after_json = {sanitized user data}

**Goals covered:** TS-04, TS-07 (mutation creates audit)

---

## E-09 GET /admin/users

**Decision:** OwnerGuard
**Auth:** OwnerGuard

### Query
```ts
?page=1&page_size=20  // default; max page_size=100
```

### Response 200
```ts
export const UsersListResponse = z.object({
  data: z.object({
    items: z.array(z.object({
      id: z.string(),
      username: z.string(),
      is_active: z.boolean(),
      is_owner: z.boolean(),
      created_at: z.number()
    })),
    total: z.number(),
    page: z.number(),
    page_size: z.number()
  })
});
```

### Errors
- 403 `ADMIN_REQUIRED`

---

## E-10 POST /admin/users/:id/reset-password

**Decision:** P01.D-06 (tv++)
**Auth:** OwnerGuard

### Request: empty body (server generates temp password)

### Response 200
```ts
{ data: { temp_password: string, message: 'Share with staff verbally' } }
```

### Errors
- 403 `ADMIN_REQUIRED`
- 404 — user_id not found

### Side effects
- Generate random password (12 chars)
- UPDATE users SET password_hash = bcrypt(temp), token_version++ (per D-08)
- audit_log `admin.password_reset` (do NOT log plaintext)

**Goals covered:** TS-18

---

## E-11 POST /admin/users/:id/disable

**Decision:** P01.D-06 + D-08
**Auth:** OwnerGuard

### Request: empty body

### Response 204

### Errors
- 403 `ADMIN_REQUIRED`
- 404 — user_id not found

### Side effects
- UPDATE users SET is_active=false, token_version++ (immediate revoke)
- audit_log `admin.user_disabled`

**Idempotent:** yes (disable twice = 204 both)

**Goals covered:** TS-14, TS-15, TS-19

---

## E-12 GET /admin/audit

**Decision:** P01.D-07 + D-28 (meta-audit logged)
**Auth:** OwnerGuard

### Query
```ts
?actor=<id>&action_kind=<string>&from=<ts_ms>&to=<ts_ms>&page=1&page_size=20
```

### Response 200
```ts
export const AuditListResponse = z.object({
  data: z.object({
    items: z.array(z.object({
      id: z.string(),
      actor_id: z.string().nullable(),
      actor_name: z.string().nullable(),
      ip: z.string(),
      ts_ms: z.number(),
      action_kind: z.string(),
      target_kind: z.string().nullable(),
      target_id: z.string().nullable(),
      before_json: z.unknown().nullable(),
      after_json: z.unknown().nullable()
    })),
    total: z.number(),
    page: z.number(),
    page_size: z.number()
  })
});
```

### Errors
- 403 `ADMIN_REQUIRED`

### Side effects (D-07 meta-audit)
- audit_log `audit.viewed` with before_json={filter, page}, after_json=null

**Goals covered:** TS-16, TS-52

---

## E-13 GET /admin/audit/export.csv

**Decision:** P01.D-07 + D-28
**Auth:** OwnerGuard

### Query: same as E-12

### Response 200
- `Content-Type: text/csv`
- `Content-Disposition: attachment; filename=audit-<ts>.csv`
- CSV stream

### Errors
- 403 `ADMIN_REQUIRED`

### Side effects
- audit_log `audit.exported` with before_json={filter}

**Goals covered:** TS-16

---

## E-14 GET /health

**Decision:** P01.D-03 BR + observability
**Auth:** none

### Response 200
```ts
{ status: 'ok' | 'degraded', db: 'up' | 'down', uptime_s: number, version: string }
```

### Status mapping
- 200 if all OK
- 503 if db down or critical service degraded

---

## Cross-cutting middleware (NestJS)

### M-01 Global ExceptionFilter (D-09)
Converts any thrown HttpException → ErrorEnvelope (`{error: {code, message, request_id, ts_ms}}`).

### M-02 RequestIdMiddleware (D-10)
- Inject `req.request_id = uuid()` per request
- Add to `req.context` (used by pino + audit)
- Add `X-Request-Id: <uuid>` to response headers

### M-03 Trust proxy (D-10)
`app.set('trust proxy', 1)` — req.ip from X-Forwarded-For

### M-04 CSRF Origin guard (D-12)
For POST/PUT/PATCH/DELETE on `/admin/*` + `/auth/*` (except `/auth/login`):
- Check `Origin` header matches configured FE origin (env `ALLOWED_ORIGIN`)
- 403 if missing or mismatch

### M-05 JwtAuthGuard (D-08)
- Extract JWT from cookie `ssp_token`
- jsonwebtoken.verify (HS256, env `JWT_SECRET`)
- Check `users.is_active=true`
- Check `JWT.tv === users.token_version`
- Check `revoked_jwt_jti.jti` does NOT exist
- Inject `req.user = { sub, name, is_owner }`
- Throw 401 with appropriate code if any check fails

### M-06 OwnerGuard (D-02)
Extends JwtAuthGuard + assert `req.user.is_owner === true`. Throw 403 `ADMIN_REQUIRED` otherwise.

### M-07 ThrottlerGuard (D-26)
`@nestjs/throttler` with `{ ttl: 300, limit: 5 }` applied to POST `/auth/login` + POST `/auth/recover`.

### M-08 AuditInterceptor (D-25 async)
- After response complete, if mutation method (POST/PUT/PATCH/DELETE) + 2xx response:
- Emit `EventEmitter` event `audit.write` with `{actor, ip, ts_ms, action_kind, target, before, after}`
- Handler async INSERT into audit_log (no block response)
- For special endpoints (E-12, E-13), explicitly emit `audit.viewed` / `audit.exported`

---

## Database schema (TypeORM entities)

### users
```ts
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true, length: 64 }) username: string;
  @Column() password_hash: string;
  @Column({ default: false }) is_owner: boolean;
  @Column({ default: true }) is_active: boolean;
  @Column({ default: 0, type: 'bigint' }) token_version: number;  // Q-P01-03: BIGINT for overflow safety
  @CreateDateColumn({ type: 'bigint' }) created_at: number;  // ts_ms
}
```

### audit_log
```ts
@Entity('audit_log')
@Index('idx_actor_ts', ['actor_id', 'ts_ms'])
@Index('idx_action_ts', ['action_kind', 'ts_ms'])
@Index('idx_target', ['target_kind', 'target_id'])
export class AuditLog {
  @PrimaryGeneratedColumn('bigint') id: number;
  @Column({ nullable: true }) actor_id: string | null;
  @Column({ nullable: true }) actor_name: string | null;
  @Column({ length: 45 }) ip: string;  // IPv6 max
  @Column({ type: 'bigint' }) ts_ms: number;
  @Column({ length: 64 }) action_kind: string;
  @Column({ nullable: true }) target_kind: string | null;
  @Column({ nullable: true }) target_id: string | null;
  @Column({ type: 'json', nullable: true }) before_json: unknown | null;
  @Column({ type: 'json', nullable: true }) after_json: unknown | null;
  // No @UpdateDateColumn — immutable per BR-1
}
```

### revoked_jwt_jti
```ts
@Entity('revoked_jwt_jti')
export class RevokedJti {
  @PrimaryColumn({ length: 64 }) jti: string;
  @Column({ type: 'bigint' }) revoked_at_ms: number;
  @Column({ type: 'bigint' }) expires_at_ms: number;  // for cron prune
}
```

### recovery_codes
```ts
@Entity('recovery_codes')
export class RecoveryCode {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() user_id: string;
  @Column() code_hash: string;  // bcrypt hash
  @Column({ nullable: true, type: 'bigint' }) used_at: number | null;
  @CreateDateColumn({ type: 'bigint' }) created_at: number;
}
```

---

## Idempotency matrix (D-15 reference)

| Endpoint | Idempotent? | Notes |
|---|---|---|
| POST /auth/login | NO | Each call re-issues JWT |
| POST /auth/logout | YES | Same JTI blacklisted multiple times = no-op |
| POST /auth/change-password | NO | Each call rotates tv |
| POST /auth/recover | NO (1-time) | Code marked used after first valid call |
| POST /setup | NO (1-time) | DB-empty constraint + UNIQUE owner |
| POST /admin/users | NO | Creates new resource each call |
| POST /admin/users/:id/reset-password | NO | Each call generates new temp password |
| POST /admin/users/:id/disable | YES | Disable twice = same state |
| GET endpoints | YES | Standard semantics |

---

## OpenAPI generation (D-14)

Add `@ApiTags`, `@ApiOperation`, `@ApiResponse` decorators to each controller. Spec served at `/api/docs` in dev only (`if (process.env.NODE_ENV !== 'production')` gate). DTO uses `class-validator` + `@ApiProperty` for auto-doc.

Class-validator decorator equivalents (when not using zod):
- `@IsString()` `@MinLength(8)` `@MaxLength(128)` for password
- `@IsString()` `@MinLength(1)` `@MaxLength(64)` for username

Auto-422 response on DTO fail via `app.useGlobalPipes(new ValidationPipe({whitelist: true, transform: true}))`.

---

## Notes for /vg:build executor

- All endpoints rely on middleware stack M-01 → M-08 — wire in `apps/api/src/main.ts` + per-module `imports`.
- JWT_SECRET env var MUST be set with strong random (≥256 bits) — document in RUNBOOK.
- SETUP_ALLOWED_IP env var MUST be set BEFORE first deploy.
- ALLOWED_ORIGIN env var for CSRF — defaults to FE origin in same-domain config (D-13).
- Per Q-P01-03: token_version uses BIGINT for overflow safety (decided at blueprint).

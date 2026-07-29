# External Integrations

**Analysis Date:** 2026-07-29

## APIs & External Services

No third-party SaaS/API integrations detected (no payment gateway, SMS, email, or push-notification SDKs found in `apps/api/package.json` or via source grep for stripe/vnpay/momo/zalopay/sendgrid/twilio/cloudinary/firebase/sentry/redis). The system is currently self-contained: NestJS API + MySQL + two React frontends, no outbound third-party calls implemented yet.

**Internal service-to-service:**
- `apps/web` and `apps/shop` talk only to the local `@order/api` backend (dev via Vite proxy, prod via same-origin static serving from `apps/api/src/main.ts`)

## Data Storage

**Databases:**
- MySQL 8.0 - primary and only datastore
  - Connection: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` env vars, configured in `apps/api/src/data-source.ts`
  - Client/ORM: TypeORM `^0.3.20` via `@nestjs/typeorm`, driver `mysql2`
  - Schema management: `synchronize: true` (no migration files used by design — "Project per user-spec: bỏ migration, chỉ dùng synchronize"), connection pool `connectionLimit: 50`
  - Forced UTC timezone (`timezone: 'Z'`) for consistent datetime handling across host/container TZ differences
  - Entities: `User`, `AuditLog`, `RevokedJti`, `RecoveryCode`, `MenuItem`, `MenuGroup`, `RestaurantTable`, `Order`, `OrderItem`, `OrderActivityLog` (see `apps/api/src/data-source.ts`)
  - Local dev: `docker-compose.yml` service `mysql`, host port 3307
  - Production: `docker-compose.prod.yml` service `mysql`, internal Docker network only (`backend`), not exposed to host; 1GB innodb buffer pool tuned for 4GB VPS

**File Storage:**
- Local filesystem only - uploaded menu item images stored under `apps/api/uploads/menu/` (via `multer`), served statically at `/uploads/*` (`app.useStaticAssets` in `apps/api/src/main.ts`). No S3/cloud object storage integration.

**Caching:**
- None detected (no Redis/Memcached dependency in `apps/api/package.json`)

## Authentication & Identity

**Auth Provider:**
- Custom (self-hosted) - no OAuth/Auth0/Clerk/Firebase Auth
  - Implementation: JWT issued by custom service `apps/api/src/modules/auth/jwt.service.ts` using `jsonwebtoken` `^9.0.2`
  - Token delivery: HTTP-only cookie (`COOKIE_NAME`, default `ssp_token`), parsed via `cookie-parser`
  - Password hashing: `bcrypt` (cost configured via `BCRYPT_COST`)
  - Token revocation: `RevokedJti` entity - denylist of revoked JWT IDs, cleaned via `cron:jti-cleanup` script (`apps/api/src/cli/cron-jti-cleanup.ts`)
  - Account recovery: `RecoveryCode` entity - `apps/api/src/modules/auth/entities/recovery-code.entity.ts`
  - Guards: `apps/api/src/modules/auth/guards/jwt-auth.guard.ts`, `roles.guard.ts`, `owner.guard.ts`, `admin.guard.ts`
  - Setup wizard IP allowlist: `SETUP_ALLOWED_IP` env var restricts first-owner-creation endpoint (`apps/api/src/modules/setup`)
  - CSRF protection: custom Origin/Referer check middleware, `apps/api/src/common/middleware/csrf-origin.middleware.ts`, driven by `ALLOWED_ORIGIN` env var

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Bugsnag/Rollbar dependency detected)

**Logs:**
- `nestjs-pino` + `pino` + `pino-http` - structured JSON logging in `apps/api`
- Audit trail: dedicated `AuditModule` (`apps/api/src/modules/audit/`) with `AuditLog` entity and global `AuditInterceptor` (registered as `APP_INTERCEPTOR` in `apps/api/src/app.module.ts`), plus retention cron script `cron:audit-retention` (`apps/api/src/cli/cron-audit-retention.ts`)

## CI/CD & Deployment

**Hosting:**
- Self-managed VPS (per project memory: IP/credentials change on VPS reinstall, requires SSH retry due to sshd rate-limiting)
- Reverse proxy: Caddy (`Caddyfile`) - automatic HTTPS via Let's Encrypt, HSTS + security headers, zstd/gzip compression
- Container orchestration: Docker Compose (`docker-compose.prod.yml`) - `mysql` + `api` + `caddy` services on internal `backend` network
- Deployment script: `./deploy.sh` (repo root, git-untracked at time of analysis) using credentials from `.env.deploy` (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`, `DEPLOY_PASS`, `DEPLOY_PATH`)

**CI Pipeline:**
- None detected (no `.github/workflows`, no CI config files found)

## Environment Configuration

**Required env vars (dev):**
- `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_HOST`, `MYSQL_PORT`
- `API_PORT`, `NODE_ENV`
- `JWT_SECRET`, `JWT_LIFETIME_DAYS`, `COOKIE_NAME`, `COOKIE_SECURE`, `BCRYPT_COST`
- `SETUP_ALLOWED_IP`, `ALLOWED_ORIGIN`
- `VITE_API_BASE_URL` (frontend build-time)

**Required env vars (prod, additional):**
- `DOMAIN` (for Caddy/Let's Encrypt)
- Same MySQL/JWT/cookie vars with production-strength values (see `.env.production.example` guidance — 32-64 char random secrets via `openssl rand -base64 48`)

**Secrets location:**
- `.env` (dev, git-ignored) and `.env.production` (prod, git-ignored, not present in this checkout — only `.env.production.example` template exists)
- `.env.deploy` (git-ignored) - VPS SSH/deploy credentials, separate from app secrets

## Webhooks & Callbacks

**Incoming:**
- None detected — no webhook receiver endpoints found in `apps/api/src/modules/public` or elsewhere (public module currently exposes only `GET /api/public/health`, per recent commit history)

**Outgoing:**
- None detected

---

*Integration audit: 2026-07-29*

# Technology Stack

**Analysis Date:** 2026-07-29

## Languages

**Primary:**
- TypeScript ^5.7.0 - used across all workspaces (`apps/api`, `apps/web`, `apps/shop`, `packages/schemas`, `packages/utils`)

**Secondary:**
- SQL (MySQL dialect) - via TypeORM `synchronize: true` (no migration files currently used), `apps/api/src/data-source.ts`

## Runtime

**Environment:**
- Node.js >= 20 (`engines.node` in root `package.json`; Dockerfile uses `node:20-alpine`)
- ESM (`"type": "module"` in every package.json) — all workspaces are pure ESM, imports require explicit `.js` extensions in compiled output (e.g. `./app.module.js`)

**Package Manager:**
- pnpm 9.0.0 (`packageManager: "pnpm@9.0.0"`), workspace defined in `pnpm-workspace.yaml` (`apps/*`, `packages/*`)
- Lockfile: present (`pnpm-lock.yaml`)
- Monorepo task runner: Turborepo `^2.3.0` (`turbo.json`) — orchestrates `build`, `dev`, `typecheck`, `test`, `lint` across workspaces with dependency graph (`dependsOn: ["^build"]`)

## Frameworks

**Core:**
- NestJS `^10.4.0` (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`) - `apps/api` backend framework, Express adapter
- React `^19.0.0` + React Router `^7.0.0` - `apps/web` (POS/admin) and `apps/shop` (customer-facing) SPAs
- Vite `^6.0.0` with `@vitejs/plugin-react` - build tool/dev server for both `apps/web` and `apps/shop`

**Testing:**
- Vitest `^2.1.0` - used in `apps/api` and `apps/web` (`test`/`test:watch` scripts); `apps/shop` has no test script defined yet

**Build/Dev:**
- TypeScript compiler (`tsc`) - build step for `apps/api`, `packages/schemas`, `packages/utils`; `apps/web`/`apps/shop` run `tsc --noEmit` before `vite build`
- `@swc-node/register` `^1.11.1` + `@swc/core` - fast dev-mode ESM loader for `apps/api` (`node --import @swc-node/register/esm-register --watch src/main.ts`)
- Prettier `^3.4.0` - root-level formatting (`pnpm format`)

## Key Dependencies

**API (`apps/api`) — critical:**
- `typeorm` `^0.3.20` + `@nestjs/typeorm` `^10.0.2` + `mysql2` `^3.11.0` - ORM and MySQL driver
- `jsonwebtoken` `^9.0.2` - JWT auth (custom, not `@nestjs/jwt`), `apps/api/src/modules/auth/jwt.service.ts`
- `bcrypt` `^5.1.1` - password hashing
- `class-validator` `^0.14.1` + `class-transformer` `^0.5.1` - DTO validation (global `ValidationPipe`, whitelist mode)
- `zod` `^3.23.0` - shared validation schemas (also used in `packages/schemas` and `apps/web`)
- `nestjs-pino` `^4.2.0` + `pino` `^9.5.0` + `pino-http` `^10.3.0` - structured logging
- `@nestjs/throttler` `^6.2.0` - rate limiting (global 600 req/min/IP + stricter overrides on auth routes)
- `@nestjs/event-emitter` `^2.1.0` - internal event bus
- `@nestjs/swagger` `^8.0.0` - OpenAPI docs generation
- `cookie-parser` `^1.4.7` - JWT extracted from HTTP-only cookie
- `multer` `^2.1.1` + `@types/multer` - file uploads (menu item images → `apps/api/uploads/menu/`)
- `uuid` `^11.0.0` - ID/token generation

**Web (`apps/web`) — POS/admin — critical:**
- `axios` `^1.7.0` - HTTP client to API
- `xlsx` `^0.18.5` - Excel import/export (bulk menu import)
- `zxcvbn` `^4.4.2` - password strength estimation (setup wizard)

**Shop (`apps/shop`) — customer-facing — critical:**
- Minimal dependency set: `react`, `react-dom`, `react-router-dom`, `@order/schemas` only; no `axios` yet (newly scaffolded, 4 placeholder pages: `/cart`, `/checkout`, `/o/:token`, `/history`)

**Shared workspace packages:**
- `@order/schemas` (`packages/schemas`) - shared Zod schemas, consumed by `apps/api`, `apps/web`, `apps/shop`
- `@order/utils` (`packages/utils`) - shared utilities (e.g. `apiOk` response helper), consumed by `apps/api`

## Configuration

**Environment:**
- `.env` (git-ignored, local dev secrets — present, not read/quoted here)
- `.env.example` - documents dev vars: `MYSQL_*`, `API_PORT`, `NODE_ENV`, `JWT_SECRET`, `JWT_LIFETIME_DAYS`, `COOKIE_NAME`, `COOKIE_SECURE`, `BCRYPT_COST`, `SETUP_ALLOWED_IP`, `ALLOWED_ORIGIN`, `VITE_API_BASE_URL`
- `.env.production.example` - documents prod vars: `DOMAIN`, `MYSQL_*`, `JWT_SECRET`, `JWT_LIFETIME_DAYS`, `COOKIE_NAME`, `SETUP_ALLOWED_IP`
- `.env.deploy` (git-ignored, present) - deploy script credentials: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`, `DEPLOY_PASS`, `DEPLOY_PATH` (consumed by `./deploy.sh`)
- Config loaded via `@nestjs/config` `ConfigModule.forRoot({ isGlobal: true })` in `apps/api/src/app.module.ts`, plus `dotenv/config` import in `apps/api/src/main.ts`

**Build:**
- `tsconfig.base.json` (root) - shared strict TS config (ES2022 target, `strict: true`, decorators enabled), extended by each workspace's `tsconfig.json`
- `apps/api/tsconfig.json` - `NodeNext` module/resolution, `outDir: dist`, `rootDir: src`
- `apps/web/vite.config.ts`, `apps/shop/vite.config.ts` - dev server proxy config forwarding API prefixes to `http://localhost:3001`; `apps/shop` runs on port 5174 (strict) vs `apps/web` on 5173, to keep `ALLOWED_ORIGIN` CSRF check consistent
- `turbo.json` - task pipeline (`build`, `dev`, `typecheck`, `test`, `lint`)

## Platform Requirements

**Development:**
- Node.js >= 20
- pnpm 9 (via corepack)
- MySQL 8.0 (via `docker-compose.yml`, `db:up`/`db:down` scripts, exposed on host port 3307 → container 3306)

**Production:**
- Docker multi-stage build (`Dockerfile`): pnpm install → build `@order/schemas` → build API + web → minimal Alpine runtime image serving API + static web build together
- `docker-compose.prod.yml` - 3-service stack: `mysql` (internal network only, 1GB innodb buffer pool, TZ UTC), `api` (Node container), `caddy` (reverse proxy, auto HTTPS via Let's Encrypt using `Caddyfile` + `DOMAIN` env, HSTS/security headers, zstd/gzip compression)
- Deployment automated via `./deploy.sh` (uses `.env.deploy` creds), target VPS reachable via SSH; VPS may reinstall/change IP (per project memory)

---

*Stack analysis: 2026-07-29*

# Order-Quan-Ba-Lun

Web app quản lý order món ăn cho quán nhỏ — POS dine-in / takeaway / delivery, mobile-first, NestJS + React + MySQL.

**Phase 01 (scaffold)**: tầng nền tảng Auth + Audit log. Các phase Menu / Bàn / Order / Báo cáo sẽ build lần lượt sau.

## Stack

| Layer | Tech | Lý do |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript | F-03 — mobile-first PWA |
| Backend | NestJS 10 + TypeScript + TypeORM | F-04 — opinionated, DI tốt |
| Database | MySQL 8 (InnoDB, utf8mb4) | F-05 — tooling VN nhiều |
| Auth | JWT 7 ngày trong cookie HttpOnly + JTI blacklist + token_version | F-17 + P01.D-08 |
| Monorepo | pnpm + Turborepo | shared types FE↔BE |
| Deploy | rsync + pm2 (VPS, Milestone 2) | F-07 |

## Mô hình kiến trúc — Monorepo

1 repo chứa cả Frontend, Backend và shared types:

```
apps/
  api/          NestJS BE (port 3001)
  web/          Vite+React FE (port 5173)
packages/
  schemas/      Zod schemas + TypeScript types — IMPORTED BY CẢ FE + BE
.vg/            VGFlow planning artifacts (markdown docs)
```

Mỗi lần thay đổi API contract → sửa file ở `packages/schemas/` → BOTH FE và BE auto-update (1 source of truth).

## Yêu cầu hệ thống

- Node.js ≥ 20 (LTS)
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker (cho MySQL local) — hoặc MySQL 8 cài trực tiếp

## Chạy lần đầu (5 bước)

```bash
# 1. Clone repo
git clone https://github.com/LuongPhuong757/Order-Quan-Ba-Lun.git
cd Order-Quan-Ba-Lun

# 2. Cài deps (cả FE + BE + schemas)
pnpm install

# 3. Config env
cp .env.example .env
# Sửa JWT_SECRET thành chuỗi random ≥ 32 ký tự:
#   openssl rand -base64 32

# 4. Khởi tạo MySQL container
pnpm db:up
# Đợi ~10s cho MySQL ready. Check:
#   docker ps   → container order_quan_balun_mysql trạng thái "healthy"

# 5. Start dev (API + Web song song)
pnpm dev
```

Sau khi `pnpm dev` chạy:
- API: http://localhost:3001
- Swagger docs: http://localhost:3001/api/docs
- Web: http://localhost:5173

## Setup chủ quán lần đầu

Truy cập http://localhost:5173/setup:

1. Nhập username (mặc định `admin`)
2. Nhập password mạnh (khuyến nghị ≥ 12 ký tự)
3. Server trả về **mã khôi phục 16 ký tự** — **Lưu NGAY** (chụp màn hình, cất chỗ an toàn). Mã này KHÔNG hiển thị lại.
   - Nếu quên password sau này → truy cập `/recover` để reset bằng mã.

> ⚠ Trang `/setup` chỉ truy cập được từ IP `127.0.0.1` mặc định. Đổi `SETUP_ALLOWED_IP` trong `.env` nếu setup từ máy khác.

Xong setup → đăng nhập tại `/login`.

## Endpoints (Phase 01 — 13 endpoint + /health)

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | /auth/login | none + rate-limit 5/5min/IP | Đăng nhập |
| POST | /auth/logout | JWT | Đăng xuất (JTI blacklist) |
| GET | /auth/me | JWT | Thông tin user hiện tại |
| POST | /auth/change-password | JWT | Đổi password (tv++) |
| POST | /auth/recover | none + rate-limit | Reset password bằng mã khôi phục |
| GET | /setup | IP-allowlist | Check setup state |
| POST | /setup | IP-allowlist + DB-empty | Tạo owner đầu tiên |
| POST | /admin/users | OwnerGuard | Tạo nhân viên |
| GET | /admin/users | OwnerGuard | List nhân viên |
| POST | /admin/users/:id/reset-password | OwnerGuard | Reset password (tv++) |
| POST | /admin/users/:id/disable | OwnerGuard | Vô hiệu hoá (tv++) |
| GET | /admin/audit | OwnerGuard | Audit log viewer |
| GET | /admin/audit/export.csv | OwnerGuard | Export CSV |
| GET | /health | none | DB up + uptime |

## Lệnh hữu ích

```bash
# Dev
pnpm dev                              # start cả API + Web (Turbo parallel)
pnpm --filter @order/api dev          # chỉ start API
pnpm --filter @order/web dev          # chỉ start Web

# Build prod
pnpm build

# Type check
pnpm typecheck

# Database
pnpm db:up
pnpm db:down

# CLI scripts
pnpm seed:owner --username admin --password <pass>   # recovery
pnpm cron:audit-retention --cutoff-days=90           # prune audit > 90d
pnpm cron:audit-retention --dry-run                  # preview
pnpm cron:jti-cleanup                                # prune expired JTI

# Migrations
pnpm migration:run
pnpm migration:revert
```

> 💡 Phase 01 dùng `synchronize: true` của TypeORM (auto-create tables từ entities) cho dev. Production sẽ chuyển sang migrations chính thức ở phase deploy.

## Cấu trúc thư mục

```
apps/api/src/
├── main.ts                            Bootstrap NestJS + Swagger + middleware
├── app.module.ts                      Root module
├── data-source.ts                     TypeORM data source
├── common/
│   ├── filters/global-exception.filter.ts   Error envelope P01.D-09
│   └── middleware/
│       ├── request-id.middleware.ts          P01.D-10
│       └── csrf-origin.middleware.ts         P01.D-12
├── modules/
│   ├── auth/                                 E-01..E-05 + JWT + Guards
│   ├── audit/                                E-12..E-13 + interceptor async
│   ├── admin/                                E-08..E-11
│   ├── setup/                                E-06..E-07 + IP guard
│   └── health/                               E-14
└── cli/
    ├── seed-owner.ts                          Recovery owner
    ├── cron-audit-retention.ts                Prune > 90d
    └── cron-jti-cleanup.ts                    Prune expired JTI

apps/web/src/
├── main.tsx + App.tsx                  Router + AuthGuard + bottom nav
├── styles.css                          Mobile-first CSS
├── components/{Toast,PasswordInput,ReLoginModal}.tsx
├── lib/{api,auth-context}.ts
└── pages/{Login,Setup,Recover,Dashboard,Account,AdminUsers,AdminAudit}.tsx

packages/schemas/src/                   Shared types FE↔BE
├── errors.ts                           ErrorCode enum + envelope
├── auth.ts                             DTOs login/recover/setup/change-password
└── admin.ts                            DTOs admin user/audit
```

## VGFlow planning artifacts (.vg/)

Toàn bộ thiết kế Phase 01 document chi tiết — đọc nếu muốn hiểu lý do mỗi decision:

- `.vg/PROJECT.md` — tổng quan + Milestone 1 scope
- `.vg/FOUNDATION.md` — 17 F-XX decisions (platform / stack / security baseline / mobile-first)
- `.vg/ROADMAP.md` — 6 phases
- `.vg/REQUIREMENTS.md` — 8 REQ-A..H với acceptance criteria
- `.vg/phases/01-foundation-auth-audit/`:
  - `SPECS.md` — goal + scope + success criteria
  - `CONTEXT.md` + `CONTEXT/D-NN.md` — 28 P01.D-XX decisions
  - `API-CONTRACTS.md` + `API-CONTRACTS/E-NN.md` — 13 endpoints
  - `TEST-GOALS.md` + `TEST-GOALS/G-NN.md` — 47 test goals
  - `PLAN.md` + `PLAN/T-NN.md` — 34 implementation tasks

## Phase tiếp theo

- **Phase 02** — Menu Management (REQ-A: bulk import CSV + 3-cấp nhóm hàng)
- **Phase 03** — Table Management (REQ-B: sơ đồ bàn, chuyển bàn)
- **Phase 04** — Order Lifecycle + Stock-out (REQ-D + REQ-E)
- **Phase 05** — Auto-close bàn (REQ-F)
- **Phase 06** — Báo cáo cuối ngày (REQ-H)

## License

Private — không phân phối.

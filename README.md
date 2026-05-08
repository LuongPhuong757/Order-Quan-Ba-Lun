# Order-Quan-Ba-Lun

Web app quản lý order món ăn cho quán ăn nhỏ — POS dine-in / takeaway / delivery, mobile-first, NestJS + React + MySQL.

## Stack

- Frontend: React 19 + Vite + TypeScript (mobile-first PWA)
- Backend: NestJS 10 + TypeScript + TypeORM
- Database: MySQL 8 (InnoDB, utf8mb4)
- Auth: JWT 7 days in cookie HttpOnly + audit log infrastructure
- Monorepo: pnpm + Turborepo
- Deploy: VPS (Hetzner / DigitalOcean / Linode) via rsync + pm2

## Workflow

This project uses [VGFlow](https://github.com/vietdev99/vgflow) — see `.vg/` for foundation, roadmap, phases, and security plan.

- `.vg/PROJECT.md` — identity + REQ-A..H + Milestone 1 scope
- `.vg/FOUNDATION.md` — 17 F-XX decisions + §9 Architecture Lock
- `.vg/ROADMAP.md` — 6 phases (Milestone 1 MVP)
- `.vg/REQUIREMENTS.md` — 8 must-have requirements + acceptance criteria
- `.vg/SECURITY-TEST-PLAN.md` — DAST (ZAP) + risk profile (moderate)

## Phases

1. Foundation & Auth Infrastructure (auth + audit log)
2. Menu Management & Bulk Import (CSV/Excel + 3-cấp tree)
3. Table Management (sơ đồ bàn + chuyển bàn + 3 loại)
4. Order Lifecycle & Stock-out
5. Auto-close Bàn (pending-review)
6. Báo Cáo Cuối Ngày

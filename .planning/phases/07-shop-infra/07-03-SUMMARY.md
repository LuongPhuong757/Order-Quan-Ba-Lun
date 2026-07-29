---
phase: 07-shop-infra
plan: 03
status: complete
completed: 2026-07-29
requirements: [REQ-Q]
files_modified:
  - apps/api/src/common/middleware/csrf-origin.middleware.ts
  - .env.example
  - .env.production.example
unplanned_findings:
  - "docker-compose.prod.yml:62 truyền ALLOWED_ORIGIN nhưng .env.production.example không khai báo → admin 403 ở production"
---

# Plan 07-03 — Nối allow-list vào CsrfOriginGuard

## Kết quả

2/2 task xong. Lỗ prefix-spoofing đóng lại, có 18 test bảo vệ.

## Thay đổi

**`csrf-origin.middleware.ts`:**
- `parseAllowedOrigins()` gọi **1 lần ở module scope**, không parse lại mỗi request
- Default local đổi từ `http://localhost:5173` → `http://localhost:5173,http://localhost:5174` (5174 = port strict của `apps/shop`)
- Xoá `origin.startsWith(allowed)`, thay bằng `isOriginAllowed(origin, ALLOWED_ORIGINS)`
- Giữ nguyên `code: 'CSRF_ORIGIN_MISMATCH'`, `MUTATION_METHODS`, và `pathRequiresCheck` (vẫn chỉ `/admin/` + `/auth/`)

**Không** mở CSRF check sang `/api/public/*` — endpoint mutation công khai là phạm vi phase 8 (D-10).

## Verify

```
$ pnpm typecheck                          → pass
$ pnpm test                               → 18 passed (18)
$ grep -rn "startsWith(allowed)" src/     → chỉ còn trong comment giải thích, không còn trong code
```

## Phát hiện ngoài kế hoạch: admin có thể đang bị 403 ở production

`docker-compose.prod.yml:62` **đã** truyền `ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}` vào container `api`, nhưng `.env.production.example` **không hề khai báo biến này**.

Hệ quả nếu ai dựng production theo đúng file mẫu: compose truyền chuỗi rỗng → `process.env.ALLOWED_ORIGIN || 'http://localhost:5173...'` → chuỗi rỗng là falsy → rơi về default localhost → origin thật `https://<domain>` không khớp → **mọi mutation của admin trả 403 `CSRF_ORIGIN_MISMATCH`**.

Production hiện tại có thể vẫn chạy được nếu `.env.production` thật trên VPS đã có biến này (file đó do chủ dự án giữ, không có trong repo). Nhưng file mẫu thiếu là bug thật.

Đã thêm vào `.env.production.example` kèm cảnh báo "BẮT BUỘC phải có". Đưa vào `07-UAT.md` để chủ dự án tự kiểm file thật trên VPS.

## Ghi chú: tên miền chưa nhất quán

`.env.production.example` ghi `DOMAIN=quanbalun.com`, còn spec M2 + toàn bộ `.planning/` dùng `quanbalun.site`. Em theo style file gốc (`.com`) khi viết `ALLOWED_ORIGIN`, nhưng **cần chốt lại một cái** trước khi deploy — đã ghi vào `07-UAT.md`.

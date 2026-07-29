---
phase: 07-shop-infra
plan: 01
status: complete
completed: 2026-07-29
requirements: [REQ-Q]
files_modified:
  - apps/api/src/main.ts
  - Dockerfile
  - .gitignore
unplanned_changes:
  - "pnpm install + build packages/utils (repo đang vỡ typecheck trước khi bắt đầu)"
  - "Thêm '/api' vào apiPrefixes — sửa bug production có sẵn từ Milestone 1"
  - ".gitignore: loại apps/api/web-dist + shop-dist"
---

# Plan 07-01 — Host-aware static routing

## Kết quả

3/3 task xong. Tracer của phase 7 chạy được end-to-end trên local: **một process, một port, hai app** phân biệt bằng `Host` header.

## Bằng chứng

API chạy `NODE_ENV=production` trên `localhost:3001`, MySQL local 3306. Không deploy, không chạm VPS.

```
$ curl -s -H "Host: order.localhost" -H "Accept: text/html" http://localhost:3001/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
index-CWCvEb38.js          ← shop bundle

$ curl -s -H "Host: localhost" -H "Accept: text/html" http://localhost:3001/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
index-Dg4FmpDQ.js          ← web bundle (KHÁC hash → đúng 2 dist khác nhau)

$ curl -s -H "Host: order.localhost" -H "Accept: text/html" http://localhost:3001/o/abc123 | grep -oE 'index-[A-Za-z0-9_-]+\.js'
index-CWCvEb38.js          ← deep route cũng trả SPA shell của shop

$ curl -s http://localhost:3001/api/public/health
{"ok":true,"data":{"status":"ok","db":"up","uptime_s":12,"version":"0.1.0"}}

$ curl -s http://localhost:3001/health
{"status":"ok","db":"up","uptime_s":12,"version":"0.1.0"}      ← route staff cũ không vỡ
```

`cd apps/api && pnpm typecheck` → pass.

## Phát hiện ngoài kế hoạch

### 1. Bug production có sẵn: `/api/*` trả HTML thay vì JSON — ĐÃ SỬA

Plan bản đầu (và `07-CONTEXT.md` D-05) khẳng định **sai** rằng không cần thêm `/api` vào `apiPrefixes`, lý do đưa ra là "Nest mount router trước middleware". Test thật chứng minh ngược lại:

- `GET /health` (có trong `apiPrefixes`) → JSON ✓
- `GET /api/public/health` (không có trong list) → `index.html`, **kể cả với `Accept: application/json`** ✗

Cơ chế đúng: Nest đăng ký router trong `app.init()`, chạy bên trong `listen()`, tức **sau** mọi `app.use()` trong `bootstrap()`. Middleware SPA fallback vì thế đứng **trước** router.

Đây là bug tồn tại từ Milestone 1, chỉ chưa ai gặp vì `/api/public/health` là endpoint `/api/*` **đầu tiên** của repo và chưa từng được gọi ở production. Nếu không sửa, **toàn bộ 25 endpoint `/api/public/*` của phase 8–9 sẽ trả HTML ở production** trong khi ở dev (Vite proxy, không qua middleware này) vẫn chạy đúng — loại bug ẩn tới lúc deploy mới lộ.

Fix: thêm `'/api'` vào đầu `apiPrefixes` + comment nêu cơ chế. `D-05` trong CONTEXT.md đã đánh dấu SAI và sửa lại.

Đây đúng là loại bug mà việc tách phase 7 ra khỏi 8 nhằm bắt sớm — *"bắt sớm 3 bug hạ tầng đã phát hiện, trước khi đổ công vào UI"*.

### 2. Repo đang vỡ typecheck trước khi bắt đầu

`cd apps/api && pnpm typecheck` fail: `Cannot find module '@order/utils'`. Hai nguyên nhân cộng lại:
- `apps/api/node_modules/@order/` **chỉ có** symlink `schemas`, thiếu `utils` — `pnpm install` chưa chạy lại từ khi `@order/utils` được thêm vào dependencies.
- `packages/utils` **chưa từng được build** — `package.json` trỏ `main: dist/index.js` nhưng không có `dist/`.

Đã sửa: `pnpm install` (tạo symlink) + `pnpm --filter @order/utils build`. Không phải thay đổi source nào.

### 3. `useStaticAssets()` không dùng được cho routing theo host

`app.useStaticAssets(dir)` mount cố định một thư mục, không có hook chọn theo request. Phải chuyển sang `express.static()` tạo sẵn 2 handler rồi tự dispatch trong `app.use()`. `useStaticAssets` cho `/uploads/` giữ nguyên (không phụ thuộc host).

### 4. `Dockerfile` thiếu `packages/utils` — không chỉ thiếu `apps/shop`

`@order/api` đã depend `@order/utils` nhưng Dockerfile không copy manifest của nó ở stage `deps` → `pnpm install --frozen-lockfile` sẽ vỡ trong image. Đã thêm ở cả 3 stage (`deps` manifest, `builder` node_modules + build, `runtime` manifest + dist).

## Chưa verify được

**`docker build` không chạy được — Docker không được cài trên máy này** (`docker: command not found`, không có `Docker Desktop` ở `Program Files`, không có `C:\ProgramData\DockerDesktop`).

Thay bằng tương đương local, chạy đúng thứ tự lệnh trong Dockerfile:

```
$ pnpm install --frozen-lockfile                    → Done in 1.4s (lockfile phủ đủ shop + utils)
$ pnpm --filter @order/schemas build                → ok
$ pnpm --filter @order/utils build                  → ok (index.js, index.d.ts, index.js.map)
$ pnpm --filter @order/api build                    → ok
$ pnpm --filter @order/web build                    → ok
$ pnpm --filter @order/shop build                   → ok, 194.87 kB
```

Phần **chưa** được chứng minh: các đường dẫn `COPY --from=builder` bên trong image (vd `/app/apps/shop/dist` → `./apps/api/shop-dist`). Cần chạy `docker build -t oqbl-test .` một lần khi máy có Docker. **Đưa vào deferred UAT.**

## Dọn dẹp

- `apps/api/web-dist` + `apps/api/shop-dist` là artifact copy tay để test → đã thêm vào `.gitignore`, không commit.
- Process API production-mode đã dừng sau khi verify.
- Lưu ý vận hành: `pkill -f "node dist/main.js"` **không giết được** process node trên Windows. Dùng
  `netstat -ano | grep :3001` lấy PID rồi `taskkill //F //PID <pid>`. Lần đầu restart bị bỏ qua vì process cũ
  vẫn giữ port (`EADDRINUSE` trong log) khiến kết quả curl là của binary cũ — đã phát hiện và làm lại.

## Ảnh hưởng tới phase sau

- Phase 8 xây endpoint `/api/public/*` — nay đã chắc chắn tới được controller ở production mode.
- `isShopHost()` là điểm duy nhất định nghĩa "đâu là trang khách". Phase 8/9 cần logic theo host thì dùng lại nó, đừng viết lại.

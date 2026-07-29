---
status: testing
phase: 07-shop-infra
source: [07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md]
started: 2026-07-29
updated: 2026-07-29
---

# Phase 7 — Deferred UAT

**Đây KHÔNG phải blocker của phase 7.** Toàn bộ Milestone 2 làm LOCAL ONLY (C-LOCAL-01), nên 7 hạng mục dưới đây chỉ nghiệm thu được khi chủ dự án tự deploy sau milestone. Mỗi hạng mục đã có phương án thay thế đã chạy ở local.

## Current Test

number: —
name: chưa bắt đầu (chờ chủ dự án deploy)
expected: |
  Không có test nào được chạy trên production ở phase này — theo đúng mandate LOCAL ONLY.
awaiting: chủ dự án chủ động deploy khi muốn

## Tests

### 1. DNS A record cho `order.<domain>` (M2.D-65)
expected: `nslookup order.quanbalun.site` trả đúng IP VPS
result: pending
local_substitute: không có — hoàn toàn ngoài phạm vi local
steps: |
  Thêm A record `order` → IP VPS ở nhà cung cấp DNS. Chờ TTL.
  Kiểm: `nslookup order.<domain>` hoặc `dig +short order.<domain>`

### 2. Caddy tự cấp TLS cert cho site block `order.` (M2.D-65)
expected: `https://order.<domain>` mở được, cert do Let's Encrypt cấp, không cảnh báo
result: pending
local_substitute: chỉ review diff `Caddyfile` — đã làm ở 07-04
steps: |
  Sau khi DNS trỏ đúng, deploy Caddyfile mới rồi `docker compose logs caddy` xem dòng
  "certificate obtained successfully" cho `order.<domain>`.
  Kiểm: `curl -sI https://order.<domain> | head -1` → `HTTP/2 200`
depends_on: test 1

### 3. `Permissions-Policy: geolocation=(self)` thật sự được serve (M2.D-69)
expected: header có `geolocation=(self)` ở `order.`, và `geolocation=()` ở apex
result: pending
local_substitute: |
  Không thể — header này CHỈ do Caddy set, Vite dev server không set (CONCERNS.md:64-68).
  Local chỉ verify được text trong Caddyfile.
steps: |
  curl -sI https://order.<domain> | grep -i permissions-policy
    → phải thấy: geolocation=(self), camera=(), microphone=()
  curl -sI https://<domain> | grep -i permissions-policy
    → phải thấy: geolocation=(), camera=(self), microphone=()
  Rồi mở trang khách trên ĐIỆN THOẠI THẬT, bấm "Chia sẻ vị trí" → trình duyệt phải hỏi quyền
  và trả về được toạ độ. Đây là phần chỉ người thật kiểm được.
depends_on: test 2

### 4. Cookie host-only qua 2 hostname thật (M2.D-68)
expected: đăng nhập admin ở apex, cookie `ssp_token` KHÔNG được gửi khi request tới `order.`
result: pending
local_substitute: |
  Không thể — cần 2 hostname thật. Local đã thay bằng unit test allow-list (07-02, 18 test).
steps: |
  1. Đăng nhập admin tại `https://<domain>`
  2. Mở DevTools → Application → Cookies: xác nhận `ssp_token` có Domain = `<domain>`
     (KHÔNG phải `.<domain>` — dấu chấm đầu nghĩa là dùng chung cho mọi subdomain)
  3. Sang tab `https://order.<domain>`, DevTools → Network → chọn 1 request bất kỳ →
     tab Headers → xác nhận KHÔNG có `Cookie: ssp_token=...`
depends_on: test 2

### 5. Static routing đầu-cuối xuyên Caddy (M2.D-66)
expected: `order.<domain>` trả app khách, apex trả app quản lý, cùng 1 container
result: pending
local_substitute: |
  ĐÃ CHỨNG MINH ở local (07-01): curl -H "Host: order.localhost" trả bundle shop
  (index-CWCvEb38.js), curl -H "Host: localhost" trả bundle web (index-Dg4FmpDQ.js).
  Phần chưa chứng minh chỉ là Caddy forward Host header nguyên vẹn.
steps: |
  curl -s https://order.<domain> | grep -oE 'index-[A-Za-z0-9_-]+\.js'   → bundle shop
  curl -s https://<domain>       | grep -oE 'index-[A-Za-z0-9_-]+\.js'   → bundle web
  Hai giá trị phải KHÁC nhau. Nếu giống nhau → Caddy đang ghi đè Host, phải thêm
  `header_up Host {host}` vào block reverse_proxy.
depends_on: test 2

### 6. `docker build` chạy được với 2 frontend + packages/utils (bổ sung ở 07-01)
expected: image build tới stage runtime, trong image có cả `web-dist` và `shop-dist`
result: pending
local_substitute: |
  Docker KHÔNG được cài trên máy dev (`docker: command not found`). Đã thay bằng chạy đúng
  chuỗi lệnh của Dockerfile ở local: pnpm install --frozen-lockfile + build schemas, utils,
  api, web, shop — tất cả pass. Phần chưa chứng minh: các đường dẫn COPY --from=builder.
steps: |
  docker build -t oqbl-test .
  docker run --rm oqbl-test ls -la /app/apps/api/
    → phải thấy CẢ web-dist VÀ shop-dist
  docker run --rm oqbl-test ls /app/packages/utils/dist
    → phải thấy index.js
severity_if_fail: major — sai đường dẫn COPY thì container thiếu app khách

### 7. Cú pháp Caddyfile (bổ sung ở 07-04)
expected: `caddy validate` pass với Caddyfile 2 block
result: pending
local_substitute: |
  Không validate được — máy dev không có `caddy` CLI lẫn Docker. Chỉ kiểm được bằng grep:
  apex giữ geolocation=(), block order. có geolocation=(self), 2 Referrer-Policy khác nhau,
  đúng 1 block order., không có www.order.
steps: |
  docker run --rm -e DOMAIN=quanbalun.site -v "$PWD/Caddyfile:/etc/caddy/Caddyfile" \
    caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  Chạy TRƯỚC khi reload Caddy production — cú pháp sai làm Caddy không khởi động lại được.
severity_if_fail: major — Caddy chết thì cả apex lẫn order. đều down

---

## Ghi chú cho lúc deploy

- **Thứ tự bắt buộc:** test 7 (validate cú pháp) → test 6 (build image) → test 1 (DNS) → test 2 (cert) → 3/4/5.
- **`ALLOWED_ORIGIN` phải được set trong `.env.production`.** `docker-compose.prod.yml:62` đã truyền biến này
  vào container nhưng `.env.production.example` trước đây không khai báo → để trống thì middleware rơi về default
  localhost và **mọi mutation của admin bị 403**. Đã bổ sung vào file mẫu ở 07-03, nhưng file `.env.production`
  thật trên VPS là do chủ dự án giữ — phải tự kiểm.
- **Tên miền chưa nhất quán:** `.env.production.example` ghi `DOMAIN=quanbalun.com`, còn spec M2 và
  `.planning/` đều dùng `quanbalun.site`. Chốt lại một cái trước khi deploy.

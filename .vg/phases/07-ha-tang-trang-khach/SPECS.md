---
phase: "07"
profile: infra
platform: web-fullstack
status: approved
created_at: 2026-07-29
source: ai-draft
---

## Goal

Dựng frontend riêng `apps/shop` cho khách trên subdomain `order.<domain>`, dùng chung
1 API + 1 DB với trang quản lý (M2.D-64, M2.D-65). Phase hạ tầng thuần — chưa có nghiệp
vụ đặt hàng. Mục đích: cô lập và bắt sớm 3 lỗi hạ tầng đã phát hiện khi soi code
(Permissions-Policy chặn geolocation, CSRF chỉ so 1 origin, static serve 1 thư mục cho
mọi host) trước khi đổ công vào UI ở phase 08.

Nguồn quyết định: `.vg/MILESTONE-02-ONLINE-ORDERING-SPEC.md` § Vòng 5 (M2.D-64..69).

## Scope

### In Scope

#### App mới `apps/shop`
- Vite + React + TypeScript, thêm vào `pnpm-workspace.yaml` + `turbo.json`.
- Dùng chung `packages/schemas` với `apps/api` và `apps/web` (không copy type).
- Mobile-first: viewport chống auto-zoom, touch target ≥ 44×44px, font ≥ 16px.
- Trang placeholder (chưa có nghiệp vụ): `/`, `/cart`, `/checkout`, `/o/:token`, `/history`.
- Nút thử **"Chia sẻ vị trí"** tạm thời — chỉ để verify quyền Geolocation thật trên
  production, xoá hoặc thay bằng bản thật ở phase 08.

#### Backend (thay đổi tối thiểu)
- `GET /api/public/health` — endpoint duy nhất của phase này, để chứng minh trang khách
  gọi được API cùng origin (không cần CORS).
- `apps/api/src/main.ts`: chọn thư mục static theo `Host` header — host bắt đầu `order.`
  → `shop-dist`, còn lại → `web-dist` (M2.D-66). Giữ nguyên SPA fallback hiện có cho
  cả hai.
- `csrf-origin.middleware.ts`: `ALLOWED_ORIGIN` nhận **danh sách** phân tách dấu phẩy,
  trim khoảng trắng, so khớp chính xác từng origin (M2.D-67).

#### Hạ tầng deploy
- `Caddyfile`: thêm site block `order.{$DOMAIN}` → `reverse_proxy api:3001`, với
  `Permissions-Policy: geolocation=(self)` (M2.D-69). Site block admin **giữ**
  `geolocation=()`.
- `Dockerfile`: build thêm `apps/shop` → copy ra `shop-dist` cạnh `web-dist`.
- `.env.production`: `ALLOWED_ORIGIN` thành 2 origin (apex + order).
- DNS A record `order.quanbalun.site` → IP VPS; verify cert HTTPS Caddy tự cấp.

## Out of Scope

- Menu công khai, giỏ hàng, checkout thật, snapshot giá — **phase 08**.
- Bảng DB mới (`store_settings`, `online_order_requests`, `phone_blacklist`,
  `notification_outbox`, `site_events`) và cột thêm vào `orders` — **phase 08–10**.
- Công tắc ON/OFF nhận đơn, rate limit, blacklist SĐT — **phase 08**.
- Duyệt đơn, cấp bàn, SSE, SMS/Email, leo thang, trang tracking — **phase 09**.
- Analytics, phễu chuyển đổi, email tổng hợp cuối ngày — **phase 10**.
- Giao diện theo tham chiếu lotteria.vn — **phase 08** (cần ảnh design ref, hiện còn
  thiếu bản mobile — xem `.vg/design-refs/lotteria/README.md`).
- Sửa bất kỳ hành vi nào của `apps/web` (POS nội bộ đang chạy production).
- Đổi cơ chế auth / cookie / JWT.

## Constraints

- **KHÔNG đổi cookie sang domain-wide.** Giữ host-only (`cookieOptions` không set
  `domain`) + `sameSite: 'strict'` — `jwt.service.ts`. Đổi sang `.quanbalun.site` là
  tự mở lỗ hổng: token admin sẽ được gửi sang subdomain công khai (M2.D-68).
- HSTS `includeSubDomains` đã bật ở Caddyfile → subdomain **buộc** có cert hợp lệ,
  không verify được bằng HTTP thuần.
- `synchronize: true`, không viết migration file (M2.D-07). Phase này **không đổi
  schema** nên ràng buộc này chỉ là nhắc nhở.
- API prefix hiện tại là `/auth`, `/orders`, `/menu`… — **không có prefix `/api` chung**.
  Vì vậy Caddy không tự phân biệt được static và API; chọn static theo `Host` trong
  API là cách đổi ít nhất (M2.D-66). Không refactor prefix ở phase này.
- Bundle route `/` của shop ≤ **150KB gzip**, Time-to-Interactive < 3s trên Slow-4G
  (theo baseline mobile-first đã chốt ở phase 01).
- Deploy qua `./deploy.sh` (git pull + rebuild Docker trên VPS), credentials ở
  `.env.deploy`.
- **Cần quyền sửa DNS** của `quanbalun.site` — việc thủ công ngoài code, phải làm
  trước khi verify được success criteria.
- Làm trên nhánh `feat/online-ordering`, không merge vào `main` trước khi verify xong.

## Success criteria

- [ ] `order.<domain>` trả bundle `shop-dist`; `<domain>` và `www.<domain>` trả
      `web-dist`; cả hai cùng 1 container (AC-Q1, M2.D-66).
- [ ] grep `/dashboard` và `/kitchen` trong JS đã build của shop → **không thấy**
      (AC-Q2, M2.D-64).
- [ ] Đăng nhập admin ở apex, sau đó request tới `order.<domain>` → DevTools Network
      cho thấy **không có** cookie `ssp_token` (AC-Q3, M2.D-68).
- [ ] `GET /api/public/health` từ origin `order.<domain>` → 200; cùng request với
      `Origin` lạ → bị chặn (AC-Q4, M2.D-67).
- [ ] Nút "Chia sẻ vị trí" **xin được quyền và trả lat/lng trên HTTPS production**
      (AC-Q5, M2.D-69) — đây là bug sẽ xảy ra nếu quên sửa `Permissions-Policy`.
- [ ] `curl -I https://order.<domain>` → cert hợp lệ, HTTP/2 (AC-Q6).
- [ ] **Không hồi quy `apps/web`**: login + sơ đồ bàn + trang bếp + thanh toán vẫn
      chạy đúng như trước khi sửa `main.ts`.
- [ ] `pnpm build` ở root build được cả 2 app; turbo cache không xung đột giữa
      `web-dist` và `shop-dist`.

## Dependencies

### Upstream (gate trước phase này)
- **DNS A record** `order.quanbalun.site` → IP VPS — việc thủ công, không code được.
- Truy cập VPS qua `.env.deploy` + `./deploy.sh` (skill `/deploy-vps`).

### Downstream (phase này gate cho)
- **Phase 08** (Public Menu + Checkout + Công tắc) — không thể bắt đầu trước khi
  phase 07 xong, vì mọi UI khách nằm trong `apps/shop`.
- **Phase 09, 10** — gián tiếp qua phase 08.

### External
- **Let's Encrypt** qua Caddy auto-cert — cần port 80/443 mở (đã có).
- Không có third-party API nào ở phase này.

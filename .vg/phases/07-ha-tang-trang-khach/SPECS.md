---
phase: "07"
profile: infra
platform: web-fullstack
status: approved
created_at: 2026-07-29
source: ai-draft
---

> **Amendment 2026-07-29** — thêm **4 bản sửa hạ tầng** phát hiện khi thảo luận scope phase 08:
> F2 SPA fallback bỏ qua `/api/*` · F4 `Referrer-Policy: no-referrer` + proxy `/uploads/` ·
> F5 Dockerfile thêm `packages/utils` vào cả 3 stage · F6 CSRF so khớp chính xác + phủ
> `/api/admin/`. Mỗi mục được đánh dấu *(bổ sung 2026-07-29)* trong Scope và Success criteria.
> Nguồn: `.vg/phases/08-public-menu-checkout/DISCUSSION-LOG.md#round-2` và `#round-3`.
> Lý do đưa về phase 07: cả 4 đều là hạ tầng, và F2 phá chính tiêu chí
> `GET /api/public/health` của phase 07.

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
- **`apps/api/src/main.ts` — cho `/api/*` đi qua TRƯỚC nhánh `wantsHtml`** *(bổ sung
  2026-07-29, phát hiện ở scope 08)*. Thêm `if (req.path === '/api' ||
  req.path.startsWith('/api/')) return next();` làm **câu lệnh đầu tiên** của middleware.
  Hiện `apiPrefixes` (main.ts:46) không có `/api` và nhánh `wantsHtml` chạy trước, nên mọi
  `GET /api/public/*` trả về `index.html` — **chỉ trên production** (`NODE_ENV=production` +
  có `web-dist`), local dev pass hết. Phá luôn `GET /api/public/health` của chính phase này.
- `csrf-origin.middleware.ts`: `ALLOWED_ORIGIN` nhận **danh sách** phân tách dấu phẩy,
  trim khoảng trắng, **so khớp CHÍNH XÁC** từng origin — không dùng `startsWith` (M2.D-67).
- **`csrf-origin.middleware.ts` — `pathRequiresCheck` phủ thêm `/api/admin/`, loại trừ
  tường minh `/api/public/`** *(bổ sung 2026-07-29)*. Hiện chỉ phủ `/admin/` và `/auth/` nên
  `PUT /api/admin/settings` không được kiểm origin. Phải loại trừ `/api/public/` vì `curl`
  không có header `Origin`, nếu chặn thì phá tiêu chí "test bằng curl" của phase 08.
  Lỗ hổng đang có: `'https://quanbalun.site.evil.com'.startsWith('https://quanbalun.site')`
  trả `true`.

#### Hạ tầng deploy
- `Caddyfile`: thêm site block `order.{$DOMAIN}` → `reverse_proxy api:3001`, với
  `Permissions-Policy: geolocation=(self)` (M2.D-69). Site block admin **giữ**
  `geolocation=()`.
- **`Caddyfile` — site block `order.` thêm `Referrer-Policy: no-referrer`** *(bổ sung
  2026-07-29)*: URL `/o/<order_token>` không rò qua header `Referer` sang asset bên ngoài.
  Và **phải proxy được `/uploads/`** vì ảnh món lưu đường dẫn tương đối
  `/uploads/menu/<file>`.
- `Dockerfile`: build thêm `apps/shop` → copy ra `shop-dist` cạnh `web-dist`.
- **`Dockerfile` — thêm `packages/utils` vào CẢ 3 stage** *(bổ sung 2026-07-29)*: sao y đúng
  cách `packages/schemas` đang làm (COPY manifest ở `deps` dòng 14-16 và `runtime` dòng
  55-57, COPY `dist` dòng 63). Dockerfile liệt kê manifest **bằng tay** nên thiếu là
  `ERR_PNPM_OUTDATED_LOCKFILE`, build image fail trước khi app chạy. `packages/utils` do
  phase 08 tạo nhưng **hạ tầng build phải có sẵn từ phase 07**.
- `.env.production`: `ALLOWED_ORIGIN` thành **3 origin**: `https://<domain>`,
  `https://www.<domain>`, `https://order.<domain>` *(sửa 2026-07-29 sau CrossAI
  blueprint-review — bản đầu ghi "2 origin" nhưng site block hiện tại là
  `{$DOMAIN}, www.{$DOMAIN}` nên `www.` là origin thật, bỏ sót sẽ chặn oan khách vào
  bằng `www.`)*.
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
- [ ] **`GET /api/public/health` với `Accept: text/html` vẫn trả JSON**, không trả vỏ HTML của
      POS — kiểm ở chế độ production, không phải dev *(bổ sung 2026-07-29)*.
- [ ] **CSRF: origin giả mạo `https://order.<domain>.evil.com` → 403**; **cả 3 origin thật**
      (`https://<domain>`, `https://www.<domain>`, `https://order.<domain>`) → 200; `POST` vào `/api/public/*` từ curl **không** header Origin → không bị
      chặn *(bổ sung 2026-07-29)*.
- [ ] **`curl -I https://order.<domain>` có header `Referrer-Policy: no-referrer`**; và
      `https://order.<domain>/uploads/menu/<file>` trả đúng ảnh *(bổ sung 2026-07-29)*.
- [ ] **Docker image build được với `packages/utils` rỗng trong workspace** — không
      `ERR_PNPM_OUTDATED_LOCKFILE`, `node dist/main.js` không `ERR_MODULE_NOT_FOUND`
      *(bổ sung 2026-07-29)*.

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

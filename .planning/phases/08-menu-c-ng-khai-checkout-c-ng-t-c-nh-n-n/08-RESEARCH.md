# Phase 8: Menu công khai, Checkout & Công tắc nhận đơn - Research

**Researched:** 2026-07-30
**Domain:** Public e-commerce ordering flow (NestJS + TypeORM public API) + React SPA (apps/shop) + admin settings UI (apps/web)
**Confidence:** MEDIUM-HIGH (kiến trúc + pitfall đã đọc trực tiếp từ code hiện có = HIGH; vài con số cụ thể — ngưỡng rate limit, thứ tự triển khai — chưa chốt = cần chủ dự án xác nhận, xem cuối file)

## Summary

Phase 8 không phải "trang landing page mới" — nó là 1 luồng giao dịch công khai đầu tiên của hệ thống
(trước giờ mọi mutation đều sau JWT + role guard). 3 rủi ro lớn nhất phát hiện được khi đọc code thật
(không phải suy đoán):

1. **`CsrfOriginGuard` hiện KHÔNG bảo vệ `/api/public/*`.** `pathRequiresCheck()` trong
   `csrf-origin.middleware.ts` chỉ check path bắt đầu bằng `/admin/` hoặc `/auth/`. Khi
   `POST /api/public/orders` ra đời, bất kỳ website nào cũng auto-submit form tới nó mà không bị
   chặn Origin — rate-limit/blacklist vẫn là lưới cuối nhưng lớp phòng thủ đầu tiên đang thiếu.
2. **`apps/web` chưa từng có pattern "zod parse response runtime"** — toàn bộ `zod` trong `apps/web`
   hiện chỉ dùng làm kiểu TypeScript compile-time (`z.infer`), không có `.parse()`/`.safeParse()`
   nào chạy trên response thật. D-02 (zod parse mọi response ở `apps/shop`) là pattern **mới hoàn
   toàn** cho monorepo này, không phải "làm theo cái đã có" — plan phải tự dựng từ đầu.
3. **`sharp` (D-12) là dependency native đầu tiên của `apps/api`.** Máy dev không có Docker (đã ghi ở
   `07-UAT.md` test 6), nên rủi ro build-time (musl/alpine, lockfile cross-platform) không kiểm được
   tại chỗ — chỉ giảm thiểu bằng cấu hình đúng trước, và test build ở CI/production.

**Primary recommendation:** Đi theo đúng trình tự đã gợi ý trong CONTEXT.md (router/AppShell trước),
nhưng **thêm 1 việc bắt buộc ở đầu BE track**: mở rộng `pathRequiresCheck()` để phủ `/api/public/*`
(mutation methods) trước khi viết `POST /api/public/orders` — nếu không, submit đơn thật sẽ sống với
lỗ hổng CSRF-adjacent ngay từ ngày đầu production.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Hiển thị menu, giỏ hàng, checkout form | Browser (apps/shop SPA) | API (nguồn dữ liệu) | CSR thuần, không SSR — toàn bộ state ở client, API chỉ trả JSON |
| Đánh giá "đang nhận đơn hay không" (công tắc + giờ mở cửa) | API (apps/api) | — | BE là nguồn sự thật (M2.D-27) — FE chỉ hiển thị lại kết quả BE trả, KHÔNG tự tính toán song song để tránh 2 nơi có 2 kết luận khác nhau |
| Rate limit / blacklist / 1-đơn-mở-1-SĐT | API (apps/api) | Database (đếm + lock) | Không thể làm ở FE (dễ bypass); DB cần vì phải sống sót qua restart |
| Resize/nén ảnh lúc upload | API (apps/api, tại thời điểm nhận file) | — | Phải xảy ra trước khi ghi file — làm ở FE (canvas resize trước upload) không đáng tin vì client có thể bypass |
| Widget công tắc + `/admin/settings` | Browser (apps/web SPA) | API (đọc/ghi `store_settings`) | Admin app, theo đúng pattern JWT + RoleGate hiện có |
| Geolocation → distance_km | Browser (Geolocation API) → API (Haversine) | — | Toạ độ phải lấy ở client (browser API); tính khoảng cách nên làm ở BE để FE và BE không lệch công thức, và để log/audit được `distance_km` đã chốt |
| Snapshot giá tại submit | API (apps/api) | Database (`items_snapshot`) | BẮT BUỘC ở BE — client không được là nguồn giá, xem Pitfall "đừng tin giá client gửi" |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions (D-01 .. D-22, tóm tắt — xem `08-CONTEXT.md` để đọc đầy đủ)

- D-01: `apps/shop` gọi API bằng `fetch` thuần + hook tự viết, KHÔNG axios, KHÔNG TanStack Query.
- D-02: Zod parse mọi response `/api/public/*` qua `@order/schemas`; `apps/shop/package.json` phải
  thêm `zod` làm direct dependency (hiện chỉ có `@order/schemas`).
- D-03: Menu tải 1 lần toàn bộ, lọc/tìm client-side, không endpoint search riêng.
- D-04: Lỗi mạng tải menu → banner + nút "Thử lại" tại chỗ, không error boundary toàn trang.
- D-05: Giỏ lưu localStorage cùng chỗ `customer_token`.
- D-06: Giỏ hết hạn sau 24h → xoá sạch, về empty state.
- D-07: Đồng bộ giỏ với menu mới lúc tải trang — giá đổi thì cập nhật + banner; hết hàng thì làm mờ +
  khoá dòng + chặn nút TIẾP TỤC tới khi khách xoá dòng đó. Không bao giờ im lặng xoá/đổi giá.
- D-08: Không sync giỏ giữa nhiều tab.
- D-09: `GET /api/public/menu` trả `images[]` map 0..1 phần tử từ `menu_item.image_url` — KHÔNG đổi
  schema DB, ghi override vào `OVERRIDE-DEBT.md`.
- D-10: Món không ảnh → placeholder nền `--wood-100` + icon bát SVG, không dùng ảnh mặc định chung.
- D-11: Ảnh card `object-fit: cover`, `aspect-ratio: 4/3`.
- D-12: Thêm resize (~800px) + nén webp lúc admin upload trong `menu.controller.ts`
  (`UPLOAD_DIR='uploads/menu'`). Cân nhắc ảnh hưởng Docker image (máy dev không Docker).
- D-13: Widget công tắc ở `DashboardPage` (tắt 1 chạm) + chi tiết ở `/admin/settings` mới.
- D-14: Blacklist SĐT là 1 tab trong `/admin/settings`, không phải route riêng.
- D-15: Giờ mở cửa nhập kiểu "mặc định chung + ngoại lệ theo thứ", không phải form 7 dòng.
- D-16: `/admin/settings` theo đúng pattern hiện có của `apps/web` (kể cả hardcode màu) — KHÔNG tạo
  `tokens.css` cho `apps/web` trong phase này.
- D-17: "OFF đến hết hôm nay" VÀ "ngoài giờ mở cửa" đều **tính lúc đọc, KHÔNG dùng cron**. Manual
  override luôn thắng.
- D-18: Rate limit theo SĐT **đếm trong DB** (không in-memory, không Redis). Rate limit theo IP giữ
  nguyên `@nestjs/throttler` global đã có, thêm `@Throttle` chặt hơn riêng cho endpoint submit.
- D-19: Card "Nhận hàng" (PICKUP/DELIVERY + địa chỉ) nằm ở bước 2 `/checkout`, không phải bước 1.
- D-20: Khi OFF/ngoài giờ: nút `+` thêm món vẫn bấm được; chỉ nút "ĐẶT HÀNG" cuối bước 2 bị khoá.
- D-21: Copy lỗi `PHONE_BLACKLISTED` giữ tông trung tính, không nói "bị chặn"/"blacklist".
- D-22: 7 giả định còn lại của UI-SPEC giữ nguyên (icon tự vẽ, nhãn nút, CSS-only header 2 biến thể...).

### Claude's Discretion

- Cách chia phase 8 thành plan (BE trước/FE sau hay slice dọc). Gợi ý có sẵn: router+AppShell là
  task đầu tiên vì 4 trang hiện là dead code.
- Tên bảng/cột/module Nest/DTO cụ thể — theo §schema của
  `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md`.
- Cách hash IP cụ thể (M2.D-56) — miễn không lưu IP thô.
- Số lượng/nội dung test, miễn phủ 4 criteria LOCKED cần test tự động (C-TEST-01).
- Thư viện resize ảnh cụ thể cho D-12.

### Deferred Ideas (OUT OF SCOPE)

- Nhiều ảnh thật/món (bảng `menu_item_images`) — API `images[]` đã chừa chỗ.
- `tokens.css` cho `apps/web` (refactor riêng, rủi ro cao).
- Sync giỏ hàng nhiều tab qua `storage` event.
- Đồng bộ `apps/shop/DESIGN.md` với `tokens.css` (drift có sẵn, không phải lỗi phase 8).
- Thanh toán online VietQR/chuyển khoản (M2.D-58 chốt COD, cột `payment_method` để sẵn).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-I | Trang menu công khai, mobile-first, tìm kiếm, món hết hàng làm mờ, giỏ hàng nổi | §Architecture Patterns (Trang Menu), §Don't Hand-Roll (client-side filter), Package Legitimacy (zod/router), UI-SPEC đã duyệt |
| REQ-J | Checkout 1 trang (thực chất 2 bước `/cart`→`/checkout`): PICKUP/DELIVERY, địa chỉ+Geolocation, ghi chú, autofill, snapshot giá | §Common Pitfalls (Geolocation thật, đừng tin giá client), §Code Examples (Haversine, items_snapshot), §Assumptions Log (map-link parsing) |
| REQ-K | Công tắc ON/OFF + giờ mở cửa + lý do, chặn 2 lớp | §Code Examples (evaluateOrderingStatus pure function), §Validation Architecture (criterion b) |
| REQ-L | Rate limit IP+SĐT, 1 đơn mở/SĐT, blacklist thêm/xoá tay | §Common Pitfalls (gap lock uniqueness), §Code Examples (thứ tự kiểm tra theo spec §7), §Validation Architecture (criterion c) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Không tìm thấy `./CLAUDE.md` (cả ở root lẫn `.claude/CLAUDE.md` theo `claude_md_path` trong
`config.json`) — file chưa tồn tại trong repo này. Không có directive bổ sung ngoài
`.planning/codebase/CONVENTIONS.md` và các quy ước đã trích trong `08-CONTEXT.md` (C-CONV-01 pure
ESM `.js` extension, comment/`describe` tiếng Việt).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `sharp` | `^0.35.3` [VERIFIED: npm registry `npm view sharp version` = 0.35.3, published bởi maintainer lovell/sharp — cũng xác nhận qua trang docs chính thức sharp.pixelplumbing.com] | Resize + encode webp lúc upload (D-12) | Chuẩn công nghiệp Node cho xử lý ảnh server-side — 4-10× nhanh hơn mọi thư viện pure-JS, hỗ trợ webp native, không cần thư viện phụ |
| `react-router-dom` | `^7.0.0` (ĐÃ có sẵn trong `apps/shop/package.json`) | BrowserRouter + 5 route | Không cần thêm — chỉ cần dùng, đã khai báo từ phase 7 nhưng chưa import ở `main.tsx` |
| `zod` | `^3.23.0` [VERIFIED: codebase — đã là dependency của `apps/web` và `packages/schemas`, version khớp] | Runtime parse response `/api/public/*` (D-02) | Phải thêm làm **direct** dependency của `apps/shop` (hiện transitive qua `@order/schemas`) — bundler không đảm bảo resolve nếu không khai trực tiếp |

### Supporting (devDependencies, cho harness test — Validation Architecture)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@nestjs/testing` | `^10.4.0` [ASSUMED — tên package biết từ training data, khớp major với `@nestjs/common@^10.4.0` hiện có qua `npm view`, nhưng KHÔNG lấy được xác nhận Context7/doc chính thức phiên này (WebFetch tới docs.nestjs.com thất bại — trang không trả nội dung đọc được cho tool)] | Bootstrap app thật trong test (`Test.createTestingModule`) cho test HTTP-level (criterion a) | Chỉ cần cho phần "gọi API tay nhận 409" — không cần cho test hàm thuần |
| `supertest` | `^7.2.0` [ASSUMED — cùng lý do trên] | Gửi HTTP request thật vào app test | Đi kèm `@nestjs/testing` |
| `@types/supertest` | `^7.2.0` [ASSUMED] | Type cho supertest | devDependency |

**Cân nhắc thay thế:** Nếu muốn giữ đúng triết lý tối giản "tách hàm thuần" đã có ở phase 7 (không
thêm devDependency mới), có thể bỏ qua `@nestjs/testing`/`supertest` và thay bằng test ở tầng
service (tự new class + fake repository object, không cần bootstrap Nest DI/HTTP) cho phần logic;
phần "BE thật trả đúng status code" thì verify tay bằng `curl` (đúng như spec §checklist dòng 563 tự
ghi "test bằng cách gọi API tay"). Xem quyết định cần chốt ở cuối file.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `sharp` (native binary) | `jimp` + `@jimp/wasm-webp` (pure JS/WASM) | Tránh hoàn toàn rủi ro native-binary/Docker, nhưng: (1) Jimp không hỗ trợ webp built-in, cần plugin WASM riêng chỉ chạy ESM; (2) chậm hơn 4-10× (không quan trọng ở quy mô 1 quán, vài ảnh/ngày); (3) ít trưởng thành hơn cho webp cụ thể. Không khuyến nghị trừ khi Docker build test thất bại thật sự với sharp |
| `sharp` | `@jsquash/webp` + `@jsquash/resize` (WASM, dự án jSquash) | README chính chủ ghi rõ "Node.js support is experimental, provided for convenience, không phải focus chính" — rủi ro tích hợp cao hơn lợi ích tránh native binary |
| Zod parse response ở FE | Không parse, tin response nguyên trạng (cách `apps/web` đang làm) | Nhanh hơn, ít code hơn, nhưng đúng rủi ro D-02 nêu: field đổi âm thầm (do `synchronize:true`) sẽ crash render thay vì báo lỗi rõ ràng tại chỗ |
| `@nestjs/testing` + `supertest` cho HTTP-level test | Test tầng service với fake repository (không bootstrap Nest) | Ít dependency hơn, nhanh hơn, nhưng không chứng minh được middleware/guard/pipe thật sự chạy đúng (vd CSRF guard mới sửa, ValidationPipe) |

**Installation:**
```bash
pnpm --filter @order/shop add zod
pnpm --filter @order/api add sharp
pnpm --filter @order/api add -D @nestjs/testing supertest @types/supertest   # nếu chọn hướng HTTP-level test
```

**Version verification đã chạy:**
```
$ npm view sharp version          → 0.35.3
$ npm view sharp engines          → { node: '>=20.9.0' }
$ npm view @nestjs/testing versions | grep '^10\.'  → mới nhất nhánh 10.x = 10.4.22 (khớp @nestjs/common^10.4.0)
$ npm view supertest version      → 7.2.2
```
**Lưu ý version Node:** root `package.json` khai `"engines": { "node": ">=20" }` — LỎNG hơn yêu cầu
thật của `sharp` (`>=20.9.0`). Máy dev nào có Node 20.0–20.8 sẽ cài `sharp` "thành công" nhưng có
thể lỗi runtime khó hiểu. Dockerfile dùng tag `node:20-alpine` (floating, luôn kéo bản mới nhất của
nhánh 20 tại thời điểm build) nên production không gặp vấn đề này — chỉ máy dev cũ mới rủi ro.
Khuyến nghị: sửa `engines.node` thành `>=20.9.0` khi thêm `sharp`.

## Package Legitimacy Audit

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|--------------|-----------|-------------|
| `sharp` | npm | tạo 2013 (~13 năm) | github.com/lovell/sharp | OK | Approved |
| `zod` | npm | tạo 2020 (~6 năm) | github.com/colinhacks/zod | OK | Approved (đã dùng trong repo) |
| `@nestjs/testing` | npm | tạo 2017 (~9 năm) | github.com/nestjs/nest | OK | Approved — nhưng xem cảnh báo provenance ở trên ([ASSUMED], chưa xác nhận qua Context7/doc chính thức phiên này) |
| `supertest` | npm | tạo 2012 (~14 năm) | github.com/ladjs/supertest | OK | Approved (cùng cảnh báo provenance) |
| `@types/supertest` | npm | tạo 2016 (~10 năm) | github.com/DefinitelyTyped/DefinitelyTyped | OK | Approved |

Đã chạy `slopcheck scan --pkg npm <tên> --json` cho cả 5 package — không package nào bị gắn cờ
`SLOP` hay `SUS`. Đã kiểm `npm view sharp scripts.postinstall` — **không có** postinstall script
(sharp bản hiện đại dùng `optionalDependencies` theo platform thay vì script tải nhị phân lúc
cài — an toàn hơn cách cũ).

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### Đề xuất bề mặt API cho phase 8 (thu hẹp so với spec §5.1)

Đọc kỹ REQ-I..L + `08-UI-SPEC.md` cho thấy **không phải mọi endpoint liệt kê ở spec §5.1 cần dựng
trong phase 8**:

| Endpoint spec §5.1 | Cần cho phase 8? | Vì sao |
|---|---|---|
| `GET /api/public/store` | **Có** | REQ-K cần |
| `GET /api/public/menu` | **Có** | REQ-I cần |
| `POST /api/public/orders` | **Có** | REQ-J cần |
| `GET /api/public/orders/:token` | **Có (tối giản)** | Chỉ cần đủ cho màn xác nhận sau submit — UI-SPEC nói rõ nội dung đầy đủ (%, 5 mốc) là phase 9 |
| `POST /api/public/session` | **KHÔNG cần** | `session_id` chỉ phục vụ analytics (`site_events`, REQ-P/phase 10). `customer_token` (M2.D-09) sinh **100% client-side** bằng `crypto.randomUUID()` hoặc `getRandomValues` + hex-encode ≥32 byte, lưu localStorage — không cần round-trip BE |
| `POST /api/public/events` | **KHÔNG cần** | Thuộc REQ-P (phase 10), chưa có bảng `site_events` cần trong phase 8 |
| `GET /api/public/orders?customer_token=` | **KHÔNG cần** | UI-SPEC tự ghi: "`/history` trong phase 8 chỉ cần tồn tại và không 404" + "hiện empty state cơ bản" — nghĩa là route `/history` render tĩnh, không cần gọi BE. Autofill checkout (M2.D-12) dùng dữ liệu đã lưu thẳng trong localStorage sau lần submit trước, không cần list-query |
| `PATCH` / `DELETE /api/public/orders/:token` | **KHÔNG cần** | Sửa/huỷ đơn thuộc luồng sau khi đã CONFIRMED/WAITING dài hạn — không có trong 5 success criteria của ROADMAP phase 8 |

**Vì sao đáng làm rõ:** xây `/api/public/session` + `/api/public/events` + bảng `site_events` trong
phase 8 là công sức bỏ ra cho REQ-P chưa tới lượt — đúng kiểu "xây ống nước cho ngôi nhà chưa thiết
kế xong". Việc autofill dùng localStorage trực tiếp (lưu `{customer_name, customer_phone,
customer_address}` sau mỗi lần submit thành công, không chỉ token) đơn giản hơn, khớp triết lý D-01
"0 dependency mới, tự lo hết ở client".

### System Architecture Diagram

```
┌─────────────┐   GET /api/public/store   ┌──────────────────────────┐
│             │ ─────────────────────────▶│  PublicController         │
│ apps/shop   │   GET /api/public/menu    │  (module public mới hoặc  │
│ (SPA, no    │ ─────────────────────────▶│   mở rộng module hiện có) │
│  SSR)       │                            │                          │
│             │   POST /api/public/orders  │  1. evaluateOrderingStatus (pure fn)
│             │ ─────────────────────────▶│     → 409 ONLINE_ORDERING_DISABLED / STORE_CLOSED
│ localStorage│                            │  2. isPhoneBlacklisted(phone)
│  - customer_│                            │     → 409 PHONE_BLACKLISTED
│    token    │                            │  3. countRecentRequests(phone, window)
│  - cart     │                            │     → 429 TOO_MANY_REQUESTS
│  - last     │                            │  4. hasOpenOrderForPhone(phone) [gap-lock]
│    order_   │                            │     → 409 ORDER_ALREADY_OPEN_FOR_PHONE
│    token    │                            │  5. lookup từng menu_item_id, check is_active +
└──────┬──────┘                            │     !is_out_of_stock, LẤY GIÁ TỪ DB (không tin client)
       │                                    │     → 409 MENU_ITEM_UNAVAILABLE
       │  GET /api/public/orders/:token     │  6. INSERT online_order_requests (items_snapshot
       │◀───────────────────────────────── │     dùng giá vừa lookup, KHÔNG dùng giá client gửi)
       │  (màn xác nhận tối giản)           │  7. trả { order_token }
       │                                    └──────────┬───────────────┘
                                                        │
                                            store_settings (đọc mọi request,
                                            KHÔNG cache lâu — công tắc phải
                                            phản ánh ngay)
                                                        │
┌─────────────┐   PUT /api/admin/settings  ┌────────────▼─────────────┐
│ apps/web    │ ─────────────────────────▶│  AuditInterceptor ghi log │
│ Dashboard + │   POST/DELETE              │  mọi lần đổi settings     │
│ /admin/     │   /api/admin/phone-        └───────────────────────────┘
│ settings    │   blacklist
└─────────────┘
```

### Recommended Project Structure (phần mới của phase 8)

```
apps/api/src/modules/
├── public/
│   ├── public.controller.ts        # ĐÃ CÓ (health) — thêm store, menu, orders vào đây HOẶC
│   │                                # tách controller riêng cùng module, giữ nguyên khuôn mẫu apiOk()
│   ├── store-status.ts             # pure fn: evaluateOrderingStatus(), expandToWeek(), collapseToDefaultExceptions()
│   ├── haversine.ts                # pure fn: haversineKm(), applyDistanceFactor()
│   ├── ip-hash.ts                  # pure fn: hashIp(ip, salt)
│   ├── order-guard.ts              # pure fn: quyết định error code theo thứ tự spec §7 (nhận booleans, KHÔNG tự query DB)
│   ├── *.test.ts                   # vitest zero-config cho từng file trên
│   └── public.module.ts
├── admin/
│   ├── settings.controller.ts      # GET/PUT /admin/settings (khuyến nghị BỎ prefix /api — xem Pitfall)
│   ├── phone-blacklist.controller.ts
│   └── ...
apps/shop/src/
├── main.tsx                        # BrowserRouter + AppShell (xoá BrandPreview khỏi mount)
├── lib/
│   ├── use-api.ts                  # hook fetch thuần D-01
│   ├── customer-token.ts           # sinh + đọc customer_token 100% client-side
│   └── cart-store.ts               # localStorage cart + đồng bộ D-07
├── components/AppShell.tsx, Header.tsx, CategoryRail.tsx, BannerNotice.tsx, ...
packages/schemas/src/
├── public-store.ts                 # PublicStoreStatus schema
├── public-menu.ts                  # PublicMenuItem, PublicMenuGroup (chỉ 7 field theo M2.D-43)
├── public-orders.ts                # OnlineOrderSubmit, PublicOrderStatus
```

### Pattern 1: Công tắc tính-lúc-đọc (D-17) — pure function không cần DB để test

**What:** Toàn bộ logic "đang nhận đơn hay không" gói trong 1 hàm thuần nhận settings đã đọc + `now`,
trả kết luận. KHÔNG mutate settings khi tự động hết hạn (không ghi lại DB, không audit log cho lần
tự-động-ON) — đúng nghĩa "tính lúc đọc" của D-17.

**When to use:** Mọi nơi cần biết "có nhận đơn không" — `GET /api/public/store`, guard của
`POST /api/public/orders`, và widget Dashboard `apps/web` — TẤT CẢ gọi cùng 1 hàm (qua BE), không có
2 nơi tự tính riêng rồi lệch nhau.

**Múi giờ:** Việt Nam dùng ICT (UTC+7) **cố định quanh năm, không có giờ mùa hè** từ 1975 tới nay
[CITED: nhiều nguồn độc lập đồng thuận — Wikipedia "Time in Vietnam", worlddata.info — xác nhận qua
WebSearch phiên này]. Nghĩa là **không cần thư viện timezone** (`date-fns-tz`, `luxon`, dayjs-tz
plugin) — cộng offset cố định +7h vào `nowMs` UTC rồi đọc bằng `getUTC*()` là đủ chính xác, không có
rủi ro DST như múi giờ Mỹ/Âu.

```typescript
// apps/api/src/modules/public/store-status.ts
// Nguồn: M2.D-17 (Ingest CONTEXT), M2.D-28, M2.D-30 — pure function, KHÔNG import DataSource.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // ICT cố định, không DST — xem Sources

export type OpenHourRule = { dow: 0 | 1 | 2 | 3 | 4 | 5 | 6; from: string; to: string }; // "HH:mm"

export type StoreOrderingSettings = {
  online_ordering_enabled: boolean;
  online_ordering_off_mode: 'MANUAL' | 'UNTIL_TOMORROW';
  online_ordering_off_reason: string;
  online_ordering_off_until_ms: number | null;
  open_hours: OpenHourRule[]; // luôn 7 phần tử khi đọc từ DB (xem expandToWeek)
};

export type OrderingStatus = {
  enabled: boolean;           // kết luận cuối cùng, dùng để cho phép/chặn submit
  is_open_now: boolean;       // riêng phần giờ mở cửa (để FE hiện banner đúng lý do)
  blocking_reason: 'MANUAL_OFF' | 'OUTSIDE_HOURS' | null;
};

export function evaluateOrderingStatus(s: StoreOrderingSettings, nowMs: number): OrderingStatus {
  // 1) Giải quyết manual OFF — bao gồm auto-revert "hết hôm nay" tính lúc đọc, KHÔNG ghi lại DB.
  let manualEnabled = s.online_ordering_enabled;
  if (!manualEnabled && s.online_ordering_off_mode === 'UNTIL_TOMORROW') {
    if (s.online_ordering_off_until_ms !== null && nowMs > s.online_ordering_off_until_ms) {
      manualEnabled = true; // Qua 00:00 → coi như đã bật lại, dù cột DB vẫn ghi false
    }
  }

  // 2) Giờ mở cửa — múi giờ Asia/Ho_Chi_Minh cố định +7, không DST.
  const vnMs = nowMs + VN_OFFSET_MS;
  const vnDate = new Date(vnMs);
  const dow = vnDate.getUTCDay() as OpenHourRule['dow'];
  const minutesNow = vnDate.getUTCHours() * 60 + vnDate.getUTCMinutes();
  const rule = s.open_hours.find((r) => r.dow === dow);
  const isOpenNow = rule ? inRange(minutesNow, rule.from, rule.to) : false;

  // 3) Manual override luôn thắng (M2.D-30): nếu manual OFF thì không cần xét giờ mở cửa nữa.
  if (!manualEnabled) return { enabled: false, is_open_now: isOpenNow, blocking_reason: 'MANUAL_OFF' };
  if (!isOpenNow) return { enabled: false, is_open_now: false, blocking_reason: 'OUTSIDE_HOURS' };
  return { enabled: true, is_open_now: true, blocking_reason: null };
}

function inRange(minutes: number, from: string, to: string): boolean {
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  return minutes >= fh * 60 + fm && minutes < th * 60 + tm;
}
```

**Shape "mặc định + ngoại lệ" cho D-15 (UI), tách khỏi shape lưu DB (spec §schema không đổi):**

```typescript
// UI /admin/settings gửi/nhận shape tiện nhập liệu, BE expand/collapse sang open_hours[7] khi lưu/đọc.
type OpenHoursInput = {
  default: { from: string; to: string };
  exceptions: Array<{ dow: OpenHourRule['dow']; from: string; to: string }>;
};

export function expandToWeek(input: OpenHoursInput): OpenHourRule[] {
  const byDow = new Map(input.exceptions.map((e) => [e.dow, e]));
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    const ex = byDow.get(dow as OpenHourRule['dow']);
    return ex ?? { dow: dow as OpenHourRule['dow'], ...input.default };
  });
}

// Chiều ngược lại (đọc để hiển thị form): dòng nào KHÔNG khớp giá trị phổ biến nhất → thành exception.
export function collapseToDefaultExceptions(rules: OpenHourRule[]): OpenHoursInput {
  const counts = new Map<string, number>();
  for (const r of rules) {
    const key = `${r.from}-${r.to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [mostCommonKey] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [from, to] = mostCommonKey.split('-');
  const exceptions = rules.filter((r) => `${r.from}-${r.to}` !== mostCommonKey);
  return { default: { from, to }, exceptions };
}
```

Cả 4 hàm trên (`evaluateOrderingStatus`, `inRange`, `expandToWeek`, `collapseToDefaultExceptions`)
**không import gì từ TypeORM/DataSource** — test bằng vitest zero-config y hệt
`origin-allowlist.test.ts`, không cần DB. Đây là cách phủ **criterion (b)** của Validation
Architecture mà không cần harness MySQL.

### Pattern 2: Thứ tự kiểm tra khi submit — ĐÃ được spec chốt sẵn, đừng tự nghĩ lại

`docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` §7 (dòng 461-463) [CITED] đã liệt kê đúng thứ tự:

```
ordering_enabled ✓ → is_open_now ✓ → phone not blacklisted ✓ → rate limit ✓
→ no open order for phone ✓ → món còn hàng ✓
```

Map trực tiếp sang error code:
`ONLINE_ORDERING_DISABLED` → `STORE_CLOSED` → `PHONE_BLACKLISTED` → `TOO_MANY_REQUESTS` →
`ORDER_ALREADY_OPEN_FOR_PHONE` → `MENU_ITEM_UNAVAILABLE`.

**Tách "quyết định" khỏi "lấy dữ liệu"** — để phần quyết định test được thuần (không cần DB):

```typescript
// apps/api/src/modules/public/order-guard.ts — pure, nhận kết quả đã fetch sẵn.
export type OrderGuardInput = {
  ordering: { enabled: boolean; is_open_now: boolean; blocking_reason: 'MANUAL_OFF' | 'OUTSIDE_HOURS' | null };
  isBlacklisted: boolean;
  isRateLimited: boolean;
  hasOpenOrder: boolean;
  unavailableItemCodes: string[]; // rỗng nếu tất cả còn hàng
};

export type GuardErrorCode =
  | 'ONLINE_ORDERING_DISABLED' | 'STORE_CLOSED' | 'PHONE_BLACKLISTED'
  | 'TOO_MANY_REQUESTS' | 'ORDER_ALREADY_OPEN_FOR_PHONE' | 'MENU_ITEM_UNAVAILABLE';

export function checkOrderGuard(input: OrderGuardInput): GuardErrorCode | null {
  if (!input.ordering.enabled) {
    return input.ordering.blocking_reason === 'OUTSIDE_HOURS' ? 'STORE_CLOSED' : 'ONLINE_ORDERING_DISABLED';
  }
  if (input.isBlacklisted) return 'PHONE_BLACKLISTED';
  if (input.isRateLimited) return 'TOO_MANY_REQUESTS';
  if (input.hasOpenOrder) return 'ORDER_ALREADY_OPEN_FOR_PHONE';
  if (input.unavailableItemCodes.length > 0) return 'MENU_ITEM_UNAVAILABLE';
  return null;
}
```

Service chỉ có nhiệm vụ: fetch 5 giá trị boolean (mỗi cái 1 query đơn giản) → gọi `checkOrderGuard()`
→ throw đúng exception nếu có code trả về. Toàn bộ NHÁNH LOGIC được test bằng 6 test case thuần
(không DB) bao phủ mọi tổ hợp — đây là cách phủ phần "logic" của **criterion (a) và (c)** mà không
cần MySQL thật.

### Pattern 3: Đảm bảo "1 đơn mở/SĐT" atomic bằng gap lock, không phải race

**Vấn đề:** MySQL không có unique-partial-index (kiểu Postgres `UNIQUE WHERE status='WAITING'`).
2 request submit cùng SĐT gần như đồng thời có thể cùng pass check "chưa có đơn mở" trước khi cả 2
đều insert.

**Giải pháp [CITED: hành vi chuẩn của InnoDB — next-key/gap lock khi `SELECT ... FOR UPDATE` quét
một secondary index không tìm thấy hàng khớp, dưới `REPEATABLE READ` mặc định của MySQL]:** gói toàn
bộ validate + insert trong 1 transaction, và bước check "có đơn mở không" dùng
`SELECT ... FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`.
Vì cột `customer_phone` đã có index riêng, câu `FOR UPDATE` này giữ gap lock trên khoảng đó — 1
transaction thứ 2 cùng SĐT sẽ BỊ CHẶN (không phải đọc thấy dữ liệu cũ) cho tới khi transaction đầu
COMMIT/ROLLBACK, lúc đó nó mới thấy đúng trạng thái mới nhất. Đây là pattern chuẩn "check-then-insert"
trong MySQL, không cần bảng lock phụ hay named lock `GET_LOCK()`.

```typescript
await this.ds.transaction(async (mgr) => {
  const existing = await mgr.query(
    `SELECT id FROM online_order_requests WHERE customer_phone = ? AND status = 'WAITING' FOR UPDATE`,
    [phone],
  );
  if (existing.length > 0) throw new ConflictException({ code: 'ORDER_ALREADY_OPEN_FOR_PHONE', ... });
  // ... check stock, lookup giá, insert — TRONG CÙNG transaction này
});
```

**Khuyến nghị thêm index:** schema hiện tại chỉ có `customer_phone INDEX` đơn (không kèm status).
Nên thêm composite index `(customer_phone, status)` — vừa nhanh hơn cho query trên, vừa cho rate-limit
count-theo-cửa-sổ-thời-gian một index tốt hơn nếu thêm `submitted_at` vào cùng (
`(customer_phone, submitted_at)`). Với `synchronize:true`, thêm `@Index()` decorator trên entity là
đủ, tự áp dụng — không cần migration (C-SCHEMA-07).

### Pattern 4: zod dùng chung 2 chiều — pattern MỚI cho monorepo, không phải "làm theo cái có sẵn"

Đã kiểm tra `apps/web/src/lib/api.ts` + toàn bộ `apps/web/src`: **không có bất kỳ `.parse()` hay
`.safeParse()` nào chạy trên response thật** — `zod` ở `apps/web` chỉ dùng để lấy type
(`z.infer<typeof ErrorEnvelope>`) cho TypeScript, KHÔNG runtime-validate. Vậy D-02 (yêu cầu `apps/shop`
parse thật mọi response) là **hành vi đầu tiên trong repo**, plan phải tự thiết kế từ đầu, không có gì
để "làm theo".

**Đề xuất pattern (đặt trong `packages/schemas`, theo đúng convention file hiện có ở
`packages/schemas/src/menu.ts`/`orders.ts` — 1 file/domain, `z.object` + `z.infer` cùng chỗ):**

```typescript
// packages/schemas/src/public-menu.ts
import { z } from 'zod';

// M2.D-43 — CHỈ 7 field này, không hơn. .strict() ở phía BE (không phải FE) để BẮT LỖI SỚM
// nếu code sau này lỡ spread thêm field nội bộ — build/test sẽ throw ngay, không phải "kỷ luật tay".
export const PublicMenuItem = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  price: z.number().int().nonnegative(),
  unit: z.string(),
  images: z.array(z.string()).max(1), // D-09: map 0..1 từ image_url, chừa chỗ cho nhiều ảnh sau này
  is_out_of_stock: z.boolean(),
});
export type PublicMenuItem = z.infer<typeof PublicMenuItem>;

export const PublicMenuGroup = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  items: z.array(PublicMenuItem),
});
export type PublicMenuGroup = z.infer<typeof PublicMenuGroup>;
```

**BE dùng schema này 2 lần** (không phải 1): (1) mapper function `toPublicMenuItem(entity)` chỉ
whitelist đúng 7 field bằng object literal — KHÔNG spread `...entity`; (2) trước khi trả response,
gọi `PublicMenuItem.strict().array().parse(mapped)` — nếu bước (1) có bug (vd ai đó sửa thành
`{...entity, images}`), bước (2) throw ngay trong dev/test thay vì âm thầm leak field nội bộ (giá
vốn, `created_at`...) ra production. Đây chính là câu trả lời cho "đảm bảo bằng schema chứ không
bằng kỷ luật tay" ở research_focus #5 — **2 lớp**: whitelist thủ công + assert runtime.

**FE (`apps/shop`) dùng lại NGUYÊN schema đó** (`PublicMenuItem.array().parse(json.data.items)`)
sau khi `fetch()` — nếu BE tương lai đổi field mà quên đồng bộ 2 phía (rủi ro thật vì
`synchronize:true`), FE fail loud tại chỗ tải menu thay vì render `undefined`.

**Error envelope:** đã có sẵn `ErrorEnvelope` trong `packages/schemas/src/errors.ts`, và đã xác nhận
đọc `global-exception.filter.ts` — shape response lỗi thật (`{ error: { code, message, request_id,
ts_ms, field_errors? } }`) **khớp hệt** `ErrorEnvelope` — không cần schema lỗi mới, `apps/shop` dùng
lại nguyên cái đang có. Chỉ cần thêm 9 code mới (`ONLINE_ORDERING_DISABLED`, `STORE_CLOSED`,
`PHONE_BLACKLISTED`, `TOO_MANY_REQUESTS`, `ORDER_ALREADY_OPEN_FOR_PHONE`, `ORDER_ALREADY_CONFIRMED`,
`ORDER_TOKEN_NOT_FOUND`, `MENU_ITEM_UNAVAILABLE`, `NO_TABLE_AVAILABLE`) vào `ErrorCode` enum.

### Anti-Patterns to Avoid

- **Tin giá/tên món client gửi lên khi submit:** `OnlineOrderSubmit` DTO chỉ nên nhận
  `{menu_item_id, qty, note}` per dòng — KHÔNG nhận `unit_price`/`name` từ client. BE tự
  `SELECT price, name, is_active, is_out_of_stock FROM menu_item WHERE id IN (...)` rồi mới build
  `items_snapshot`. Nếu DTO nhận giá từ client, một request tay (Postman/curl) có thể tự đặt giá 0đ.
- **Đọc `store_settings.online_ordering_enabled` trực tiếp ở bất kỳ đâu ngoài
  `evaluateOrderingStatus()`:** cột này có thể "false" nhưng thực tế đã tự-ON qua nửa đêm (D-17) —
  đọc thẳng cột sẽ cho kết quả sai. Toàn bộ code (kể cả widget Dashboard `apps/web`) phải đi qua kết
  quả của hàm thuần (qua API), không tự suy luận lại.
- **Sinh `customer_token` ở BE (gọi `/api/public/session`):** không cần thiết cho phase 8 — xem
  "Đề xuất bề mặt API" ở trên.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resize/nén ảnh | Tự viết canvas-resize ở FE trước khi upload | `sharp` ở BE (D-12 đã chốt) | Client-side resize không đáng tin (bypass được), và không giải quyết được ảnh chụp gốc 3-5MB gửi lên nếu khách dùng API trực tiếp |
| Đếm rate-limit theo SĐT | Bảng đếm phụ tự quản lý (increment/reset thủ công) | Query trực tiếp `COUNT(*) FROM online_order_requests WHERE customer_phone=? AND submitted_at >= ?` | Bảng đã tồn tại đúng dữ liệu cần đếm — thêm bảng đếm riêng là 2 nguồn sự thật, dễ lệch khi có lỗi giữa chừng (network fail sau khi tăng bộ đếm nhưng trước khi insert) |
| "1 đơn mở/SĐT" atomic | Named lock `GET_LOCK()` hoặc bảng lock phụ tự chế | `SELECT ... FOR UPDATE` trên chính bảng `online_order_requests` (gap lock chuẩn InnoDB) | Ít code hơn, không cần dọn dẹp lock thủ công, đúng semantics transaction có sẵn |
| Đổi vĩnh viễn khi hết giờ mở cửa/khi OFF-đến-hết-hôm-nay | Cron job kiểm tra định kỳ rồi UPDATE | Hàm thuần tính-lúc-đọc (D-17) | Repo đang có 2 cron chết (theo STATE.md) — thêm cron nghĩa là thêm điểm chết im lặng thứ 3 |
| Parse link Google Maps rút gọn (`maps.app.goo.gl`) | Server tự follow redirect + regex/parse HTML phức tạp | KHÔNG hỗ trợ trong phase 8 — xem Assumptions Log #A3 | Follow-redirect server-side với URL do khách dán = SSRF vector (phải allowlist domain + chặn redirect nội bộ); độ phức tạp cao hơn giá trị mang lại khi input "địa chỉ" + nút "Chia sẻ vị trí" (Geolocation) đã là 2 đường chính |

**Key insight:** Phase này đưa vào transaction/lock/pure-function pattern nhiều hơn các phase trước
(vốn chủ yếu CRUD sau JWT). Đừng tái tạo lại cơ chế đã có (throttler, audit interceptor, origin
allowlist) — MỞ RỘNG chúng (xem Pitfall #1 dưới).

## Common Pitfalls

### Pitfall 1: `CsrfOriginGuard` không phủ `/api/public/*` — lỗ hổng đã có từ trước, phase 8 làm nó có hậu quả thật

**What goes wrong:** Đọc trực tiếp `apps/api/src/common/middleware/csrf-origin.middleware.ts`:
`pathRequiresCheck()` chỉ trả `true` cho path bắt đầu `/admin/` hoặc `/auth/`. `/api/public/orders`
(mutation POST) KHÔNG khớp điều kiện nào → guard bỏ qua hoàn toàn, không kiểm tra Origin/Referer.
**Why it happens:** Guard được viết ở phase 7 khi endpoint public duy nhất là `GET /health` (không
phải mutation nên `MUTATION_METHODS.has()` đã lọc trước đó rồi) — chưa ai cần mở rộng
`pathRequiresCheck()` cho tới khi có mutation endpoint public thật.
**How to avoid:** Thêm nhánh `if (path.startsWith('/api/public/')) return true;` vào
`pathRequiresCheck()` (chỉ áp dụng cho method trong `MUTATION_METHODS`, đã lọc từ đầu hàm `use()`).
Vì `apps/shop` gọi API cùng-origin (`order.quanbalun.site`), request thật từ trình duyệt luôn có
`Origin` header hợp lệ trên `fetch()` với mutation method — không lo chặn nhầm khách thật.
**Warning signs:** Nếu KHÔNG sửa, `curl -X POST https://order.quanbalun.site/api/public/orders` từ
bất kỳ đâu (không set Origin) vẫn qua được guard này — lớp phòng thủ duy nhất còn lại là rate-limit
IP/SĐT (đã có) và blacklist, tức phòng thủ chỉ còn 1 lớp thay vì 2.

### Pitfall 2: `/admin/settings` — prefix `/api/admin` của spec lệch với convention thật của repo

**What goes wrong:** `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` §5.2 ghi prefix
`/api/admin/settings`, `/api/admin/phone-blacklist`. Nhưng đọc code thật:
`apps/api/src/modules/admin/users.controller.ts` dùng `@Controller('admin/users')` — **KHÔNG có**
`/api` phía trước, và toàn bộ admin route hiện có (`/admin/users`, `/admin/audit`) đều vậy.
**Why it happens:** Spec M2 viết prefix mới nhất quán về mặt lý thuyết (`/api/*` cho mọi thứ), nhưng
không đối chiếu lại với convention `/admin/*` không-prefix đã tồn tại từ Milestone 1.
**How to avoid:** Khuyến nghị dùng `@Controller('admin/settings')` /
`@Controller('admin/phone-blacklist')` (KHÔNG thêm `/api`) để nhất quán với sibling routes hiện có —
cả 2 cách đều route đúng vì `apiPrefixes` trong `main.ts` (dùng cho SPA fallback dispatch) đã liệt kê
cả `/api` lẫn `/admin` là prefix API hợp lệ, nên không có khác biệt về mặt hoạt động, chỉ là tính nhất
quán code. Nếu chọn hướng này, ghi 1 dòng vào `OVERRIDE-DEBT.md` (lệch chữ spec §5.2, không lệch hành vi).
**Warning signs:** FE `apps/web` gọi nhầm `/api/admin/settings` trong khi BE chỉ có `/admin/settings`
(hoặc ngược lại) → 404 mọi lúc, dễ bị bỏ qua nếu không test tay ngay khi vừa nối dây.

### Pitfall 3: `AuditInterceptor.deriveActionKind()` không có nhánh cho route mới — vẫn chạy nhưng audit log xấu

**What goes wrong:** `audit.interceptor.ts` có 1 if-chain dài match path cụ thể để đặt tên
`action_kind` đẹp (vd `menu.item_created`). `/admin/settings` (PUT) và `/admin/phone-blacklist`
(POST/DELETE) không khớp nhánh nào → rơi vào fallback `${method}.${path...}` (vd `put.admin_settings`)
— vẫn ghi log được (không mất dữ liệu, M2.D-25 vẫn thoả về mặt "có ghi"), nhưng tên action khó đọc
trong `/admin/audit` so với các entry khác.
**Why it happens:** Interceptor dùng string-match thủ công thay vì decorator — mọi route mới đều
phải "đăng ký" thủ công vào if-chain này.
**How to avoid:** Thêm nhánh tương ứng khi viết settings/blacklist controller:
`if (path === '/admin/settings' && method === 'PUT') return 'settings.updated';`, tương tự cho
blacklist thêm/xoá. Cũng nên thêm vào `extractTargetKind()`.
**Warning signs:** Không phải lỗi chức năng — chỉ là chất lượng audit log kém hơn convention hiện có.

### Pitfall 4: Geolocation API — lỗi thật khác với lý thuyết, và WebView Zalo/Facebook không đọc được bằng code

**What goes wrong:** (1) Safari iOS có bug đã biết: khi user chọn "Deny" ở Settings, gọi
`navigator.permissions.query({name:'geolocation'})` trả `'prompt'` thay vì `'denied'`, nhưng
`getCurrentPosition()` vẫn báo lỗi `PERMISSION_DENIED` — nghĩa là **không dùng Permissions API để
quyết định có hiện nút hay không**, chỉ dựa vào callback lỗi thật của `getCurrentPosition`.
(2) WebView trong app Zalo/Facebook (khách VN hay bấm link đặt hàng từ trong app chat) là WebView tuỳ
biến, có thể chặn Geolocation hoàn toàn bất kể site có HTTPS đúng hay không — không có cách nào phía
web code phát hiện chắc chắn "đang trong WebView nào" để né trước, chỉ có thể xử lý qua đường lỗi
chung.
**Why it happens:** Các nền tảng in-app-browser tự quyết định quyền, không tuân theo spec Geolocation
API tiêu chuẩn của trình duyệt độc lập.
**How to avoid:** Toàn bộ 3 trạng thái lỗi của `getCurrentPosition` error callback
(`PERMISSION_DENIED=1`, `POSITION_UNAVAILABLE=2`, `TIMEOUT=3`) đều dẫn về CÙNG 1 kết quả UX: ẩn/disable
nút "Chia sẻ vị trí" sau khi thử, KHÔNG chặn tiếp tục checkout — vì input "Địa chỉ giao hàng" (text)
đã LUÔN bắt buộc và đủ để submit đơn (D-19/UI-SPEC). Geolocation là tăng cường (chỉ cho biết số km +
ước lượng phí), không phải điều kiện bắt buộc — nên thất bại của nó không chặn luồng chính.
**Warning signs:** Nếu code coi Geolocation là bắt buộc (block nút TIẾP TỤC khi chưa có toạ độ) thì
khách vào từ Zalo/Facebook (tỷ lệ cao ở VN) sẽ không đặt được hàng — đây SẼ là bug nghiêm trọng nếu
lỡ implement sai.

### Pitfall 5: `sharp` — rủi ro build Docker không kiểm được tại máy dev

**What goes wrong:** `sharp` publish binary theo platform qua `optionalDependencies` (biến thể
`@img/sharp-linux-x64`, `@img/sharp-linuxmusl-x64`...). Nếu lockfile được tạo trên máy dev (macOS) mà
không khai `supportedArchitectures`, có rủi ro pnpm không lock đủ biến thể `linux-musl-x64` cần cho
`node:20-alpine` — dẫn tới lỗi "Could not load the sharp module" khi build production, mà máy dev
(không có Docker) không phát hiện được trước khi merge.
**Why it happens:** [CITED: tài liệu chính thức sharp.pixelplumbing.com/install — mục cross-platform]
— npm có bug lịch sử (#4828) về lockfile đa nền tảng; pnpm giải quyết bằng cấu hình
`supportedArchitectures` (repo hiện CHƯA có file `.npmrc` nào khai báo mục này).
**How to avoid:** Thêm vào `.npmrc` (file này hiện không tồn tại, cần tạo mới) trước khi
`pnpm add sharp`:
```
supportedArchitectures[]=current
supportedArchitectures[]=linux
```
Rồi generate lockfile lại. Vì máy dev không Docker (07-UAT.md test 6 đã ghi), việc build thật để xác
nhận sharp chạy được trên alpine **không kiểm được ở phase này** — phải nằm trong deferred UAT giống
các hạng mục Docker/Caddy khác, và cần 1 checkpoint xác nhận thủ công sau khi có máy có Docker hoặc
lên CI/production.
**Warning signs:** `pnpm test`/`typecheck` local đều xanh (vì chúng không build Docker) nhưng lần
deploy đầu tiên sau khi thêm `sharp` mới lộ lỗi — giống hệt kiểu rủi ro đã gặp với `apiPrefixes` (OD-03).

### Pitfall 6: FRIENDLY_VN dict trong `GlobalExceptionFilter` sẽ ghi đè message động nếu thêm code mới vào đó

**What goes wrong:** `global-exception.filter.ts` có dict `FRIENDLY_VN[code]` — nếu code thêm 1 dòng
`ONLINE_ORDERING_DISABLED: 'Quán đang tạm ngưng...'` (tĩnh) vào dict này, dòng 86-87
(`if (FRIENDLY_VN[code]) message = FRIENDLY_VN[code];`) sẽ GHI ĐÈ bất kỳ message động nào exception đã
mang theo (vd `off_reason` + `store_phone` nội suy từ DB) bằng chuỗi tĩnh trong dict.
**Why it happens:** Dict này được thiết kế cho các lỗi có message cố định (auth, validation) —
copywriting table của UI-SPEC cho phase 8 lại cần placeholder động (`{off_reason}`, `{store_phone}`,
`{distance_km}`).
**How to avoid:** KHÔNG thêm 9 code mới của phase 8 vào `FRIENDLY_VN`. Build message hoàn chỉnh
(đã nội suy) ngay tại nơi throw exception trong service, ví dụ:
```typescript
throw new ConflictException({
  code: 'ONLINE_ORDERING_DISABLED',
  message: offReason
    ? `Quán vừa tắt nhận đơn online. ${offReason}`
    : `Quán vừa tắt nhận đơn online. Vui lòng gọi ${storePhone} để đặt trực tiếp.`,
});
```
Vì code không có trong dict, dòng 62 (`message = body.message || ...`) giữ nguyên message đã build.
**Warning signs:** Test thấy banner lỗi hiện đúng câu tĩnh generic thay vì câu có tên lý do/SĐT quán
thật — dấu hiệu dict đã ghi đè.

## Code Examples

### Haversine × hệ số đường thực tế (M2.D-50)

```typescript
// apps/api/src/modules/public/haversine.ts — pure, không phụ thuộc DB.
const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// M2.D-50: nhân hệ số đường thực tế (setting distance_factor, mặc định 1.3)
export function estimatedRoadDistanceKm(straightKm: number, distanceFactor: number): number {
  return Math.round(straightKm * distanceFactor * 100) / 100; // 2 chữ số thập phân, khớp decimal(6,2)
}
```

### Hash IP theo HMAC (M2.D-56) — không dùng hash trần

```typescript
// apps/api/src/modules/public/ip-hash.ts
// KHÔNG dùng sha256(ip) trần: không gian IPv4 chỉ ~4.3 tỷ giá trị, rainbow-table
// tính trước toàn bộ là khả thi trong vài giờ trên máy thường. Bắt buộc HMAC với salt bí mật.
import { createHmac } from 'node:crypto';

export function hashIp(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(ip).digest('hex');
}
```

Theo đúng convention đã có ở `jwt.service.ts:18` (`process.env.JWT_SECRET || 'dev-secret-CHANGE-ME'`),
thêm biến môi trường mới `IP_HASH_SALT` vào `.env.example` với default dev tương tự, salt thật generate
bằng `openssl rand -hex 32` lúc deploy.

### DTO submit — KHÔNG nhận giá/tên từ client

```typescript
// packages/schemas/src/public-orders.ts
export const OnlineOrderItemInput = z.object({
  menu_item_id: z.string().uuid(),
  qty: z.number().int().positive().max(99),
  note: z.string().max(255).optional(),
  // CỐ Ý không có unit_price/name — BE tự lookup, xem Anti-Pattern "đừng tin giá client"
});

export const OnlineOrderSubmit = z.object({
  customer_token: z.string().min(32),
  customer_name: z.string().min(1).max(128),
  customer_phone: z.string().min(9).max(16),
  fulfillment_type: z.enum(['PICKUP', 'DELIVERY']),
  customer_address: z.string().max(255).optional(), // bắt buộc khi DELIVERY — check ở refine
  customer_lat: z.number().min(-90).max(90).optional(),
  customer_lng: z.number().min(-180).max(180).optional(),
  customer_map_link: z.string().max(512).optional(),
  customer_note: z.string().max(500).optional(),
  items: z.array(OnlineOrderItemInput).min(1).max(50),
}).refine(
  (v) => v.fulfillment_type === 'PICKUP' || (v.customer_address && v.customer_address.length > 0),
  { message: 'Địa chỉ giao hàng bắt buộc khi chọn Giao tận nơi', path: ['customer_address'] },
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| sharp cần build native lúc cài (`node-gyp`) | sharp dùng prebuilt binary qua `optionalDependencies` theo platform, không postinstall script | Từ sharp v0.32+ (2023) | Không cần toolchain build C++ trong Docker image nữa — chỉ cần đúng platform trong lockfile |

**Deprecated/outdated:** Không có mục nào trong phạm vi phase 8 dùng pattern đã lỗi thời — đây là
tính năng mới trên stack hiện tại (NestJS 10, React 19, Vite 6).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@nestjs/testing`/`supertest`/`@types/supertest` là package name đúng và pattern e2e test tiêu chuẩn NestJS — dựa trên training data, KHÔNG xác nhận được qua Context7/doc chính thức phiên này (WebFetch tới docs.nestjs.com không trả nội dung đọc được) | Standard Stack, Validation Architecture | Thấp về tên package (đã qua slopcheck OK + `npm view` xác nhận tồn tại + version khớp major hiện có), nhưng NÊN double-check code mẫu chính xác trước khi viết test thật (`Test.createTestingModule({imports:[AppModule]}).compile()` + `app.init()` + `supertest(app.getHttpServer())`) |
| A2 | Số cụ thể cho rate-limit theo SĐT (bao nhiêu đơn / bao nhiêu phút) — spec M2.D-40 chỉ nói "chống spam", không cho số | Pattern 2, Validation Architecture | Nếu chọn ngưỡng quá chặt → chặn nhầm khách thật gọi lại sửa đơn; quá lỏng → không chống được bom đơn thật. Đề xuất mặc định: tối đa 3 request/SĐT/giờ (đếm cả thành công lẫn bị từ chối vì lý do khác ngoài rate-limit) |
| A3 | Không hỗ trợ parse link Google Maps rút gọn (`maps.app.goo.gl`, `goo.gl/maps`) trong phase 8 — chỉ parse được link đã chứa toạ độ dạng `@lat,lng` hoặc `q=lat,lng` ngay trong chuỗi dán vào (client-side regex, không cần gọi BE) | Don't Hand-Roll, Common Pitfalls | Một số khách dán link rút gọn từ app Maps di động (mặc định app Google Maps hay tạo link `maps.app.goo.gl`) sẽ không tự nhận được toạ độ — khách vẫn gõ địa chỉ tay được (không chặn luồng), nhưng trải nghiệm "dán link" kém hơn kỳ vọng nếu chủ quán tưởng nó hoạt động với mọi loại link |
| A4 | `/api/public/session`, `/api/public/events`, `GET /api/public/orders?customer_token=` KHÔNG cần dựng trong phase 8 (dời sang phase 9/10) | Architecture Patterns (Đề xuất bề mặt API) | Nếu đánh giá sai và có success criteria ẩn nào đó của phase 8 thật sự cần các endpoint này (không thấy trong ROADMAP/ REQUIREMENTS đã đọc), sẽ phải bổ sung giữa chừng — rủi ro thấp vì đã đối chiếu cả REQUIREMENTS.md lẫn UI-SPEC, cả hai đều nhất quán với việc bỏ qua |
| A5 | Đặt `/admin/settings`, `/admin/phone-blacklist` KHÔNG có prefix `/api` (lệch chữ spec §5.2, khớp convention thật của repo) | Common Pitfalls #2 | Nếu chủ dự án muốn bám chữ spec tuyệt đối, cần đổi + ghi log khác trong `OVERRIDE-DEBT.md` |
| A6 | Vietnam ICT +07:00 không có giờ mùa hè, ổn định vĩnh viễn — đủ để hard-code offset +7h thay vì dùng thư viện timezone | Pattern 1 | Rất thấp (đã kiểm nhiều nguồn độc lập, và đây là sự kiện địa lý/chính trị ổn định hàng chục năm) — nhưng nếu VN đổi chính sách giờ mùa hè trong tương lai xa, hàm cần sửa lại (không phải rủi ro của phase 8) |

**Nếu bảng trên rỗng:** không áp dụng — có 6 assumption cần biết.

## Open Questions

1. **Ngưỡng rate-limit theo SĐT và theo IP-cho-riêng-endpoint-submit là bao nhiêu?**
   - What we know: M2.D-40 yêu cầu có rate limit nhưng không cho số; D-18 xác nhận đếm trong DB; IP
     global đã có 600/phút (quá lỏng cho riêng endpoint submit, cần `@Throttle` chặt hơn theo D-18).
   - What's unclear: con số cụ thể.
   - Recommendation: mặc định đề xuất — **IP: 10 request/phút cho riêng `POST /api/public/orders`**
     (qua `@Throttle`), **SĐT: tối đa 3 đơn/giờ** (đếm trong `online_order_requests`, không phân biệt
     trạng thái). Cả hai là số dễ chỉnh sau (không hardcode sâu, đặt hằng số ở đầu file service).

2. **Có build-test Docker được trước khi merge phase 8 không, hay chấp nhận deferred UAT như phase 7?**
   - What we know: máy dev không Docker (đã xác nhận, 07-UAT.md test 6). `sharp` là dependency native
     đầu tiên — rủi ro cao hơn các dependency pure-JS trước đó.
   - What's unclear: liệu có máy/CI nào khác trong tổ chức có Docker để test build trước khi phase 8
     coi là "done".
   - Recommendation: nếu không có, thêm 1 mục vào `07-UAT.md`-style deferred UAT ghi rõ "build image
     với sharp chưa test thật", và một checkpoint thủ công bắt buộc trước khi deploy production
     (không chỉ trước merge phase).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Build image chứa `sharp` (native binary) | ✗ (máy dev, đã xác nhận lại — không có `docker` command) | — | Chạy đúng chuỗi lệnh Dockerfile thủ công (đã làm ở phase 7) để build TypeScript/Vite, nhưng KHÔNG chứng minh được sharp cài đúng trên alpine — phải deferred UAT |
| MySQL (local) | Test transaction/gap-lock của Pattern 3 | Không kiểm được trong phiên nghiên cứu này (không chạy lệnh kết nối DB) — theo README bàn giao, máy dev cần MySQL cổng 3306/3307 chạy sẵn | — | Nếu chưa chạy, cần khởi động trước khi viết integration test cho phần lock — xem Validation Architecture |
| slopcheck (Python) | Package Legitimacy Audit | ✓ (cài được qua pip trong phiên này) | 0.6.1 | — |
| npm registry (network) | Xác minh version/age package | ✓ | — | — |

**Missing dependencies with no fallback:**
- Docker — không có cách nào kiểm chứng build image thật trong phase này; phải chấp nhận deferred UAT
  (đã là pattern quen thuộc từ phase 7).

**Missing dependencies with fallback:**
- Không có mục nào khác thiếu có fallback khả thi ngoài Docker.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (zero-config) — `apps/api` đã dùng từ phase 7, không có `vitest.config.*` |
| Config file | none — theo đúng convention `origin-allowlist.test.ts` |
| Quick run command | `cd apps/api && pnpm test -- src/modules/public/store-status.test.ts` (chạy 1 file) |
| Full suite command | `cd apps/api && pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-K (criterion b) | `evaluateOrderingStatus()` đúng cho mọi tổ hợp manual/off_mode/giờ mở cửa, kể cả auto-revert qua 00:00 | unit (pure fn) | `pnpm --filter @order/api test -- store-status.test.ts` | ❌ Wave 0 |
| REQ-K/L (criterion a, phần "BE trả 409") | Gọi thật `POST /api/public/orders` khi `ordering_enabled=false` → HTTP 409 + code đúng | integration (Nest app thật hoặc service+fake-repo, xem quyết định cần chốt) | `pnpm --filter @order/api test -- public-orders.e2e.test.ts` (nếu chọn hướng `@nestjs/testing`) | ❌ Wave 0 |
| REQ-L (criterion c, phần logic) | `checkOrderGuard()` trả đúng error code theo mọi tổ hợp 5 boolean input, đúng thứ tự ưu tiên spec §7 | unit (pure fn) | `pnpm --filter @order/api test -- order-guard.test.ts` | ❌ Wave 0 |
| REQ-L (criterion c, phần DB) | Gap lock ngăn 2 request đồng thời cùng SĐT tạo 2 đơn WAITING | integration (MySQL thật — dùng trực tiếp `DataSource`, không cần bootstrap Nest/HTTP) | `pnpm --filter @order/api test -- open-order-lock.integration.test.ts` | ❌ Wave 0 |
| REQ-L | `hashIp()` không bao giờ trả IP nguyên văn, và đổi salt cho ra hash khác | unit (pure fn) | `pnpm --filter @order/api test -- ip-hash.test.ts` | ❌ Wave 0 |
| REQ-I (criterion d) | `GET /api/public/menu` chỉ trả đúng 7 field, không có field nào khác (giá vốn, `created_at`...) | unit — assert `Object.keys()` của mapper output + `PublicMenuItem.strict().parse()` không throw nhưng input "bẩn" (thêm field giả) thì throw | `pnpm --filter @order/api test -- public-menu-shape.test.ts` | ❌ Wave 0 |
| REQ-K | "OFF đến hết hôm nay" tự ON lại 00:00 — đã phủ bởi test `evaluateOrderingStatus` ở trên (truyền `nowMs` giả lập qua nửa đêm) | unit (pure fn, KHÔNG cần fake timer hệ thống vì hàm nhận `nowMs` làm tham số) | (gộp vào `store-status.test.ts`) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** chạy riêng file test vừa sửa (`pnpm --filter @order/api test -- <file>`)
- **Per wave merge:** `pnpm --filter @order/api test` (full suite) + `pnpm -r typecheck` +
  `sh scripts/check-shop-bundle.sh` (sau khi `pnpm --filter @order/shop build`)
- **Phase gate:** full suite xanh + `curl` tay xác nhận 409 thật trên dev server (bổ sung cho phần
  không tự động hoá được nếu chọn KHÔNG thêm `@nestjs/testing`)

### Wave 0 Gaps

- [ ] `apps/api/src/modules/public/store-status.test.ts` — criterion (b), theo mẫu
      `origin-allowlist.test.ts`
- [ ] `apps/api/src/modules/public/order-guard.test.ts` — phần logic của criterion (a)/(c)
- [ ] `apps/api/src/modules/public/ip-hash.test.ts`
- [ ] `apps/api/src/modules/public/haversine.test.ts`
- [ ] `apps/api/src/modules/public/public-menu-shape.test.ts` — criterion (d)
- [ ] 1 file integration test chạm MySQL thật cho gap-lock (criterion c phần DB) — **quyết định cần
      chốt:** dùng thẳng `DataSource` (nhẹ, không thêm devDependency) hay bootstrap Nest+supertest
      (nặng hơn, chứng minh được cả guard/pipe). Xem "Cần chủ dự án quyết" cuối file.
- Framework install: không cần thêm gì nếu chọn hướng `DataSource` trực tiếp; nếu chọn hướng
  `@nestjs/testing`, chạy `pnpm --filter @order/api add -D @nestjs/testing supertest @types/supertest`

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Không (endpoint public không có auth theo thiết kế — M2.D-09) | — |
| V3 Session Management | Có, dạng nhẹ | `customer_token` là pseudo-session tự sinh client-side, KHÔNG phải JWT/cookie — không mang quyền truy cập dữ liệu người khác (M2.D-10 chốt: mất token = mất lịch sử, không có cơ chế khôi phục bằng SĐT) |
| V4 Access Control | Có | `AdminGuard` hiện có, áp cho `/admin/settings` + `/admin/phone-blacklist` (role admin only, theo đúng pattern `users.controller.ts`) |
| V5 Input Validation | Có | zod (`OnlineOrderSubmit`) ở BE — không chỉ `class-validator` như menu hiện có, vì cần `.refine()` cho điều kiện chéo field (PICKUP/DELIVERY) |
| V6 Cryptography | Có | HMAC-SHA256 cho `ip_hash` (KHÔNG dùng SHA256 trần — xem Pitfall/Code Example), salt qua env var theo convention `JWT_SECRET` hiện có |
| V12 File & Resources | Có | Upload ảnh (D-12): giữ nguyên `ALLOWED_MIMES`/`MAX_FILE_BYTES` đã có ở `menu.controller.ts`, `sharp` decode buffer trong memory (không ghi file gốc chưa xử lý ra đĩa nếu chuyển sang `memoryStorage`) |
| V13 API & Web Service | Có | Xem Pitfall #1 (CSRF-adjacent gap ở `/api/public/*`) — đây là hạng mục ASVS V13 quan trọng nhất phát hiện được trong phase này |

### Known Threat Patterns for public ordering API

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Form auto-submit từ site lạ tới `/api/public/orders` (không cookie nhưng vẫn spam được) | Tampering/DoS | Mở rộng `CsrfOriginGuard` (Pitfall #1) + rate-limit IP/SĐT + blacklist (đã có kế hoạch) |
| Client tự đặt giá 0đ/âm khi submit | Tampering | BE tự lookup giá từ DB tại submit, KHÔNG tin field giá của client (Anti-Pattern đã nêu) |
| Race 2 request cùng SĐT bypass "1 đơn mở" | Tampering (business logic bypass) | Gap lock `FOR UPDATE` trong transaction (Pattern 3) |
| IP thô bị lưu lộ qua log/backup | Information Disclosure | HMAC hash, không lưu IP nguyên văn (M2.D-56, đã có kế hoạch) |
| SSRF nếu tự dựng tính năng "resolve link Maps rút gọn" ở BE | Tampering/SSRF | KHÔNG xây (Assumptions Log A3) — nếu buộc phải làm sau này, bắt buộc allowlist domain (`maps.app.goo.gl`, `goo.gl`, `google.com`) + chặn redirect ra IP nội bộ + timeout ngắn |
| Path traversal qua tên file upload ảnh | Tampering | Đã có sẵn cơ chế an toàn ở `menu.controller.ts` (`randomBytes` + strip ký tự lạ trong extension) — giữ nguyên khi thêm bước sharp, không đổi cách đặt tên file |

## Sources

### Primary (HIGH confidence)
- Đọc trực tiếp mã nguồn repo: `csrf-origin.middleware.ts`, `origin-allowlist.test.ts`,
  `public.controller.ts`, `global-exception.filter.ts`, `audit.interceptor.ts`, `menu.controller.ts`,
  `menu-item.entity.ts`, `app.module.ts`, `main.ts`, `App.tsx`, `DashboardPage.tsx`,
  `MenuManagementPage.tsx`, `tokens.css`, `packages/schemas/src/*.ts`, `apps/web/src/lib/api.ts`,
  `Dockerfile`, `pnpm-workspace.yaml`, `package.json` (root + api + web + shop + schemas)
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` — §4 schema, §5 endpoints, §6 thuật toán %, §7 luồng
  xác nhận, §checklist nghiệm thu, M2.D-08..71
- `.planning/phases/08-.../08-CONTEXT.md`, `08-UI-SPEC.md`, `.planning/ROADMAP.md`,
  `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `OVERRIDE-DEBT.md`
- `npm view sharp version/engines/scripts` — 0.35.3, node>=20.9.0, không postinstall script
- `slopcheck scan --pkg npm <tên>` — 5 package đều `OK`

### Secondary (MEDIUM confidence)
- [sharp.pixelplumbing.com/install](https://sharp.pixelplumbing.com/install/) — cross-platform pnpm
  `supportedArchitectures`, yêu cầu Node ≥20.9.0 (qua WebFetch, đọc được nội dung)
- Wikipedia "Time in Vietnam" + worlddata.info — ICT +07:00 cố định, không DST (2 nguồn đồng thuận)
- MySQL InnoDB gap-lock behavior dưới `SELECT ... FOR UPDATE` — kiến thức chuẩn về locking, không
  fetch được trang doc chính thức MySQL phiên này nhưng là hành vi được ghi nhận rộng rãi, nhất quán
  giữa nhiều nguồn

### Tertiary (LOW confidence — cần validate thêm)
- `@nestjs/testing`/`supertest` pattern e2e chính xác — WebFetch tới docs.nestjs.com thất bại (trang
  không trả nội dung đọc được), giữ ở mức [ASSUMED] theo training knowledge
- Jimp/jSquash làm alternative cho sharp — nguồn tham khảo gồm cả site dạng "guide 2026" chất lượng
  không rõ ràng (hirenodejs.com, pkgpulse.com) — chỉ dùng để xác nhận xu hướng chung (sharp vẫn là lựa
  chọn mặc định), không dùng số liệu hiệu năng cụ thể từ các site này
- Chi tiết hành vi Geolocation API trong WebView Zalo cụ thể — không tìm được tài liệu chính thức từ
  Zalo, suy luận từ pattern chung của in-app browser (Facebook/Instagram WebView) đã có nhiều báo cáo
  tương tự

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM-HIGH — sharp/zod xác nhận chắc; @nestjs/testing/supertest chỉ ASSUMED (tên
  package, chưa xác nhận pattern chính xác qua doc chính thức)
- Architecture: HIGH — toàn bộ dựa trên đọc code thật trong repo (guard, filter, interceptor, entity)
- Pitfalls: HIGH cho 3 pitfall đầu (đọc trực tiếp code, không suy đoán); MEDIUM cho Geolocation/sharp
  Docker (dựa trên nguồn thứ cấp + không kiểm chứng được tại chỗ do thiếu Docker)

**Research date:** 2026-07-30
**Valid until:** ~30 ngày cho phần kiến trúc/pattern (ổn định); phần version package nên re-verify nếu
thi công cách ngày nghiên cứu này > 2 tuần

---

## Cần chủ dự án quyết trước khi execute — (RESOLVED 2026-07-30)

**Cả 6 mục đã được chốt trong phiên `/gsd:plan-phase 8` ngày 2026-07-30, TRƯỚC khi planner chạy.**
Kết quả: chủ dự án chọn **đúng đề xuất mặc định** cho mục 1, 5, 6; 3 mục còn lại (2, 3, 4) do
orchestrator quyết theo đề xuất mặc định vì thuần kỹ thuật. Không còn mục nào treo.

| # | Chốt | Ghi ở đâu |
|---|------|-----------|
| 1 | IP **10 req/phút** riêng `POST /api/public/orders`, SĐT **3 đơn/giờ** | `08-10-PLAN.md` (`@Throttle({limit:10, ttl:60_000})`, `PHONE_MAX_ORDERS_PER_WINDOW=3`) |
| 2 | Hướng nhẹ — fake-repository, **0 devDependency mới** cho `apps/api`; phần HTTP thật là Manual-Only bằng `curl` | `08-VALIDATION.md` §Test Infrastructure + §Manual-Only |
| 3 | `sharp`/Docker: **deferred UAT**, nhưng là gate **BẮT BUỘC trước khi deploy production** (không chỉ trước khi đóng phase) | `08-13-PLAN.md` + `08-VALIDATION.md` §Manual-Only |
| 4 | Prefix **`/admin/settings`** và **`/admin/phone-blacklist`** (không `/api`) — khớp convention repo | `08-05-PLAN.md`; ghi `OVERRIDE-DEBT.md` OD-08 qua `08-13-PLAN.md` |
| 5 | Link Maps: **chỉ link đã chứa toạ độ**, regex client-side, không gọi BE (tránh SSRF) | `08-12-PLAN.md` Task 1 (`parseMapsLink` → `SHORT_LINK` cho `maps.app.goo.gl`) |
| 6 | **Bỏ** `/api/public/session`, `/api/public/events`, `GET /api/public/orders?customer_token=` khỏi phase 8 → phase 9/10. `/history` render tĩnh không gọi BE | `08-11-PLAN.md` (acceptance criteria: `grep useApi\|fetch = 0`) |

<details>
<summary>Nội dung gốc của 6 câu hỏi (giữ để truy vết)</summary>

Không có tool hỏi trực tiếp trong phiên nghiên cứu này. Các điểm dưới đây cần xác nhận trước khi
planner khoá kế hoạch — mỗi mục kèm đề xuất mặc định của người nghiên cứu:

1. **Ngưỡng rate-limit cụ thể (Open Question #1).**
   Đề xuất mặc định: IP 10 req/phút riêng cho `POST /api/public/orders`, SĐT tối đa 3 đơn/giờ.

2. **Harness test cho phần "BE trả 409 thật qua HTTP" (criterion a) — thêm `@nestjs/testing` +
   `supertest` (nặng hơn, chứng minh cả guard/pipe) hay chỉ test service với fake-repository (nhẹ
   hơn, khớp triết lý tối giản đã có, nhưng để phần "curl tay" như spec tự ghi ở §checklist)?**
   Đề xuất mặc định: đi hướng nhẹ (fake-repository cho phần logic + `curl` tay cho phần HTTP thật ở
   dev server trước khi coi phase gate là đạt) — tránh thêm 3 devDependency mới mà giá trị tăng thêm
   (chứng minh guard/pipe) không cao so với rủi ro/effort trong 1 phase đã nhiều việc.

3. **Có build-test Docker image (chứa `sharp`) được trước khi merge, hay chấp nhận deferred UAT như
   phase 7 (Open Question #2)?**
   Đề xuất mặc định: chấp nhận deferred UAT, thêm checkpoint thủ công bắt buộc trước khi deploy
   production thật (không chỉ trước khi đóng phase).

4. **Prefix route admin mới: `/admin/settings` (khớp convention repo, lệch chữ spec) hay
   `/api/admin/settings` (khớp chữ spec, lệch convention repo) — Pitfall #2.**
   Đề xuất mặc định: `/admin/settings` (không `/api`), ghi 1 dòng vào `OVERRIDE-DEBT.md`.

5. **Mức độ hỗ trợ "dán link Google Maps" — chỉ link đã chứa toạ độ trực tiếp (không hỗ trợ link rút
   gọn `maps.app.goo.gl`), hay chấp nhận đầu tư thêm để resolve redirect server-side (kèm rủi ro
   SSRF phải phòng)?**
   Đề xuất mặc định: chỉ hỗ trợ link đã chứa toạ độ (client-side regex, không gọi BE) — vì input địa
   chỉ tay + nút Geolocation đã đủ cho luồng chính, không chặn khách nào.

6. **Có bỏ hẳn `/api/public/session`, `/api/public/events`,
   `GET /api/public/orders?customer_token=` khỏi phạm vi phase 8 như đề xuất, dời sang phase 9/10?**
   Đề xuất mặc định: đồng ý bỏ — đã đối chiếu REQUIREMENTS.md + UI-SPEC, cả hai nhất quán với việc
   `/history` phase 8 chỉ cần render tĩnh không gọi BE.

</details>

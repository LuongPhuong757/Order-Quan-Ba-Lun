# Phase 8: Menu công khai, Checkout & Công tắc nhận đơn - Context

**Gathered:** 2026-07-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Khách xem được menu và gửi được đơn từ điện thoại; quán bật/tắt nhận đơn và chặn được lạm dụng.
Phủ REQ-I (menu công khai), REQ-J (checkout), REQ-K (công tắc nhận đơn + giờ mở cửa), REQ-L (rate limit + blacklist).

**Chạm 3 app** — điểm này thường bị bỏ sót vì `08-UI-SPEC.md` chỉ phủ `apps/shop`:
- `apps/shop` — router + AppShell + 5 trang (menu, giỏ, checkout, `/o/:token` tối giản, `/history` empty state)
- `apps/api` — toàn bộ `/api/public/*` nghiệp vụ, bảng settings, bảng `online_order_requests`, bảng blacklist, anti-abuse, resize ảnh lúc upload
- `apps/web` — widget công tắc ở Dashboard + trang `/admin/settings` mới (giờ mở cửa, `free_ship_km`, tab blacklist)

**KHÔNG thuộc phase này:** hàng chờ duyệt cho admin, tự cấp bàn, đẩy items vào bếp, SSE, thông báo (REQ-M/N/O → phase 9). Nội dung đầy đủ của `/o/:token` và `/history` cũng là phase 9 — phase 8 chỉ cần 2 route đó tồn tại và không 404.

</domain>

<decisions>
## Implementation Decisions

### Lớp dữ liệu `apps/shop`
- **D-01:** Gọi API bằng **`fetch` thuần + hook tự viết** (`useApi` trả `{data, loading, error}` + hàm post). **Không** thêm `axios`, **không** thêm TanStack Query. Lý do: 0 dependency mới, đúng triết lý tự-host đã áp cho font; bundle shop quan trọng vì khách vào bằng 3G. Chấp nhận tự lo retry/cache.
- **D-02:** **Zod parse mọi response** `/api/public/*` qua `@order/schemas`. Lý do: BE đang `synchronize: true` không migration (C-SCHEMA-07) → field đổi âm thầm là rủi ro thật; zod báo lỗi ngay tại chỗ thay vì `undefined` lan xuống render. **Lưu ý cho planner:** `apps/shop/package.json` hiện chỉ depend `@order/schemas`, **chưa có `zod` là direct dependency** — phải thêm.
- **D-03:** Menu **tải 1 lần toàn bộ**, lọc theo nhóm và tìm kiếm đều **client-side**. Lý do: menu 1 quán lẩu chỉ vài chục món; đổi tab và gõ tìm phản hồi tức thì, không spinner, không debounce server. Ô tìm kiếm (REQ-I) là filter trên mảng đã tải, **không** cần endpoint search.
- **D-04:** Lỗi mạng khi tải menu → **banner lỗi tại chỗ + nút "Thử lại"**, giữ nguyên header/wordmark. **Không** error boundary toàn trang, **không** tự retry ngầm.

### Giỏ hàng
- **D-05:** Giỏ lưu ở **localStorage** (cùng chỗ đã lưu `customer_token`, không thêm khái niệm mới). Khách tắt máy mở lại vẫn còn giỏ — đúng hướng G-3.
- **D-06:** Giỏ **hết hạn sau 24 giờ**. Hết hạn → xoá sạch, khách thấy empty state bình thường, không phải đối chiếu giá của dữ liệu quá cũ.
- **D-07:** **Đồng bộ giỏ với menu mới lúc tải trang, có báo rõ:**
  - Giá đổi → cập nhật giá mới + banner *"Giá một vài món đã được cập nhật"*
  - Món hết hàng → **giữ dòng nhưng làm mờ + khoá**, **không tính vào tổng**, và **chặn nút TIẾP TỤC** tới khi khách xoá dòng đó
  - Lý do: khách không bao giờ bất ngờ ở bước cuối. Tuyệt đối **không** im lặng xoá món hay im lặng đổi giá.
- **D-08:** **Không sync giỏ giữa nhiều tab** (không dùng `storage` event). Tab nào ghi sau thắng. Khách mobile gần như không mở 2 tab menu — không đáng thêm đường dữ liệu phải test.

### Ảnh món
- **D-09:** `GET /api/public/menu` trả **`images[]` map 0..1 phần tử** từ `menu_item.image_url` (`image_url` có → `[url]`; `NULL` → `[]`). **Không** đổi schema, **không** đổi UI upload của `apps/web`. Giữ nguyên hợp đồng API mà spec M2.D-43 mô tả nên sau muốn nhiều ảnh thì FE không phải sửa. **Ghi vào `OVERRIDE-DEBT.md`** (lệch giữa spec `images[]` và schema `image_url`).
- **D-10:** Món không có ảnh → **placeholder nền gỗ**: khối `--wood-100` đúng aspect-ratio, giữa là tên món chữ `--wood-700` + icon bát SVG đơn giản. **Không** ẩn vùng ảnh (lưới sẽ so le), **không** dùng 1 ảnh mặc định chung (nhiều món cùng 1 ảnh trông như lỗi dữ liệu).
- **D-11:** Ảnh trong card dùng **`object-fit: cover`** trên khung `aspect-ratio: 4/3` — cắt phần thừa. Ảnh món ăn chủ thể ở giữa nên cắt vẫn ổn; lưới đều, không viền trống.
- **D-12:** **Thêm bước resize + nén lúc admin upload** trong `apps/api` (`menu.controller.ts`, `UPLOAD_DIR = 'uploads/menu'`): resize xuống ~800px + xuất webp. **Đây là scope chủ dự án chủ động duyệt thêm**, không có sẵn trong REQ-I..L. Lý do: ảnh chụp bằng điện thoại 3-5 MB, hiện **không có bước resize nào** trong repo; khách 3G tải màn menu có thể mất 10-30s — đúng điểm rụng khách. Thêm dependency native (`sharp` hoặc tương đương) — planner cân nhắc ảnh hưởng tới Docker image (máy dev không có Docker, xem `07-UAT.md` test 6).

### UI admin (`apps/web`)
- **D-13:** Công tắc ON/OFF: **widget switch ở `DashboardPage` + chi tiết ở trang mới `/admin/settings`**. Dashboard cho tắt trong 1 chạm khi đang bận (hết nguyên liệu giữa giờ cao điểm); chọn kiểu OFF, lý do tạm ngưng, giờ mở cửa, `free_ship_km` đặt ở `/admin/settings`.
- **D-14:** Blacklist SĐT là **tab trong `/admin/settings`**, không phải route riêng. Blacklist là việc làm thỉnh thoảng (M2.D-59: thêm tay), không cần route + mục menu riêng.
- **D-15:** Giờ mở cửa (M2.D-30) nhập theo dạng **mặc định chung + ngoại lệ theo thứ**: 1 dòng "mở 10:00-22:00 mọi ngày" rồi chỉ thêm ngoại lệ cho thứ khác biệt. Không phải form 7 dòng đầy đủ — nhập 7 lần cùng một con số dễ sai 1 dòng mà không ai phát hiện.
- **D-16:** Trang `/admin/settings` **theo đúng pattern hiện có của `apps/web`** (giống `AdminUsersPage` / `AdminAuditPage`, kể cả màu hardcode). **Không** tạo `tokens.css` cho `apps/web` trong phase 8 — refactor 12 trang admin đang chạy production là phase riêng, không gánh giữa phase 8. Route mới nằm dưới `RoleGate allow={['admin']}` như `/admin/users`, `/admin/audit`.

### Công tắc & anti-abuse (cơ chế)
- **D-17:** **"OFF đến hết hôm nay" (M2.D-28) tính lúc đọc, KHÔNG dùng cron.** Lưu `off_until` = 23:59:59 hôm nay (Asia/Ho_Chi_Minh); mỗi lần đọc trạng thái thì so với giờ hiện tại — qua 00:00 tự động ON. Lý do: sống sót qua restart container và mất điện VPS; repo đang có 2 cron chết (xem STATE.md) nên thêm cron là thêm điểm chết im lặng. **Dùng cùng cơ chế tính-lúc-đọc luôn cho "ngoài giờ mở cửa" (M2.D-30)**, manual override thắng.
- **D-18:** **Rate limit theo SĐT (M2.D-40) đếm trong DB**, không dùng throttler in-memory, không thêm Redis. Đếm số đơn của SĐT trong `online_order_requests` theo cửa sổ thời gian — đã phải truy bảng này để check "1 đơn mở/SĐT" nên không thêm hạ tầng. Lý do: chống bom đơn mà bộ đếm reset khi restart là vô nghĩa. **Rate limit theo IP giữ nguyên `@nestjs/throttler` global 600 req/phút đã có từ phase 7**, thêm `@Throttle` chặt hơn cho riêng endpoint submit (P08.D-61).

### Xác nhận 3 giả định của `08-UI-SPEC.md`
- **D-19:** Card "Nhận hàng" (PICKUP/DELIVERY + địa chỉ + chia sẻ vị trí) **nằm ở bước 2 `/checkout`** — giữ như UI-SPEC đề xuất. Hệ quả đã chấp nhận: dòng "Phí giao hàng" ở bước 1 `/cart` ghi *"Chọn phương thức nhận hàng ở bước sau để xem phí ship"*.
- **D-20:** Khi OFF / ngoài giờ: **nút `+` thêm món vẫn bấm được**, chỉ nút "ĐẶT HÀNG" ở bước 2 bị khoá. Khách vẫn xây được giỏ để biết tổng tiền rồi gọi điện đặt — đúng tinh thần M2.D-26. Chấp nhận: khách có thể xây giỏ xong mới biết không gửi được (banner đã hiện từ trang menu nên không bất ngờ).
- **D-21:** Copy lỗi `PHONE_BLACKLISTED` giữ **tông trung tính**, không nói "bị chặn"/"blacklist" — giữ đúng bảng Copywriting trong UI-SPEC. Lý do: không khiêu khích người bom đơn đổi số, và không oan cho khách bị thêm nhầm.
- **D-22:** 7 giả định còn lại của UI-SPEC (#2 không dùng package icon, #5 nhãn "ĐẶT HÀNG", #6 nhãn "Đến lấy tại quán"/"Giao tận nơi", #7 thiết kế ô tìm kiếm, #8 header 2 biến thể bằng CSS media query, #9 giỏ hàng nổi mobile-only, #10 Tool: none) **giữ nguyên như UI-SPEC** — không bàn lại.

### Claude's Discretion
Chủ dự án không chốt các điểm sau — planner/executor tự quyết theo spec và pattern có sẵn:
- Cách chia phase 8 thành các plan (BE trước rồi FE, hay slice dọc theo từng luồng). Gợi ý: việc dựng router + AppShell là **task đầu tiên**, vì 4 trang hiện là dead code không được import ở đâu (xem Blockers trong STATE.md).
- Tên bảng / tên cột cụ thể, tên module Nest, hình dạng DTO — spec §schema đã mô tả `online_order_requests`, bảng settings, bảng blacklist ở `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md`; theo đó.
- Cách hash IP cụ thể (M2.D-56) — miễn không lưu IP thô.
- Chọn bao nhiêu test và test cái gì, miễn phủ 4 criteria đã LOCKED cần test tự động (C-TEST-01). Harness `vitest` zero-config đã dựng ở phase 7 (`apps/api/src/common/origin-allowlist.test.ts` là mẫu duy nhất hiện có).
- Thư viện resize ảnh cụ thể cho D-12.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hợp đồng thiết kế & thương hiệu (đọc trước khi viết bất kỳ UI nào)
- `.planning/phases/08-menu-c-ng-khai-checkout-c-ng-t-c-nh-n-n/08-UI-SPEC.md` — hợp đồng thị giác + copywriting đầy đủ của `apps/shop`: spacing, typography, màu, 8 mã lỗi, kiến trúc từng màn, AppShell/router. Đã qua `gsd-ui-checker` (4 PASS / 2 FLAG không chặn). **Không phủ `apps/web`.**
- `apps/shop/src/styles/tokens.css` — **NGUỒN SỰ THẬT DUY NHẤT** về màu/chữ/khoảng cách của `apps/shop` (C-UI-01). Không hardcode hex hay px trong `.tsx`. Đọc kỹ ghi chú tương phản: `--wood-400/500` chỉ trang trí, không dùng cho chữ.
- `apps/shop/DESIGN.md` — design system `apps/shop` (`components.card-item`, `components.banner-notice`). ⚠ **Đang lệch `tokens.css`**: frontmatter `cat-1..7` còn bộ pastel lạnh cũ trong khi `tokens.css` đã đổi sang pastel ấm. Đồng bộ trước khi chạy `impeccable detect`.
- `apps/shop/src/components/Wordmark.tsx` — logo wordmark đã chốt (2 biến thể `plaque`/`bare`) + khuôn mẫu viết component (`CSSProperties` đọc `var(--...)`).
- `docs/design-refs/lotteria/README.md` — đặc tả rút từ ảnh ref Lotteria + **mục "Lệch có chủ ý so với Lotteria (đã chốt)"** + CONFLICT-DESIGN-01.

### Spec nghiệp vụ (nguồn của mọi mã M2.D-*)
- `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` — spec milestone 2. Các mục cần đọc cho phase 8:
  - §8-bis "Đặc tả giao diện trang khách" (dòng ~189-204) — bản gốc; **2 chỗ đã bị override**: 3 màu (OD-04) và số cột mobile (OD-05)
  - Bảng M2.D-08..16 (menu công khai, customer_token, PICKUP/DELIVERY)
  - Bảng M2.D-25..31 (công tắc, 2 kiểu OFF, ngoài giờ, đơn đang chạy không bị ảnh hưởng)
  - Bảng M2.D-40..43 (rate limit, snapshot giá, không leak field nội bộ)
  - Bảng M2.D-49..53 (Geolocation, Haversine × 1.3, copy phí ship, `free_ship_km` mặc định 10)
  - M2.D-56 (hash IP), M2.D-58 (COD), M2.D-59 (blacklist thêm tay, ghi đè M2.D-41)
  - §schema (dòng ~252-302, ~341) — `settings` (`free_ship_km`, `distance_factor`), `online_order_requests` (`subtotal`, `ip_hash`), bảng blacklist (`expires_at` NULL = vĩnh viễn), `orders.payment_method`
  - §endpoints (dòng ~381) — `GET /api/public/orders?customer_token=`
  - §checklist nghiệm thu (dòng ~557-569) — 13 mục cho phase 8
  - ⚠ **Dòng 469 stale**: ghi `300s`, M2.D-60 đã ghi đè thành `1800s` (không thuộc phase 8 nhưng đừng copy sai)
- `OVERRIDE-DEBT.md` — OD-04 (bảng màu), OD-05 (1 cột mobile). **Phase 8 phải thêm 1 entry cho D-09** (`images[]` vs `image_url`).
- `.planning/REQUIREMENTS.md` — REQ-I, REQ-J, REQ-K, REQ-L + bảng map requirement → phase.
- `.planning/ROADMAP.md` §Phase 8 — 5 success criteria (what must be TRUE).

### Pattern & ràng buộc từ phase 7 (bắt buộc dùng lại, không tự phát minh)
- `apps/api/src/modules/public/public.controller.ts` — **khuôn mẫu bắt buộc cho mọi route `/api/public/*`**: success = `apiOk()` từ `@order/utils`, error = giữ shape compact của `GlobalExceptionFilter`. Docblock trong file ghi rõ phase 8 phải dùng lại đúng cặp này.
- `apps/api/src/common/origin-allowlist.ts` + `origin-allowlist.test.ts` — allow-list host, và là **mẫu test duy nhất** trong `apps/api` (hàm thuần + vitest zero-config).
- `apps/api/src/common/middleware/csrf-origin.middleware.ts` — CsrfOriginGuard đã nối allow-list.
- `apps/api/src/main.ts:42-44` — `useStaticAssets` serve `/uploads/` (ảnh món). Dòng 73 `apiPrefixes` — đã sửa ở phase 7, **đừng regress**.
- `.planning/phases/07-shop-infra/07-CONTEXT.md` + `07-04-SUMMARY.md` — phase boundary: 4 trang giữ dạng placeholder, router thuộc phase 8.
- `.planning/phases/07-shop-infra/07-UAT.md` — 7 hạng mục deferred cần VPS thật (DNS, TLS, `Permissions-Policy: geolocation=(self)` — **M2.D-69 quan trọng cho phase 8**: nếu Caddyfile không sửa thì nút "Chia sẻ vị trí" im lặng không chạy trên production).

### Codebase maps
- `.planning/codebase/STACK.md`, `ARCHITECTURE.md`, `CONVENTIONS.md`, `CONCERNS.md` — có sẵn, đọc khi cần bối cảnh rộng.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`apiOk()` / `ApiOk<T>` (`@order/utils`)** — envelope response bắt buộc cho mọi `/api/public/*`.
- **`@nestjs/throttler` ^6.2.0** — đã cài, đã bật global `default` 600 req/phút/IP. Phase 8 chỉ cần `@Throttle` chặt hơn cho endpoint submit; **không cài thêm gì cho rate limit theo IP**.
- **`audit.interceptor`** — đã chạy production; M2.D-25 yêu cầu mọi lần đổi setting ghi audit log → dùng lại, không viết cơ chế log mới.
- **`multer` + `diskStorage` + `UPLOAD_DIR = 'uploads/menu'`** trong `apps/api/src/modules/menu/menu.controller.ts` — điểm chèn bước resize của D-12.
- **`apps/web` — `AdminUsersPage.tsx` / `AdminAuditPage.tsx`** — khuôn mẫu cho `/admin/settings` (bảng + form + `RoleGate allow={['admin']}`).
- **`apps/web` — `MenuManagementPage.tsx`** (dòng ~28, ~270) — chỗ admin upload/hiển thị `image_url`, cần biết khi làm D-12.
- **`apps/shop/src/components/Wordmark.tsx`** — khuôn mẫu component (object style đọc `var(--...)`), dùng ngay ở Header cả 2 biến thể.
- **`apps/shop/src/styles/fonts.css` + `public/fonts/` (12 woff2)** — đã xong, `main.tsx` import trước `tokens.css`. **Đừng sửa `fonts.css` tay** (sinh tự động từ `scratchpad/fetch-fonts.cjs`).
- **`apps/shop/src/pages/{CartPage,CheckoutPage,HistoryPage,OrderTrackPage}.tsx`** — placeholder đã tồn tại, phase 8 điền ruột và nối vào router.

### Established Patterns
- **TypeORM `synchronize: true`, không migration (C-SCHEMA-07)** — thêm cột/bảng mới an toàn, nhưng **rename cột là mất dữ liệu im lặng**. Đặt tên đúng ngay lần đầu.
- **Không `setGlobalPrefix`** — đường dẫn khai ở `@Controller` là đường dẫn đầy đủ (`@Controller('api/public')`).
- **`dateToMsTransformer`** trên các cột datetime của entity — đổi datetime ↔ epoch ms. Entity mới của phase 8 theo đúng convention này.
- **Test = tách hàm thuần + vitest zero-config** (quyết định ingest). Logic tính khoảng cách Haversine × 1.3, logic đánh giá công tắc ON/OFF theo giờ (D-17), logic đếm rate limit — đều nên là hàm thuần để test được không cần DB.
- **`apps/web` hardcode màu rải rác** (`#0f766e`, `#dc2626`, `#1f2937`) — biết là nợ, phase 8 **không trả** (D-16).
- **`apps/shop` không kế thừa design system của `apps/web`** (M2.D-70) — 2 app có mục tiêu ngược nhau.

### Integration Points
- **`apps/shop/src/main.tsx`** — hiện render `<main>` tĩnh với `TODO(task-10)`. Thay bằng `BrowserRouter` + `AppShell`; **bỏ import `BrandPreview.tsx`** khỏi điểm mount (giữ file để tham khảo màu).
- **`apps/api/src/modules/public/public.controller.ts`** — thêm route menu + submit đơn cạnh `health` đã có (hoặc tách module mới nhưng giữ nguyên khuôn mẫu response).
- **`apps/web/src/App.tsx` dòng ~58-63** — thêm `<Route path="/admin/settings">` vào block `RoleGate allow={['admin']}` đã có.
- **`apps/web/src/pages/DashboardPage.tsx`** — chèn widget công tắc.
- **`Caddyfile`** — M2.D-69 yêu cầu site block `order.` dùng `geolocation=(self)`; đây là điều kiện để nút "Chia sẻ vị trí" chạy được trên production. Đã thuộc phase 7 nhưng chưa verify được (không có `caddy` CLI trên máy dev) → nằm trong `07-UAT.md`.
- **`packages/schemas`** — nơi đặt zod schema dùng chung 2 chiều cho D-02.
- **`scripts/check-shop-bundle.sh`** — bundle guard từ phase 7; M2.D-64 chỉ có giá trị thật từ phase 8 khi bundle đã có route. Kiểm ngưỡng sau khi thêm zod + router.

</code_context>

<specifics>
## Specific Ideas

- **Copy khi giỏ bị đồng bộ lại** (D-07): banner *"Giá một vài món đã được cập nhật"* — chủ động thông báo, tuyệt đối không im lặng.
- **Placeholder ảnh** (D-10): nền `--wood-100`, tên món chữ `--wood-700`, icon bát SVG tự vẽ — phải trông có chủ ý, không được giống ảnh lỗi.
- **Widget công tắc ở Dashboard** (D-13): tiêu chí là **tắt được trong 1 chạm** — tình huống thật là hết nguyên liệu giữa giờ cao điểm, chủ quán không có thời gian điều hướng 3 bước.
- **Form giờ mở cửa** (D-15): mặc định 1 dòng cho cả tuần, ngoại lệ chỉ thêm khi cần — đúng cách quán ăn thật hoạt động.
- **Ô tìm kiếm** không có trong ảnh ref Lotteria — thiết kế theo mục "Ô tìm kiếm" trong `08-UI-SPEC.md` (desktop input inline, mobile overlay từ icon kính lúp).

</specifics>

<deferred>
## Deferred Ideas

- **Nhiều ảnh thật cho 1 món** (bảng `menu_item_images` + sửa UI upload `apps/web`) — không có trong REQ-I..L, và card món trong UI-SPEC chỉ vẽ 1 ảnh. Hợp đồng API `images[]` (D-09) đã để sẵn chỗ nên sau làm không phải sửa FE.
- **`tokens.css` cho `apps/web`** — trả nợ hardcode màu của 12 trang admin đang chạy production. Là refactor riêng, rủi ro cao, không gánh giữa phase 8 (D-16).
- **Sync giỏ hàng giữa nhiều tab** qua `storage` event (D-08) — làm khi có bằng chứng khách thật dùng desktop nhiều tab.
- **Đồng bộ `apps/shop/DESIGN.md` với `tokens.css`** (`cat-1..7` còn pastel lạnh cũ) — do `gsd-ui-checker` phát hiện, là drift có sẵn trong repo chứ không do phase 8 gây ra. Nên xử lý trước khi chạy `impeccable detect` cuối phase; nếu không muốn gánh vào phase 8 thì ghi thành todo.
- **Thanh toán online VietQR/chuyển khoản** — đã deferred sang v2 (M2.D-58 chốt COD), cột `orders.payment_method` để sẵn chỗ.

</deferred>

---

*Phase: 8-Menu công khai, Checkout & Công tắc nhận đơn*
*Context gathered: 2026-07-30*

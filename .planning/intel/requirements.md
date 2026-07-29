# Requirements (PRD-layer, extracted from SPEC §3 + §8 + §9)

> Source doc: `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` (SPEC, precedence 0)
> `REQ-A..H` belong to Milestone 1 and are NOT in scope here. Milestone 2 = `REQ-Q, I, J, K, L, M, N, O, P`.
> Acceptance criteria below are lifted from spec §9 phase success criteria (lines 541–620), each mapped
> back to the REQ that owns it. Original AC IDs (`AC-Q1..AC-P5`) lived in the deleted `.vg/REQUIREMENTS.md`
> and are **not recoverable from disk** — see WARNING in `.planning/INGEST-CONFLICTS.md`.
>
> **Deferred-UAT marker:** criteria tagged `[PROD-UAT]` cannot be verified locally (need DNS/Caddy/real
> hostnames). Per user mandate all Milestone 2 work is LOCAL ONLY — see `constraints.md` C-LOCAL-01.
> They must be carried as deferred acceptance, not as in-phase blockers.

---

## REQ-Q — Shop Infra

- source: `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md:214`
- category: Shop Infra · priority: must-have · phase: 07
- decisions: M2.D-64, M2.D-65, M2.D-66, M2.D-67, M2.D-68, M2.D-69
- description: Tách frontend trang khách thành app riêng `apps/shop` trên subdomain `order.<domain>`, dùng chung 1 API + 1 DB.

Acceptance criteria (reconstructed from spec §12 checklist lines 679–686 + §9 line 546 + infra criteria mis-filed under Phase 08 at lines 571–575):
- [ ] `apps/shop` — Vite + React mới, dùng chung `packages/schemas` — **DONE** (spec:659; verified in codebase: `apps/shop/src/pages/{Cart,Checkout,History,OrderTrack}Page.tsx`)
- [ ] `GET /api/public/health` tồn tại — **DONE** (verified: `apps/api/src/modules/public/public.controller.ts:48`)
- [ ] `Dockerfile`: build thêm `apps/shop` → `shop-dist` — **NOT DONE** (no `shop` reference in `Dockerfile`)
- [ ] `main.ts`: chọn thư mục static theo `Host` header (`order.` → `shop-dist`, else `web-dist`) (M2.D-66) — **NOT DONE** (`apps/api/src/main.ts:39` only mounts `web-dist`)
- [ ] `.env.production` / `.env.example`: `ALLOWED_ORIGIN` thành danh sách 2 origin phân tách dấu phẩy (M2.D-67) — **NOT DONE** (`.env.example:25` single value)
- [ ] Caddyfile: site block `order.{$DOMAIN}` với `geolocation=(self)`; site block admin giữ `geolocation=()` (M2.D-69) — **NOT DONE** (`Caddyfile:23` single block, `geolocation=()`)
- [ ] `order.quanbalun.site` trả **shop-dist**, `quanbalun.site` trả **web-dist** — cùng 1 container (M2.D-66) `[PROD-UAT]` (local: verifiable via `Host:` header curl against dev API)
- [ ] Bundle của `order.` **không chứa** route/code trang quản lý — kiểm bằng grep chuỗi `/dashboard`, `/kitchen` trong JS đã build (M2.D-64) — locally verifiable
- [ ] Đăng nhập admin ở apex → cookie `ssp_token` **không** được gửi khi request tới `order.` (M2.D-68) — kiểm bằng DevTools Network `[PROD-UAT]` (needs two real hostnames)
- [ ] Submit đơn từ `order.` **không** bị chặn CSRF; origin lạ vẫn bị chặn (M2.D-67) — locally verifiable via unit test on the middleware
- [ ] Nút "Chia sẻ vị trí" xin quyền và lấy được toạ độ **trên HTTPS production** (M2.D-69) `[PROD-UAT]` (Permissions-Policy only applied by Caddy, not by Vite dev server)
- [ ] DNS A record `order.quanbalun.site` → IP VPS (M2.D-65) `[PROD-UAT]` — out of scope for local-only work

---

## REQ-I — Public Menu

- source: `...SPEC.md:215`
- category: Public Menu · priority: must-have · phase: 08
- decisions: M2.D-08, M2.D-16, M2.D-26, M2.D-31, M2.D-43, M2.D-70, M2.D-71
- description: Trang menu công khai không cần login, mobile-first, ảnh lớn, tab nhóm hàng dính, tìm kiếm, món hết hàng làm mờ (không ẩn), giỏ hàng nổi hiện tổng tiền.
- screens: `/` → **MenuPage** (spec:519)

Acceptance criteria (spec §9 Phase 08):
- [ ] Xem được menu **không cần login**; món hết hàng làm mờ, không ẩn (spec:556 — route ghi `/m` là stale, xem INFO conflict; route đúng là `/` trên `order.<domain>`)
- [ ] Khách xem menu được **trước khi** bị hỏi bất kỳ thông tin cá nhân nào (M2.D-08)
- [ ] Endpoint public không leak field nội bộ (M2.D-43) — `GET /api/public/menu` chỉ trả `id, code, name, price, unit, images[], is_out_of_stock`
- [ ] OFF vẫn xem được menu + hiện banner kèm lý do và SĐT quán (M2.D-26, M2.D-29)
- [ ] UI theo §8-bis: header dính + "Đơn của tôi" thay icon tài khoản, dải danh mục cuộn ngang dính, lưới 4 cột desktop / **2 cột mobile**, giá đỏ ~24px, nút `+` vuông (spec:189–193)
- [ ] Nguồn token màu/kích thước khi code là `apps/shop/src/styles/tokens.css`, KHÔNG phải bảng §8-bis (spec:169–174)

---

## REQ-J — Checkout

- source: `...SPEC.md:216`
- category: Checkout · priority: must-have · phase: 08
- decisions: M2.D-09, M2.D-12, M2.D-13, M2.D-14, M2.D-15, M2.D-42, M2.D-49, M2.D-50, M2.D-51, M2.D-52, M2.D-53, M2.D-58
- description: Checkout 1 trang: họ tên, SĐT, chọn PICKUP/DELIVERY, địa chỉ + chia sẻ vị trí (chỉ khi DELIVERY), ghi chú; autofill từ `customer_token`; snapshot giá.
- screens: `/cart` → **CartPage**, `/checkout` → **CheckoutPage**, `/history` → **MyOrdersPage** (spec:520–523)

Acceptance criteria (spec §9 Phase 08):
- [ ] `customer_token` sinh lần đầu, lưu localStorage vĩnh viễn, autofill lần sau (M2.D-09)
- [ ] Checkout chọn được PICKUP / DELIVERY; PICKUP **không** hỏi địa chỉ (M2.D-15)
- [ ] Nút "Chia sẻ vị trí" trả lat/lng + sinh link Maps; tính được `distance_km` bằng Haversine × 1.3 (M2.D-50) — hệ số đọc từ setting `distance_factor`
- [ ] Có toạ độ → hiện số km + kết luận phí; không có → hiện quy tắc text (M2.D-51). **Không auto-tính tiền** (M2.D-52)
- [ ] Submit tạo `online_order_requests` với `status=WAITING`, `items_snapshot` + `subtotal` **chốt giá** (M2.D-42)
- [ ] Lịch sử đơn theo `customer_token`, PII che một phần `0912***678` (M2.D-12)
- [ ] Stepper 2 bước, bước 2 tên **"Thông tin nhận hàng"** (không phải "Thanh toán", vì không thu tiền online — M2.D-58, spec:197)
- [ ] Card tổng tiền: `Tạm tính` → `Phí giao hàng` → `Tổng cộng`; phí giao hàng theo M2.D-51/52, **tuyệt đối không tự điền số tiền ship** (spec:201)
- [ ] Bỏ card "Tùy chọn" và bỏ checkbox thu thập PII của Lotteria; thay bằng dòng *"Thông tin của bạn chỉ dùng để giao đơn này."* (spec:203–204)

---

## REQ-K — Store Switch

- source: `...SPEC.md:217`
- category: Store Switch · priority: must-have · phase: 08
- decisions: M2.D-25, M2.D-26, M2.D-27, M2.D-28, M2.D-29, M2.D-30, M2.D-31
- description: Công tắc ON/OFF nhận đơn online + giờ mở cửa + lý do tạm ngưng; chặn 2 lớp FE/BE.
- screens: `/admin/settings` → **StoreSettingsPage** (spec:530); Dashboard widget + badge (spec:533)

Acceptance criteria (spec §9 Phase 08):
- [ ] Công tắc OFF: FE khoá nút **và** BE trả `409 ONLINE_ORDERING_DISABLED` (M2.D-27) — test bằng cách gọi API tay
- [ ] "OFF đến hết hôm nay" tự ON lại 00:00 Asia/Ho_Chi_Minh (M2.D-28)
- [ ] Ngoài giờ mở cửa tự chặn đặt; manual override thắng (M2.D-30)
- [ ] Mọi thay đổi setting ghi audit log (M2.D-25) — dùng `AuditInterceptor` có sẵn
- [ ] Đơn đang chạy không bị ảnh hưởng khi OFF (M2.D-31)

---

## REQ-L — Anti-abuse

- source: `...SPEC.md:218`
- category: Anti-abuse · priority: must-have · phase: 08
- decisions: M2.D-40, M2.D-59 (supersedes M2.D-41), M2.D-56
- description: Rate limit IP + SĐT, 1 đơn mở/SĐT, blacklist SĐT thêm/xoá tay.

Acceptance criteria (spec §9 Phase 08):
- [ ] Rate limit IP + SĐT hoạt động; 1 SĐT chỉ 1 đơn mở (M2.D-40) → error `ORDER_ALREADY_OPEN_FOR_PHONE`, `TOO_MANY_REQUESTS`
- [ ] Blacklist SĐT chặn submit (`PHONE_BLACKLISTED`); admin **thêm/xoá tay** được ở `/admin/settings`, bản ghi **không tự hết hạn** (M2.D-59)
- [ ] KHÔNG tạo `cron-blacklist-cleanup.ts` (M2.D-59, spec:507)
- [ ] `ip_hash` lưu dạng hash, không lưu IP thô (M2.D-56)

---

## REQ-M — Approval

- source: `...SPEC.md:219`
- category: Approval · priority: must-have · phase: 09
- decisions: M2.D-01, M2.D-02, M2.D-03, M2.D-04, M2.D-05, M2.D-06, M2.D-14, M2.D-33, M2.D-48, M2.D-58, M2.D-61, M2.D-62
- description: Hàng chờ duyệt cho admin; xác nhận → tự cấp bàn (tự tạo bàn nếu hết) → items vào bếp; từ chối kèm lý do; chỉ role `admin` được duyệt; re-check tồn kho + nhập phí ship.
- screens: `/admin/online-orders` → **OnlineOrdersQueuePage** (spec:529)

Acceptance criteria (spec §9 Phase 09):
- [ ] Hàng chờ duyệt hiện đơn `WAITING` kèm đồng hồ đếm thời gian chờ
- [ ] Role `order` **xem được nhưng không** xác nhận/từ chối được (M2.D-33) — test bằng gọi API trực tiếp
- [ ] Xác nhận → cấp bàn trống đầu tiên theo `code` ASC đúng `kind` (M2.D-04, M2.D-14)
- [ ] Hết bàn → **tự tạo bàn mới** + audit log; khách không bao giờ bị chặn (M2.D-05)
- [ ] 2 admin xác nhận đồng thời **không** cấp trùng bàn (M2.D-06) — test bằng 2 request song song *(requires automated test; see constraints C-TEST-01)*
- [ ] Xác nhận → items chuyển `KITCHEN`, **bếp thấy ngay** trên KitchenPage
- [ ] Đơn `WAITING` **không** xuất hiện ở sơ đồ bàn / bếp / history / doanh thu (M2.D-01) — test đếm doanh thu trước/sau khi có 5 đơn WAITING *(requires automated test; C-TEST-01)*
- [ ] Từ chối bắt buộc lý do; khách thấy lý do + SĐT quán (M2.D-48)
- [ ] Duyệt đơn có món đã hết hàng → hiện cảnh báo, admin tick bỏ món, tracking hiện "N món đã huỷ"; bỏ hết món thì **chặn xác nhận** (M2.D-61) → `MENU_ITEM_UNAVAILABLE`
- [ ] Admin nhập được **phí ship**; tổng thu = tiền món + `ship_fee`; báo cáo ngày tách 2 dòng, doanh thu món **không** gồm phí ship (M2.D-62)
- [ ] Đơn online thanh toán bằng **đúng luồng thanh toán bàn hiện có**; sau thanh toán bàn `SHIP-NN` đóng (`closed_at` + `is_paid`), không còn treo mở (M2.D-58)

---

## REQ-N — Notification

- source: `...SPEC.md:220`
- category: Notification · priority: must-have · phase: 09
- decisions: M2.D-32, M2.D-34, M2.D-35, M2.D-36 (90s SMS only), M2.D-37, M2.D-38, M2.D-39, M2.D-60, M2.D-63
- description: Thông báo 4 lớp (SSE cho admin+order / SMS / Email / leo thang + auto-OFF sau 30 phút) qua adapter `NotificationChannel`.

Acceptance criteria (spec §9 Phase 09):
- [ ] SSE bắn tới **mọi** client role `admin` và `order`, độ trễ < 2s, có chuông + badge (M2.D-32) — events `online_order.new`, `online_order.reviewed`
- [ ] SMS gửi tới `notify_sms_recipients`; Email gửi tới `notify_email_recipients`
- [ ] Đơn WAITING > 90s → SMS bắn (M2.D-36); đã duyệt trước 90s thì **không** bắn
- [ ] Đơn WAITING > **1800s (30 phút)** → **tự động OFF** nhận đơn + audit log actor SYSTEM kèm request_id + khách thấy thông báo gọi quán; **không** tự ON lại (M2.D-60)
- [ ] SMS chạy được với `SMS_DRIVER=console` và `SMS_DRIVER=esms` — đổi driver **không** sửa logic (M2.D-63)
- [ ] SMS/Email đi qua `notification_outbox`, fail thì retry, có log lỗi (M2.D-37)
- [ ] G-2 measure (spec:20): p95 độ trễ thông báo < 5s; tỉ lệ đơn bị bỏ quên > 5 phút = 0
- [ ] Xác nhận/Từ chối → huỷ các outbox L2/L4 còn PENDING của request đó (spec:489, :493)

---

## REQ-O — Order Tracking

- source: `...SPEC.md:221`
- category: Order Tracking · priority: must-have · phase: 09
- decisions: M2.D-11, M2.D-15, M2.D-17..M2.D-24, M2.D-44, M2.D-45, M2.D-46, M2.D-47
- description: Trang `/o/<order_token>`: % trọng số đơn điệu, 5 mốc trạng thái, danh sách món không lộ trạng thái từng món, banner khi quán sửa đơn, nút gọi quán.
- screens: `/o/:token` → **OrderTrackingPage** (spec:522), poll 5–10s

Acceptance criteria (spec §9 Phase 09):
- [ ] `/o/<token>` hiện % **đúng công thức trọng số** §6; % **không bao giờ tụt** (M2.D-19); tối đa 95% khi chưa xong (M2.D-20)
- [ ] PICKUP đạt 100% khi tất cả món `READY`; DELIVERY khi tất cả `SERVED` (M2.D-15)
- [ ] Món huỷ trừ khỏi mẫu số + hiện dòng "1 món đã huỷ — quán sẽ liên hệ bạn" (M2.D-21)
- [ ] Response `/api/public/orders/:token` **không chứa** status từng item (M2.D-23) — **assert trong test** *(requires automated test; C-TEST-01)*
- [ ] Khách sửa/huỷ được khi `WAITING`; sau `CONFIRMED` chỉ hiện SĐT + nút gọi (M2.D-44, M2.D-45) → `ORDER_ALREADY_CONFIRMED`
- [ ] Admin sửa món ở bàn ship → trang khách hiện banner "Quán vừa cập nhật đơn của bạn" + món/tổng tiền mới trong ≤10s (M2.D-47)
- [ ] Không hiện lộ trình / vị trí tài xế (M2.D-24)
- [ ] ETA hiện dạng khoảng, từ setting `eta_pickup_min/max`, `eta_delivery_min/max` (M2.D-22)
- [ ] 5 mốc `stage`: `RECEIVED → CONFIRMED → COOKING → DELIVERING` / `READY_FOR_PICKUP` → `COMPLETED`; `REJECTED` là nhánh riêng (spec:454)

---

## REQ-P — Analytics

- source: `...SPEC.md:222`
- category: Analytics · priority: **should-have** · phase: 10
- decisions: M2.D-38, M2.D-54, M2.D-55, M2.D-56, M2.D-57
- description: Phễu 5 bước + dashboard truy cập/chuyển đổi + email tổng hợp cuối ngày.
- screens: `/admin/analytics` → **AnalyticsPage** (spec:531)

Acceptance criteria (spec §9 Phase 10):
- [ ] `session_id` first-party cookie; 5 event ghi đúng mốc (M2.D-55)
- [ ] IP lưu dạng **hash**, không lưu thô (M2.D-56)
- [ ] Dashboard hiện: khách/ngày, số đơn, tỉ lệ chuyển đổi, bước rơi nhiều nhất, thời gian ở trang
- [ ] Hiện **món xem nhiều nhưng ít đặt** (dấu hiệu ảnh/giá có vấn đề)
- [ ] Hiện **thời gian trung bình admin duyệt đơn** (KPI G-2)
- [ ] Email tổng hợp cuối ngày 23:30 Asia/Ho_Chi_Minh (M2.D-38)
- [ ] Cron dọn `site_events` > 180 ngày

# OrderQuanBaLun

## What This Is

Hệ thống order cho Quán Bà Lùn. Milestone 1 đã giao POS nội bộ (nhân viên gọi món, sơ đồ bàn, bếp, báo cáo ngày). Milestone 2 mở thêm kênh **đặt hàng online cho khách**: web công khai không cần login trên subdomain `order.<domain>`, đơn phải được **admin xác nhận** trước khi vào bếp, khách theo dõi bằng **% tổng** chứ không thấy trạng thái từng món.

## Core Value

Khách đặt được món từ xa mà quán **không bao giờ bỏ lọt đơn**, và đơn chưa duyệt **không bao giờ** lẫn vào bếp / sơ đồ bàn / doanh thu.

## Business Context

- **Customer**: khách ăn của Quán Bà Lùn (gần 100% vào bằng điện thoại) + chủ quán/admin là người duyệt đơn
- **Revenue model**: bán món trực tiếp; thanh toán COD/tại quán (M2.D-58), chưa thu tiền online
- **Success metric**: G-2 — p95 độ trễ thông báo đơn mới < 5s, tỉ lệ đơn bị bỏ quên > 5 phút = **0**
- **Strategy notes**: `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` (SPEC đã chốt vòng 5, 685 dòng)

## Requirements

### Validated

<!-- Milestone 1 — shipped, POS nội bộ đang chạy production -->

- ✓ REQ-A Menu management + bulk import — Milestone 1
- ✓ REQ-B Sơ đồ bàn + chuyển bàn — Milestone 1
- ✓ REQ-C Auth + session — Milestone 1
- ✓ REQ-D/E Vòng đời order + xử lý hết nguyên liệu — Milestone 1
- ✓ REQ-F Auto-close bàn (pending review) — Milestone 1
- ✓ REQ-G Audit log — Milestone 1
- ✓ REQ-H Báo cáo cuối ngày — Milestone 1

### Active

<!-- Milestone 2 — xem .planning/REQUIREMENTS.md để có acceptance criteria đầy đủ -->

- [ ] REQ-Q — Shop Infra: `apps/shop` + subdomain `order.<domain>`, dùng chung 1 API + 1 DB (Phase 7)
- [ ] REQ-I — Public Menu: menu công khai mobile-first, không cần login (Phase 8)
- [ ] REQ-J — Checkout: 1 trang, PICKUP/DELIVERY, chia sẻ vị trí, snapshot giá (Phase 8)
- [ ] REQ-K — Store Switch: công tắc ON/OFF nhận đơn + giờ mở cửa (Phase 8)
- [ ] REQ-L — Anti-abuse: rate limit IP/SĐT, 1 đơn mở/SĐT, blacklist SĐT (Phase 8)
- [ ] REQ-M — Approval: hàng chờ duyệt, xác nhận → tự cấp bàn → vào bếp (Phase 9)
- [ ] REQ-N — Notification: 4 lớp SSE/SMS/Email/leo thang + auto-OFF 30 phút (Phase 9)
- [ ] REQ-O — Order Tracking: `/o/<token>`, % trọng số đơn điệu, 5 mốc (Phase 9)
- [ ] REQ-P — Analytics: phễu 5 bước + dashboard + email tổng hợp (Phase 10, **should-have**)

### Out of Scope

- **Thanh toán online (VietQR/chuyển khoản)** — M2.D-58 chốt COD; cột `payment_method` để ngỏ cho sau
- **Web Push (VAPID) / Telegram bot** — adapter `NotificationChannel` (M2.D-37) cho phép thêm sau bằng 1 file
- **Đo khoảng cách bằng OSRM / Google Distance Matrix** — dùng Haversine × `distance_factor` trước; đổi nếu sai nhiều
- **Voice call ở lớp L5** — chưa cần, SMS + auto-OFF là đủ
- **Auto-tính tiền ship** — M2.D-52 chốt: hệ thống chỉ hiện quy tắc, admin chốt số tiền
- **Lộ trình / vị trí tài xế trên trang khách** — M2.D-24, cố tình không làm
- **Trạng thái từng món trên trang khách** — M2.D-23, vi phạm G-1 (ngoại lệ duy nhất: món bị huỷ **phải** hiện, M2.D-21)
- **`cron-blacklist-cleanup.ts`** — M2.D-59 bỏ, blacklist thêm/xoá tay, không tự hết hạn
- **Migration files** — M2.D-07 + `synchronize: true`, chỉ thêm entity
- **Deploy / đụng VPS production trong Milestone 2** — mandate của chủ dự án, xem C-LOCAL-01

## Context

- **Codebase**: pnpm monorepo, Turborepo. `apps/api` NestJS + TypeORM + MySQL, `apps/web` Vite+React (admin), `apps/shop` Vite+React (khách, mới dựng), `packages/schemas` (Zod) + `packages/utils`. Bản đồ đầy đủ ở `.planning/codebase/` (7 file, map 2026-07-29).
- **Phase 7 mới xong ~1/3**: scaffold `apps/shop` + 4 trang placeholder + `GET /api/public/health` đã có; phần hạ tầng (Host-switch trong `main.ts`, stage `shop` trong `Dockerfile`, `ALLOWED_ORIGIN` dạng list, Caddy block `order.`, DNS) **chưa làm**. Spec dòng 659 ghi "đã xong" là sai.
- **Không có test harness cho API**: cả repo đúng 1 file test (`apps/web/src/lib/menu-search.test.ts`), `apps/api` có vitest nhưng 0 test, không `vitest.config.ts`, không CI. 4 acceptance criteria đã LOCKED lại bắt buộc test tự động → phải coi là **việc phải làm**, không phải giả định có sẵn (C-TEST-01).
- **Chưa có push channel nào**: `OrdersPage`/`KitchenPage` đang `setInterval(2000)` poll; pool MySQL 50 connection được size cho đúng kiểu đó. SSE (M2.D-32) là transport mới, phải thiết kế sao cho không giữ 1 DB connection mỗi subscriber (C-INFRA-01).
- **2 cron hiện có đang chết im**: `cron-audit-retention`, `cron-jti-cleanup` là CLI script không scheduler nào gọi. Poller outbox 15s là load-bearing cho REQ-N nên không được ship kiểu đó.
- **Design ref**: lấy từ https://www.lotteria.vn theo chọn của chủ quán. Có 2 ảnh desktop (grid món + cart). **Thiếu bản mobile** — được gọi là rủi ro lớn nhất. Màu `#E4453A` hiện tại là của Lotteria, chờ logo quán.
- **Quy trình**: VGFlow đã gỡ 2026-07-29, GSD là quy trình duy nhất. Mọi cross-ref `.vg/...` trong spec là link chết. Đặc biệt: `.vg/ROADMAP.md` **chưa bao giờ chứa Phase 07** (chỉ có 6 phase từ commit `f5f9e4a` tới `07cad95`), nên success criteria phase 7 dưới đây là bản dựng lại từ §12 + §9 — đã được duyệt làm nguồn chuẩn.

## Constraints

- **Process**: Toàn bộ Milestone 2 là **LOCAL ONLY** — không deploy, không đụng VPS production. Push GitHub được (repo không có CI/CD). 5 acceptance criteria phụ thuộc production mang sang **deferred UAT** — C-LOCAL-01.
- **Schema**: 6 bảng mới (`store_settings`, `online_order_requests`, `phone_blacklist`, `site_events`, `notification_outbox`) + **chỉ thêm cột** vào `orders`. Không đổi cột đang dùng. `PAID_SQL` (`orders.service.ts:77`) giữ nguyên = tiền món; `ship_fee` tách dòng riêng — C-SCHEMA-01..07, M2.D-62.
- **Security**: `ALLOWED_ORIGIN` thành list **và** đổi `startsWith` → so khớp chính xác `protocol + '//' + host` bằng `new URL()`. Chỉ làm phần list mà giữ `startsWith` thì `https://quanbalun.site.evil.com` vẫn lọt — C-SEC-01 (mở rộng phạm vi M2.D-67, đã được duyệt).
- **Security**: `order_token` là bearer credential nằm trong URL → cần `Referrer-Policy: no-referrer` ở site block `order.` + mask 4 ký tự đầu trên UI. Spec không nói, nếu làm đúng chữ sẽ rơi mất — C-INFRA-03.
- **API contract**: `GET /api/public/orders/:token` **tuyệt đối không** chứa `status` từng item. Reviewer phải chặn PR nào leak — C-API-03, M2.D-23, điều kiện của G-1.
- **Tech stack**: pure ESM, import trong `apps/api` phải có `.js`; error envelope qua `GlobalExceptionFilter`; `/api/public/*` dùng `apiOk()`, staff routes dùng `{ data }`; controller mỏng 3–6 dòng; comment/describe viết tiếng Việt — C-CONV-01.
- **Không CORS**: `app.enableCors()` chưa từng được gọi, same-origin là load-bearing. Không được dùng CORS làm đường tắt — C-INFRA-02.
- **UI tokens**: nguồn chuẩn khi code là `apps/shop/src/styles/tokens.css`, **không** phải bảng §8-bis — C-UI-01.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 71 quyết định M2.D-01..71 đều LOCKED (spec:677 "đã chốt, không cần hỏi lại") | Spec qua 5 vòng review với chủ quán | — Pending |
| M2.D-59 ghi đè M2.D-41 — blacklist thêm/xoá tay, không TTL 24h | Chủ quán muốn kiểm soát tay | — Pending |
| M2.D-60 ghi đè M2.D-36 (chỉ ngưỡng auto-OFF) — `1800s` không phải `300s`. Pseudo-code spec:469 còn ghi 300s là **stale, không implement** | 5 phút quá gấp, dễ mất đơn giờ cao điểm | — Pending |
| Milestone 2 LOCAL ONLY; 5 criteria production → deferred UAT | Không rủi ro production khi đang thi công | — Pending |
| Mở rộng M2.D-67 sang so khớp host chính xác (C-SEC-01) | Làm đúng chữ vẫn để hở prefix-spoofing, mà M2 chính là lúc thêm origin thứ 2 + endpoint mutation công khai đầu tiên | — Pending |
| Success criteria Phase 7 dùng bản dựng lại từ §12+§9 | `.vg/ROADMAP.md` chưa bao giờ có Phase 07 — không có bản gốc để lấy lại | ✓ Good |
| Ảnh design ref mobile + logo/màu **chốt trước** Phase 8 | M2.D-71: thiếu ảnh mobile là rủi ro lớn nhất, khách gần 100% dùng điện thoại | ✓ Ảnh mobile có 2026-07-29 → `docs/design-refs/lotteria/README.md` |
| **Màu thương hiệu: bỏ bảng màu Lotteria, dùng màu rút từ 4 ảnh món ăn thật của quán** (gỗ ấm + hổ phách + ớt đỏ + rau xanh) | Lotteria là mẫu **bố cục**, không phải mẫu thương hiệu. Ảnh quán không có chi tiết hồng-trắng nào. Đo được: bảng mới còn tốt hơn về tiếp cận (`brand-500` 4.75:1 vs 3.87:1) | ✓ Good — chủ quán duyệt 2026-07-30. Ghi ở `OVERRIDE-DEBT.md` OD-04, nguồn sự thật `apps/shop/src/styles/tokens.css` |
| Hổ phách `#e8a33d` **chỉ làm nền**, không dùng cho chữ/nút | Đo 2.02:1 — màu ấm nhất trong ảnh lại là màu không đọc được. Chữ màu ấm dùng `--wood-700` (5.71:1) | ✓ Good — đã ghi cảnh báo trong `tokens.css` + `DESIGN.md` |
| Lưới món mobile: **1 cột (ref) vs 2 cột (spec §8-bis)** — chưa chốt | Ảnh ref mobile thật của Lotteria là 1 cột, spec đã LOCKED lại ghi 2 cột | — Pending, quyết ở `/gsd:ui-phase 8` (CONFLICT-DESIGN-01) |
| Test: tách hàm thuần (zero-config vitest) + harness integration MySQL thật cho M2.D-06/M2.D-01 | Row lock và đếm doanh thu mock không chứng minh được | — Pending |
| Poller outbox dùng `@nestjs/schedule` in-process; hồi sinh luôn 2 cron đang chết | Không đụng hạ tầng production, đúng LOCAL ONLY, giữ deploy 1 container | — Pending |

---
*Last updated: 2026-07-29 after `/gsd:ingest-docs` (Milestone 2 spec ingest + 6 conflict resolutions)*

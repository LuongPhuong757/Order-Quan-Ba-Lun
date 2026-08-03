# Roadmap: OrderQuanBaLun

## Overview

Milestone 1 đã giao POS nội bộ (6 phase, phases 1–6): auth + audit, menu, bàn, vòng đời order, auto-close, báo cáo.
Milestone 2 mở kênh đặt hàng online cho khách qua 4 phase: dựng hạ tầng app khách trên hostname riêng (7) →
menu + checkout + công tắc nhận đơn (8) → duyệt đơn + thông báo + theo dõi đơn (9) → analytics phễu (10).

Thứ tự này là goal-backward từ G-1..G-4: hạ tầng đi trước để bắt 3 bug hạ tầng đã phát hiện **trước khi** đổ công
vào UI; phần khách gửi được đơn đi trước phần quán duyệt đơn; analytics đi cuối vì cần event của cả 2 phía.

**Milestone 2 là LOCAL ONLY** — không deploy, không đụng VPS. 5 acceptance criteria phụ thuộc production được mang
sang deferred UAT (xem `REQUIREMENTS.md § Deferred UAT`), không phải blocker trong phase.

**Đối chiếu số phase:** spec `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` gọi các phase này là 07/08/09/10 —
tương ứng Phase 7/8/9/10 dưới đây. Thư mục kế hoạch dùng dạng zero-pad: `.planning/phases/07-*`.

## Milestones

- ✅ **v1.0 Milestone 1 — POS nội bộ** - Phases 1-6 (shipped 2026, dưới VGFlow)
- 🚧 **v2.0 Milestone 2 — Đặt hàng online** - Phases 7-10 (in progress)

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>✅ v1.0 Milestone 1 — POS nội bộ (Phases 1–6) — SHIPPED</summary>

- [x] **Phase 1: Foundation & Auth Infrastructure** - Auth (login, session) + audit log infrastructure
- [x] **Phase 2: Menu Management & Bulk Import** - Món ăn, bulk import CSV/Excel, cây nhóm hàng 3 cấp
- [x] **Phase 3: Table Management & Layout** - Sơ đồ bàn vị trí cố định, chuyển bàn, 3 loại bàn
- [x] **Phase 4: Order Lifecycle & Stock-out Handling** - State machine 4+3 trạng thái, xử lý hết nguyên liệu
- [x] **Phase 5: Auto-close Bàn** - Pending-review sau 10h, owner duyệt cuối ngày
- [x] **Phase 6: Báo Cáo Cuối Ngày** - Báo cáo daily theo Asia/Ho_Chi_Minh, drill-down, export

*Chi tiết per-phase (plans, verification records) được lập dưới VGFlow và **không migrate** sang GSD khi đổi
quy trình ngày 2026-07-29. Bằng chứng đã giao là chính codebase — xem `.planning/codebase/`.*

</details>

### 🚧 v2.0 Milestone 2 — Đặt hàng online (In Progress)

- [ ] **Phase 7: Hạ tầng trang khách** - `apps/shop` chạy như app riêng trên `order.<domain>`, dùng chung API + DB
- [x] **Phase 8: Menu công khai, Checkout & Công tắc nhận đơn** - Khách xem menu và gửi được đơn từ điện thoại (13/13 plan xong, checkpoint 08-13 Task 3 **approved** 2026-07-31 — còn 5 hạng mục `08-UAT.md` deferred trước deploy production, không phải blocker phase 9)
- [ ] **Phase 9: Duyệt đơn, Thông báo & Theo dõi đơn** - Đơn được duyệt nhanh, không bỏ quên, khách tự theo dõi
- [ ] **Phase 10: Analytics & Phễu chuyển đổi** - Chủ quán biết bao nhiêu người vào xem và bao nhiêu người đặt

## Phase Details

### Phase 7: Hạ tầng trang khách

**Goal**: `apps/shop` phục vụ được như một app riêng trên hostname riêng, dùng chung 1 API + 1 DB, và code trang quản lý không lọt sang bundle của khách
**Depends on**: Nothing new (Milestone 1 đã xong)
**Requirements**: REQ-Q
**Success Criteria** (what must be TRUE):

  1. Cùng một container: request mang `Host: order.*` nhận `shop-dist`, request apex nhận `web-dist` — kiểm bằng `curl -H "Host: ..."` vào API local (M2.D-66)
  2. Bundle JS đã build của shop **không chứa** chuỗi `/dashboard` hay `/kitchen` — kiểm bằng grep output build (M2.D-64)
  3. Submit từ origin `order.` không bị CSRF chặn, origin lạ bị chặn — **kể cả** `https://quanbalun.site.evil.com` (M2.D-67 + C-SEC-01, có unit test)
  4. `Dockerfile` (stage `shop`), `Caddyfile` (block `order.` với `geolocation=(self)` + `Referrer-Policy: no-referrer`) và `.env.example` (`ALLOWED_ORIGIN` 2 origin) đã sửa đúng và review được bằng diff — **không apply lên production** (C-LOCAL-01, C-INFRA-03)
  5. `pnpm test` ở `apps/api` chạy được với ít nhất 1 test thật — harness zero-config dựng xong, mở đường cho phase 9 (C-TEST-01)

**Plans**: 4 plans / 2 wave

Plans:

- [x] 07-01: **Wave 1 (tracer)** — Host-aware static routing + SPA fallback theo dist + stage `shop` trong Dockerfile → verify bằng `curl -H "Host: order.localhost"`
- [x] 07-02: **Wave 1** — Harness test đầu tiên của `apps/api` (zero-config vitest) + module thuần `origin-allowlist` viết theo TDD, test đỏ trước
- [x] 07-03: **Wave 2** (dep 07-02) — Nối allow-list vào `CsrfOriginGuard`, bỏ `startsWith`, `ALLOWED_ORIGIN` dạng list ở cả 2 file env mẫu
- [x] 07-04: **Wave 2** (dep 07-01) — Guard bundle khách + site block Caddy `order.` (`geolocation=(self)` + `no-referrer`) + ghi 7 deferred UAT

**Cross-cutting constraints**: C-LOCAL-01 (không plan nào được deploy / chạm VPS / sửa DNS) · C-CONV-01 (pure ESM `.js` extension, comment + `describe` tiếng Việt) · C-SEC-01 (so khớp host chính xác, không `startsWith`)
**Deferred UAT**: DNS A record, TLS cert Caddy, `Permissions-Policy` serve thật, cookie host-only qua 2 hostname thật, static routing đầu-cuối qua Caddy — xem `REQUIREMENTS.md § Deferred UAT`

### Phase 8: Menu công khai, Checkout & Công tắc nhận đơn

**Goal**: Khách xem được menu và gửi được đơn từ điện thoại; quán bật/tắt nhận đơn và chặn được lạm dụng
**Depends on**: Phase 7 (hạ tầng shop), Phase 2 (menu), Phase 3 (bàn)
**Requirements**: REQ-I, REQ-J, REQ-K, REQ-L
**Success Criteria** (what must be TRUE):

  1. Khách mở `order.` xem toàn bộ menu **không cần login**, món hết hàng **làm mờ không ẩn**, và xem được **trước khi** bị hỏi bất kỳ thông tin cá nhân nào (M2.D-08, M2.D-16)
  2. Khách gửi đơn thành công: chọn PICKUP/DELIVERY (PICKUP không hỏi địa chỉ), chia sẻ vị trí ra số km + kết luận phí bằng chữ, nhận `order_token`; giá được **chốt** trong `items_snapshot` (M2.D-15, M2.D-42, M2.D-50..52)
  3. Tắt công tắc: FE khoá nút **và** gọi API tay vẫn nhận `409 ONLINE_ORDERING_DISABLED`; ngoài giờ mở cửa cũng bị chặn; "OFF đến hết hôm nay" tự ON lại 00:00; **đơn đang chạy không bị ảnh hưởng** (M2.D-27..31)
  4. Một SĐT không mở được 2 đơn cùng lúc, SĐT trong blacklist bị chặn, rate limit IP + SĐT hoạt động, và `ip_hash` lưu dạng hash — không lưu IP thô (M2.D-40, M2.D-56, M2.D-59)
  5. `GET /api/public/menu` chỉ trả `id, code, name, price, unit, images[], is_out_of_stock` — không leak field nội bộ nào (M2.D-43)

**Plans**: 13 plans / 7 wave

Plans:

- [x] 08-01-PLAN.md — **Wave 1** Hợp đồng zod `/api/public/*` + 4 module thuần (store-status, order-guard, haversine, ip-hash) + test Wave 0
- [x] 08-02-PLAN.md — **Wave 1** 3 entity mới (§4 spec) + đăng ký `data-source` + `IP_HASH_SALT` + **[BLOCKING]** xác nhận schema bằng truy vấn MySQL thật
- [x] 08-03-PLAN.md — **Wave 2** (dep 02) `sharp` resize ảnh webp 800px lúc upload (D-12) + lockfile cross-platform cho alpine
- [x] 08-04-PLAN.md — **Wave 1** Router + AppShell + Header 2 biến thể cho `apps/shop` (4 trang đang là dead code) + `zod` direct dep + guard bundle 2 gate
- [x] 08-05-PLAN.md — **Wave 2** (dep 01,02) `store_settings` service + `/admin/settings` + `/admin/phone-blacklist` + 3 nhánh audit + `normalizePhone`
- [x] 08-06-PLAN.md — **Wave 2** (dep 01,04) Lớp dữ liệu `apps/shop`: `useApi` fetch+zod, `customer_token`, giỏ localStorage 24h có đồng bộ D-07
- [x] 08-07-PLAN.md — **Wave 3** (dep 02,05) **[SECURITY]** `CsrfOriginGuard` phủ `/api/public/*` + `GET /api/public/store` + `GET /api/public/menu` (đúng 7 field)
- [x] 08-08-PLAN.md — **Wave 3** (dep 05) `apps/web`: widget công tắc 1 chạm ở Dashboard + trang `/admin/settings` 2 tab
- [x] 08-09-PLAN.md — **Wave 4** (dep 06,07) Trang menu công khai: card món, dải danh mục, tìm kiếm không dấu, banner OFF/lỗi/giá đổi
- [x] 08-10-PLAN.md — **Wave 4** (dep 02,07) `POST /api/public/orders` (6 lớp kiểm tra + gap lock + snapshot giá + HMAC IP) + `GET /orders/:token`
- [x] 08-11-PLAN.md — **Wave 5** (dep 09) `/cart` bước 1 (chặn TIẾP TỤC khi có món hết) + `/o/:token` xác nhận tối giản + `/history` empty state
- [x] 08-12-PLAN.md — **Wave 6** (dep 10,11) `/checkout` bước 2: PICKUP/DELIVERY, Geolocation không chặn luồng, parse link Maps, submit 8 mã lỗi
- [x] 08-13-PLAN.md — **Wave 7** (dep tất cả) `OVERRIDE-DEBT.md` OD-06/07/08 + `08-UAT.md` (gate `sharp`/Docker trước deploy) + checkpoint 15 bước

**UI hint**: yes
**Gate trước khi chạy**: ✅ ĐÃ CHỐT 2026-07-30 — logo wordmark chữ (`apps/shop/src/components/Wordmark.tsx`), bảng màu rút từ 4 ảnh món thật (`OVERRIDE-DEBT.md` OD-04), CONFLICT-DESIGN-01 giải bằng lưới 1 cột mobile (OD-05). Xem `docs/design-refs/lotteria/README.md`
**Ghi chú thi công**: `synchronize: true` không migration (C-SCHEMA-07) → plan 08-02 có task `[BLOCKING]` xác nhận bảng tồn tại thật bằng truy vấn MySQL, vì `typecheck`/`build` vẫn PASS khi DB chưa có bảng nào · lỗ hổng `CsrfOriginGuard` chưa phủ `/api/public/*` phải đóng ở plan 08-07 **trước** endpoint submit (08-10) · `sharp` là dependency native đầu tiên, Docker build là deferred UAT nhưng là **gate bắt buộc trước deploy production**

### Phase 9: Duyệt đơn, Thông báo & Theo dõi đơn

**Goal**: Đơn của khách được duyệt nhanh, không bao giờ bị bỏ quên, và khách tự theo dõi được tiến độ mà không thấy trạng thái từng món
**Depends on**: Phase 8, Phase 4 (order lifecycle)
**Requirements**: REQ-M, REQ-N, REQ-O
**Success Criteria** (what must be TRUE):

  1. Admin thấy đơn mới trong **< 2s** (SSE + chuông + badge); role `order` xem được hàng chờ nhưng gọi API confirm/reject trực tiếp vẫn bị chặn (M2.D-32, M2.D-33)
  2. Xác nhận → cấp bàn trống đầu tiên theo `code` ASC đúng `kind`; hết bàn thì **tự tạo bàn mới** + audit log (khách không bao giờ bị chặn); 2 admin duyệt song song **không** cấp trùng bàn (M2.D-04..06, M2.D-14)
  3. Đơn `WAITING` **không** xuất hiện ở sơ đồ bàn / bếp / history / doanh thu — chứng minh bằng test đếm doanh thu trước và sau khi có 5 đơn WAITING (M2.D-01)
  4. Đơn quá **90s** chưa duyệt → SMS bắn; quá **1800s** → tự OFF nhận đơn + audit actor SYSTEM và **không tự ON lại**; duyệt trước ngưỡng thì outbox L2/L4 bị huỷ; đổi `SMS_DRIVER` console↔esms không sửa logic (M2.D-36, M2.D-60, M2.D-63)
  5. `/o/<token>` hiện % đúng công thức trọng số, **không bao giờ tụt**, tối đa 95% khi chưa xong, và response **tuyệt đối không chứa** `status` từng item — assert trong test (M2.D-19, M2.D-20, M2.D-23 — điều kiện của G-1)

**Plans**: 12/13 plans executed

Plans:

- [x] 09-01-PLAN.md — **Wave 1** Hợp đồng zod admin online-orders (5 lý do từ chối soạn sẵn) + hàm thuần `computeProgress()` §6
- [x] 09-02-PLAN.md — **Wave 1** Cài `@nestjs/schedule@6.1.3` (đường không-pnpm) + `ScheduleModule` + hồi sinh 2 cron chết (C-CRON-01)
- [x] 09-03-PLAN.md — **Wave 1** Tách `KIND_FORMAT` + `runWithRetry` thành module dùng chung + hàm thuần chọn bàn
- [x] 09-04-PLAN.md — **Wave 1** Entity §4.5/§4.6 + cột ghi chú nội bộ + **[BLOCKING]** xác nhận schema bằng truy vấn MySQL thật
- [x] 09-05-PLAN.md — **Wave 2** (dep 02,04) `notification_outbox` service + 2 driver SMS + `EmailChannel` + poller `@Cron` 15s
- [x] 09-06-PLAN.md — **Wave 3** (dep 01,03,04,05) `confirm()`/`reject()`/`list()` — transaction cấp bàn `FOR UPDATE` + tự tạo bàn
- [x] 09-07-PLAN.md — **Wave 4** (dep 06) Controller `admin/online-orders` 3 route + SSE stream + audit `action_kind`
- [x] 09-08-PLAN.md — **Wave 5** (dep 06,07) Integration test MySQL thật (row lock + doanh thu) + `ship_fee` tách khỏi doanh thu món
- [x] 09-09-PLAN.md — **Wave 5** (dep 01,04,05,07) `/api/public/orders/:token` đủ % + 5 mốc + outbox/SSE lúc submit
- [x] 09-10-PLAN.md — **Wave 5** (dep 07) `OnlineOrdersQueuePage` — SSE client, chuông, badge, panel từ chối
- [x] 09-11-PLAN.md — **Wave 6** (dep 09) `/o/:token` — stepper 5 mốc, %, banner món huỷ, nhánh từ chối
- [x] 09-12-PLAN.md — **Wave 7** (dep 11) **Sửa lại phase 8**: công tắc 2 trạng thái đều nhận đơn + 2 key chữ + bỏ auto-OFF
- [ ] 09-13-PLAN.md — **Wave 8** (dep tất cả) `OVERRIDE-DEBT` OD-11..15 + sửa ROADMAP/REQUIREMENTS/08-VERIFICATION + checkpoint

**UI hint**: yes
**Ghi chú thi công**: cần harness integration MySQL thật cho criterion 2 và 3 (row lock, transaction — mock không chứng minh được, C-TEST-01); poller outbox 15s dùng `@nestjs/schedule` in-process và **đồng thời** hồi sinh 2 cron đang chết (C-CRON-01); SSE phải fan-out in-process qua `@nestjs/event-emitter`, không giữ 1 DB connection mỗi subscriber (C-INFRA-01)

### Phase 10: Analytics & Phễu chuyển đổi

**Goal**: Chủ quán biết bao nhiêu người vào xem và bao nhiêu người thật sự đặt món, và món nào đang có vấn đề về ảnh/giá
**Depends on**: Phase 8, Phase 9
**Requirements**: REQ-P
**Success Criteria** (what must be TRUE):

  1. Dashboard hiện: khách/ngày, số đơn, tỉ lệ chuyển đổi, **bước rơi nhiều nhất**, thời gian ở trang (G-4)
  2. Hiện **món xem nhiều nhưng ít đặt** (dấu hiệu ảnh/giá có vấn đề) và **thời gian trung bình admin duyệt đơn** (KPI G-2)
  3. 5 event ghi đúng mốc theo `session_id` first-party cookie; IP lưu dạng **hash** (M2.D-55, M2.D-56)
  4. Email tổng hợp gửi **23:30 Asia/Ho_Chi_Minh** và cron dọn `site_events` > 180 ngày **chạy thật** — có scheduler, không phải CLI script không ai gọi (M2.D-38, C-CRON-01)

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 7 → 8 → 9 → 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation & Auth | M1 | — | Complete | 2026 (VGFlow) |
| 2. Menu Management | M1 | — | Complete | 2026 (VGFlow) |
| 3. Table Management | M1 | — | Complete | 2026 (VGFlow) |
| 4. Order Lifecycle | M1 | — | Complete | 2026 (VGFlow) |
| 5. Auto-close Bàn | M1 | — | Complete | 2026 (VGFlow) |
| 6. Báo Cáo Cuối Ngày | M1 | — | Complete | 2026 (VGFlow) |
| 7. Hạ tầng trang khách | M2 | 4/4 | Executed | 2026-07-29 |
| 8. Menu, Checkout & Công tắc | M2 | 13/13 | Executed (checkpoint approved; 5 deferred UAT còn treo) | 2026-07-31 |
| 9. Duyệt đơn, Thông báo & Theo dõi | M2 | 12/13 | In Progress|  |
| 10. Analytics & Phễu | M2 | 0/TBD | Not started | - |

---
*Created: 2026-07-29 from `/gsd:ingest-docs` (Milestone 2 spec, 71 locked decisions, 9 requirements, 22 constraints)*

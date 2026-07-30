# Requirements: OrderQuanBaLun

**Defined:** 2026-07-29 (Milestone 2, từ `/gsd:ingest-docs`)
**Core Value:** Khách đặt được món từ xa mà quán không bao giờ bỏ lọt đơn, và đơn chưa duyệt không bao giờ lẫn vào bếp / sơ đồ bàn / doanh thu.

> Acceptance criteria đầy đủ (kèm số dòng spec, tag `[PROD-UAT]`, và trạng thái DONE/NOT DONE đã verify
> trên cây code) nằm ở `.planning/intel/requirements.md`. File này là bản checkable + traceability.
> Decision text gốc tiếng Việt: `.planning/intel/decisions.md` (M2.D-01..71, tất cả LOCKED).

## v1 Requirements

### Milestone 1 — đã giao (POS nội bộ)

- [x] **REQ-A**: Quản lý menu + bulk import CSV/Excel, cây nhóm hàng 3 cấp
- [x] **REQ-B**: Sơ đồ bàn + chuyển bàn, 3 loại bàn dine-in/takeaway/delivery
- [x] **REQ-C**: Auth + session (cookie HttpOnly, 12h)
- [x] **REQ-D**: Vòng đời order (state machine 4 chính + 3 phụ)
- [x] **REQ-E**: Xử lý hết nguyên liệu
- [x] **REQ-F**: Auto-close bàn (pending review sau 10h)
- [x] **REQ-G**: Audit log + retention 90 ngày
- [x] **REQ-H**: Báo cáo cuối ngày (Asia/Ho_Chi_Minh)

### Shop Infra

- [ ] **REQ-Q**: Tách frontend trang khách thành app riêng `apps/shop` trên subdomain `order.<domain>`, dùng chung 1 API + 1 DB
  - M2.D-64, M2.D-65, M2.D-66, M2.D-67, M2.D-68, M2.D-69 · +C-SEC-01, C-INFRA-03
  - Đã xong ~1/3: scaffold + 4 trang placeholder + `GET /api/public/health`
  - Còn: Host-switch `main.ts`, stage `shop` trong `Dockerfile`, `ALLOWED_ORIGIN` list + so khớp host chính xác, Caddy block `order.` (`geolocation=(self)` + `Referrer-Policy: no-referrer`), harness test

### Public Menu

- [x] **REQ-I**: Trang menu công khai không cần login, mobile-first, ảnh lớn, tab nhóm hàng dính, tìm kiếm, món hết hàng **làm mờ không ẩn**, giỏ hàng nổi hiện tổng tiền
  - M2.D-08, M2.D-16, M2.D-26, M2.D-31, M2.D-43, M2.D-70, M2.D-71

### Checkout

- [x] **REQ-J**: Checkout 1 trang — họ tên, SĐT, PICKUP/DELIVERY, địa chỉ + chia sẻ vị trí (chỉ DELIVERY), ghi chú; autofill từ `customer_token`; **snapshot giá**
  - M2.D-09, M2.D-12..15, M2.D-42, M2.D-49..53, M2.D-58

### Store Switch

- [x] **REQ-K**: Công tắc ON/OFF nhận đơn online + giờ mở cửa + lý do tạm ngưng; chặn **2 lớp** FE và BE
  - M2.D-25..31

### Anti-abuse

- [x] **REQ-L**: Rate limit IP + SĐT, 1 đơn mở/SĐT, blacklist SĐT thêm/xoá tay (không tự hết hạn)
  - M2.D-40, M2.D-56, M2.D-59 (ghi đè M2.D-41)

### Approval

- [ ] **REQ-M**: Hàng chờ duyệt cho admin; xác nhận → tự cấp bàn (tự tạo nếu hết) → items vào bếp; từ chối kèm lý do; **chỉ role `admin`** được duyệt; re-check tồn kho + nhập phí ship
  - M2.D-01..06, M2.D-14, M2.D-33, M2.D-48, M2.D-58, M2.D-61, M2.D-62

### Notification

- [ ] **REQ-N**: Thông báo 4 lớp (SSE admin+order / SMS 90s / Email / leo thang + **auto-OFF sau 1800s**) qua adapter `NotificationChannel` + `notification_outbox`
  - M2.D-32, M2.D-34..39, M2.D-60, M2.D-63 · +C-CRON-01, C-INFRA-01

### Order Tracking

- [ ] **REQ-O**: Trang `/o/<order_token>` — % trọng số **đơn điệu**, 5 mốc trạng thái, danh sách món **không lộ trạng thái từng món**, banner khi quán sửa đơn, nút gọi quán
  - M2.D-11, M2.D-15, M2.D-17..24, M2.D-44..47 · +C-API-03 (hard gate G-1)

### Analytics

- [ ] **REQ-P**: Phễu 5 bước + dashboard truy cập/chuyển đổi + email tổng hợp cuối ngày 23:30 *(**should-have**)*
  - M2.D-38, M2.D-54..57

## v2 Requirements

Ghi nhận nhưng chưa vào roadmap.

### Notification

- **NOTF-V2-01**: Web Push (VAPID) — miễn phí, độ trễ 2–5s, về được máy khi tắt web; iPhone cần PWA "Thêm vào màn hình chính"
- **NOTF-V2-02**: Telegram bot — adapter M2.D-37 cho phép thêm bằng 1 file
- **NOTF-V2-03**: Voice call lớp L5 nếu SMS vẫn bị bỏ lọt

### Payment

- **PAY-V2-01**: VietQR / chuyển khoản — cột `payment_method` đã để ngỏ (M2.D-58)

### Logistics

- **DIST-V2-01**: Đo khoảng cách chính xác qua OSRM self-host hoặc Google Distance Matrix nếu Haversine × 1.3 sai nhiều
- **TABLE-V2-01**: Tự ẩn/gộp bàn ship rỗng nếu sơ đồ phình to

## Out of Scope

| Feature | Reason |
|---------|--------|
| Tự động tính tiền ship | M2.D-52 — hệ thống chỉ hiện quy tắc, admin chốt số |
| Lộ trình / vị trí tài xế trên trang khách | M2.D-24 — cố tình không làm |
| Trạng thái từng món trên trang khách | M2.D-23 — vi phạm G-1. Ngoại lệ duy nhất: món bị huỷ **phải** hiện (M2.D-21, "che là lừa khách") |
| `cron-blacklist-cleanup.ts` | M2.D-59 — blacklist thêm/xoá tay, không TTL |
| Migration files | M2.D-07 + `synchronize: true` — chỉ thêm entity |
| Login cho khách | M2.D-08 — khách xem menu trước khi bị hỏi bất kỳ thông tin nào |
| CORS policy | C-INFRA-02 — same-origin là load-bearing, không dùng CORS làm đường tắt |
| Deploy / đụng VPS trong Milestone 2 | C-LOCAL-01 — mandate LOCAL ONLY |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-A..H | Phases 1–6 (Milestone 1) | Complete |
| REQ-Q | Phase 7 | In Progress (~1/3) |
| REQ-I | Phase 8 | Complete |
| REQ-J | Phase 8 | Complete |
| REQ-K | Phase 8 | Complete |
| REQ-L | Phase 8 | Complete |
| REQ-M | Phase 9 | Pending |
| REQ-N | Phase 9 | Pending |
| REQ-O | Phase 9 | Pending |
| REQ-P | Phase 10 | Pending |

**Coverage:**
- Milestone 2 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

## Deferred UAT (C-LOCAL-01)

Không nghiệm thu được ở local — chủ dự án tự kiểm trên production **sau** milestone, **không** phải blocker trong phase.

| # | Criterion | REQ | Local substitute |
|---|-----------|-----|------------------|
| 1 | DNS A record `order.quanbalun.site` → IP VPS (M2.D-65) | REQ-Q | — (ngoài phạm vi) |
| 2 | Caddy tự cấp TLS cert cho site block `order.` (M2.D-65) | REQ-Q | Review diff Caddyfile, không apply |
| 3 | `Permissions-Policy: geolocation=(self)` thật sự được serve (M2.D-69) | REQ-Q | Vite dev không set header này — chỉ review Caddyfile |
| 4 | Cookie host-only quan sát qua 2 hostname thật trên DevTools (M2.D-68) | REQ-Q | Unit test allow-list + đọc lại cấu hình cookie |
| 5 | `order.` trả `shop-dist` vs apex trả `web-dist` xuyên qua Caddy (M2.D-66) | REQ-Q | `curl -H "Host: order.localhost"` vào dev API |

---
*Requirements defined: 2026-07-29*
*Last updated: 2026-07-29 after `/gsd:ingest-docs` (Milestone 2 spec ingest)*

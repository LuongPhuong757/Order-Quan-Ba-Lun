---
phase: "08"
profile: feature
platform: web-fullstack
status: approved
created_at: 2026-07-29
source: ai-draft
---

## Goal

Khách xem menu công khai không cần login trên `order.<domain>` và đặt món qua giỏ hàng
→ checkout, giá chốt tại thời điểm gửi đơn. Đơn vào bảng chờ riêng, **KHÔNG chiếm bàn**
và **KHÔNG lọt vào doanh thu**. Chủ quán có công tắc ON/OFF nhận đơn + giờ mở cửa.
Chống spam bằng rate limit và blacklist SĐT.

Nguồn: REQ-I, REQ-J, REQ-K, REQ-L (`.vg/REQUIREMENTS.md`, acceptance criteria
AC-I1..AC-L3) + `.vg/MILESTONE-02-ONLINE-ORDERING-SPEC.md` (M2.D-08..53 phần khách,
M2.D-59, M2.D-70, M2.D-71).

## Scope

### In Scope

#### DB (`synchronize: true`, không viết migration — M2.D-07)
- `store_settings` — 20 key seed: công tắc + kiểu OFF + lý do, `open_hours` theo thứ,
  `store_phone`, toạ độ quán, `free_ship_km` (mặc định 10), `distance_factor` (1.3),
  `pickup_enabled`/`delivery_enabled`, ETA pickup/delivery, danh sách SĐT/email nhận
  thông báo (phase 08 chỉ lưu, phase 09 mới dùng để gửi).
- `online_order_requests` — bảng chờ **riêng**, KHÔNG nằm trong `orders` (M2.D-01).
- `phone_blacklist` — `expires_at` NULL = vĩnh viễn (M2.D-59).

#### API public (`/api/public`, không auth)
- `GET /store` — trạng thái nhận đơn, lý do OFF, SĐT quán, giờ mở cửa, `is_open_now`,
  `pickup_enabled`/`delivery_enabled`, `free_ship_km`, ETA. FE gọi đầu tiên.
- `GET /menu` — cây nhóm hàng + món, **chỉ** field khách cần: `id, code, name, price,
  unit, images[], is_out_of_stock`.
- `POST /session` — sinh/nhận `customer_token`.
- `POST /orders` — submit đơn, trả `{ order_token }`.
- `GET /orders/:token` — trả thông tin đơn ở mức phase 08 (món + tổng tiền + trạng thái
  WAITING/REJECTED/CANCELLED). **Chưa** có % tiến độ / 5 mốc — đó là phase 09.
- `PATCH /orders/:token` · `DELETE /orders/:token` — chỉ khi `status = WAITING`
  (M2.D-44), ngoài ra `409 ORDER_ALREADY_CONFIRMED`.
- `GET /orders?customer_token=` — lịch sử đơn của thiết bị, PII che một phần (M2.D-12).
- Zod schema ở `packages/schemas/src/public-orders.ts`; 9 error code mới trong
  `packages/schemas/src/errors.ts`.

#### API admin (`/api/admin`, role `admin`)
- `GET` / `PUT /settings` — đọc/ghi `store_settings`, ghi audit log mỗi lần đổi (M2.D-25).
- `GET` / `POST` / `DELETE /phone-blacklist` — admin thêm/xoá tay (M2.D-59).

#### FE `apps/shop` — theo §8-bis của spec (tham chiếu lotteria.vn)
- `/` **MenuPage** — dải nhóm hàng cuộn ngang dính, lưới món (desktop 4 cột /
  mobile 2 cột), tìm kiếm, "Bán chạy" tính từ dữ liệu bán thật, món hết hàng **làm mờ +
  nút `+` disable** (không ẩn), giỏ hàng nổi hiện tổng tiền.
- `/cart` **CartPage** — stepper bước 1, ô "Ghi chú đơn hàng", empty state.
- `/checkout` **CheckoutPage** — họ tên, SĐT, chọn PICKUP/DELIVERY, địa chỉ + nút
  "Chia sẻ vị trí" + dán link Maps (chỉ DELIVERY), autofill từ `customer_token`,
  gợi ý "thêm nước không?".
- `/history` **MyOrdersPage** — lịch sử đơn theo thiết bị.
- Banner tạm ngưng nhận đơn / ngoài giờ mở cửa — dùng đúng ô banner của layout §8-bis.

#### FE `apps/web` (trang quản lý)
- `/admin/settings` **StoreSettingsPage** — công tắc ON/OFF, kiểu OFF, lý do, giờ mở cửa
  theo thứ, toạ độ quán, `free_ship_km`, danh sách SĐT/email, quản lý blacklist.
- Widget công tắc ON/OFF trên Dashboard hiện có (truy cập nhanh).

#### Logic
- `customer_token` random ≥32 byte hex, localStorage vĩnh viễn (M2.D-09).
- `order_token` random ≥32 byte hex, **không tuần tự** (M2.D-11).
- Khoảng cách = Haversine × `distance_factor` → `distance_km` (M2.D-50).
- Chốt giá: `items_snapshot` + `subtotal` snapshot tại submit (M2.D-42).
- Chặn 2 lớp: FE ẩn/khoá nút **và** BE trả `409 ONLINE_ORDERING_DISABLED`; BE là nguồn
  sự thật (M2.D-27).
- OFF "đến hết hôm nay" tự ON lại 00:00 Asia/Ho_Chi_Minh (M2.D-28).
- Ngoài giờ mở cửa tự chặn đặt; manual override luôn thắng (M2.D-30).
- Rate limit theo IP **và** theo SĐT; 1 SĐT chỉ 1 đơn đang mở (M2.D-40).
- Đơn đang chạy không bị ảnh hưởng khi OFF (M2.D-31).

## Out of Scope

- Duyệt đơn, cấp bàn, tự tạo bàn, re-check tồn kho, chuyển item vào bếp — **phase 09**.
- SSE, SMS, Email, leo thang 90s, auto-OFF 30 phút, `notification_outbox` — **phase 09**.
- Trang tracking phần **% tiến độ + 5 mốc + banner "quán vừa cập nhật đơn"** — **phase 09**.
  Phase 08 chỉ sinh `order_token` và trả thông tin đơn ở mức WAITING.
- `ship_fee`, `payment_method`, luồng thanh toán — **phase 09** (nhập ở màn duyệt).
- `site_events`, `POST /api/public/events`, phễu 5 bước, email tổng hợp cuối ngày,
  cron dọn event — **phase 10**.
- Cron dọn blacklist — đã bỏ theo M2.D-59 (blacklist thủ công, không tự hết hạn).
- Web Push / Telegram / Zalo — hoãn (M2.D-39).
- Lộ trình / vị trí tài xế (M2.D-24). Tra lịch sử đơn bằng SĐT (M2.D-10).
- Sửa cơ chế auth / cookie / JWT của trang quản lý.

## Constraints

- **Đơn WAITING không chiếm bàn.** Bàn chỉ được cấp tại thời điểm xác nhận ở phase 09
  (M2.D-03) — nếu gán bàn lúc submit, vài đơn spam khoá hết bàn ship.
- **Endpoint public whitelist field**, không bao giờ trả giá vốn / tồn / thông tin nhân
  viên (M2.D-43). Reviewer phải chặn PR nào leak.
- Menu online **= menu nội bộ**, không thêm cờ `is_online` (M2.D-16).
- **KHÔNG auto-tính tiền ship** — chỉ gợi ý, ghi rõ "phí cuối do quán xác nhận khi gọi
  lại"; không có toạ độ thì hiện quy tắc dạng text (M2.D-51, M2.D-52).
- Mọi mốc thời gian (giờ mở cửa, auto ON lại) theo **Asia/Ho_Chi_Minh**.
- Mobile-first: bundle route `/` ≤ **150KB gzip**, TTI < 3s trên Slow-4G, touch target
  ≥ 44×44px, font ≥ 16px.
- **Cần ảnh design ref bản mobile trước khi build UI** — hiện còn thiếu, xem
  `.vg/design-refs/lotteria/README.md`. `/vg:blueprint` sẽ chặn ở gate design nếu thiếu.
- **Màu thương hiệu chưa chốt** — cần logo quán (đang tạm dùng đỏ coral `#E4453A`).
- Phụ thuộc **phase 07 đã xong**: `apps/shop` tồn tại, subdomain chạy HTTPS,
  `ALLOWED_ORIGIN` dạng danh sách, `geolocation=(self)`.
- Làm trên nhánh `feat/online-ordering`.

## Success criteria

- [ ] Xem menu không cần login; món hết hàng làm mờ + nút `+` disable, không ẩn (AC-I1).
- [ ] Khách xem được menu **TRƯỚC** khi bị hỏi bất kỳ thông tin cá nhân nào (AC-I2, M2.D-08).
- [ ] Dải nhóm hàng cuộn ngang, nhóm đang chọn viền đỏ; nguồn `menu_groups` (AC-I3).
- [ ] Lưới món desktop 4 cột / mobile 2 cột, card đúng §8-bis (AC-I4).
- [ ] Response public **không chứa** field nội bộ — assert trong test (AC-I5, M2.D-43).
- [ ] `customer_token` sinh lần đầu, lưu localStorage, autofill lần sau (AC-J1).
- [ ] PICKUP **không** hỏi địa chỉ; DELIVERY mới hiện địa chỉ (AC-J2, M2.D-15).
- [ ] "Chia sẻ vị trí" trả lat/lng + sinh link Maps; `distance_km` = Haversine × 1.3 (AC-J3).
- [ ] Có toạ độ → hiện số km + kết luận phí; không có → quy tắc text; **không auto-tính
      tiền** (AC-J4).
- [ ] Submit tạo `online_order_requests` status WAITING với `items_snapshot` + `subtotal`
      chốt giá (AC-J5).
- [ ] OFF: FE khoá nút **VÀ** gọi API tay vẫn trả `409 ONLINE_ORDERING_DISABLED`
      (AC-K1) — test bằng `curl`, không chỉ test qua UI.
- [ ] OFF vẫn xem được menu + banner kèm lý do và SĐT quán (AC-K2).
- [ ] "OFF đến hết hôm nay" tự ON lại 00:00 giờ Việt Nam (AC-K3).
- [ ] Ngoài giờ mở cửa tự chặn đặt; manual override thắng (AC-K4).
- [ ] Mọi thay đổi setting ghi audit log (AC-K5).
- [ ] Rate limit IP + SĐT hoạt động; 1 SĐT chỉ 1 đơn đang mở (AC-L1, AC-L2).
- [ ] Blacklist chặn submit; admin thêm/xoá tay được; bản ghi **không tự hết hạn** (AC-L3).
- [ ] **5 đơn WAITING không làm đổi** doanh thu / sơ đồ bàn / trang bếp / history —
      đếm trước và sau để so (M2.D-01).
- [ ] `order_token` không đoán được: 2 đơn liên tiếp có token khác nhau hoàn toàn (M2.D-11).
- [ ] Không hồi quy `apps/web`: mọi màn POS nội bộ chạy như trước.

## Dependencies

### Upstream (gate trước phase này)
- **Phase 07** — `apps/shop` + subdomain + `ALLOWED_ORIGIN` danh sách +
  `geolocation=(self)`.
- **Phase 02** — dữ liệu menu + `menu_groups` (3 cấp).
- **Phase 03** — bàn `kind = takeaway | delivery` đã tồn tại (phase 08 chưa cấp bàn,
  chỉ cần biết loại bàn sẽ dùng ở phase 09).
- **Ảnh design ref bản mobile** + logo / màu thương hiệu — việc thủ công của chủ quán.

### Downstream (phase này gate cho)
- **Phase 09** — đọc `online_order_requests` để duyệt, dùng `store_settings` để gửi
  thông báo và auto-OFF.
- **Phase 10** — đọc `online_order_requests` để tính tỉ lệ chuyển đổi.

### External
- **Geolocation API** của trình duyệt — cần HTTPS + `geolocation=(self)` từ phase 07.
- Không dùng API bản đồ trả phí (M2.D-50 — Haversine tự tính).

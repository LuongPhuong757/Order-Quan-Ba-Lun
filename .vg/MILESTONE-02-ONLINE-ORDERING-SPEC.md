# Milestone 2 — Đặt Hàng Online (Khách Tự Order Từ Xa)

**Trạng thái:** SPEC ĐÃ CHỐT — chờ `/gsd-new-milestone` để sinh phase artifacts
**Ngày chốt:** 2026-07-29
**Nguồn:** Phiên thảo luận trực tiếp với chủ quán (3 vòng hỏi–đáp)
**Phạm vi:** 3 phase (07, 08, 09), tiếp nối Milestone 1 (POS nội bộ)

---

## 1. Mục tiêu

Cho khách hàng tự đặt món từ xa qua web công khai (không cần login), đơn phải được **admin xác nhận** trước khi vào bếp. Khách theo dõi tiến độ bằng **% tổng** (không lộ món nào đã xong). Quán có công tắc **ON/OFF nhận đơn** và hệ thống thông báo nhiều lớp để không bỏ lọt đơn.

### 4 tiêu chí thành công (do chủ quán đặt ra)

| # | Tiêu chí | Cách đo |
|---|---|---|
| G-1 | Khách order từ xa có trải nghiệm tốt nhất; chỉ thấy **% tổng số món đã xong**, không thấy món cụ thể (tránh khách sốt ruột → huỷ) | Trang tracking chỉ render % + 5 mốc trạng thái |
| G-2 | Admin biết có đơn mới sớm nhất có thể | p95 độ trễ thông báo < 5s; tỉ lệ đơn bị bỏ quên > 5 phút = 0 |
| G-3 | Giao diện giữ khách ở lại lâu để chọn món | Thời gian trung bình trên trang menu; tỉ lệ rời trang ở bước 1 |
| G-4 | Thống kê số người truy cập + số người đặt món | Dashboard phễu 5 bước, cập nhật hằng ngày |

---

## 2. Quyết định đã chốt (locked)

> Mỗi quyết định có ID để phase artifacts tham chiếu. **Không đổi** mà không ghi vào `OVERRIDE-DEBT.md`.

### Kiến trúc dữ liệu

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-01** | Đơn chờ duyệt lưu ở bảng **staging `online_order_requests`** riêng, KHÔNG nằm trong `orders` | 48 điểm query `orders` (doanh thu / history / sơ đồ bàn / bếp) — nếu nhét đơn chưa duyệt vào đó, mỗi chỗ quên filter = đơn chưa duyệt lọt vào doanh thu. Cách ly rẻ hơn sửa bug. |
| **M2.D-02** | Admin xác nhận → sinh `Order` thật qua **`getOrCreateOpenOrder()` hiện có**, rồi add items qua path hiện có, rồi chuyển toàn bộ item `PENDING → KITCHEN` | Tái dùng code đã chạy production, không viết state machine thứ hai |
| **M2.D-03** | Đơn chờ duyệt **KHÔNG chiếm bàn**. Bàn chỉ được cấp tại thời điểm xác nhận | `getOrCreateOpenOrder` chỉ cho 1 order mở/bàn ([orders.service.ts:206](../apps/api/src/modules/orders/orders.service.ts#L206)) → nếu gán bàn lúc submit, 3 đơn spam khoá hết bàn ship = DoS miễn phí |
| **M2.D-04** | Cấp bàn: quét bàn cùng `kind` theo **`code` tăng dần**, chọn bàn trống đầu tiên (`closed_at IS NULL` không tồn tại), bỏ qua bàn `kiotviet_locked = true` hoặc `is_active = false` | Theo `code` ổn định, không đổi khi kéo bàn trên sơ đồ |
| **M2.D-05** | **Hết bàn trống → tự tạo bàn mới** `SHIP-NN` / `TAKE-NN` (NN = số kế tiếp), `is_active = true`, `x/y` xếp cuối sơ đồ. Ghi audit log. | Chủ quán chọn: không được để khách bị chặn vì thiếu bàn |
| **M2.D-06** | Cấp bàn chạy trong **1 transaction + row lock**, retry theo `runWithRetry()` có sẵn | 2 admin bấm xác nhận cùng lúc không được cấp trùng bàn |
| **M2.D-07** | `synchronize: true` — **không viết migration file** | Theo `data-source.ts:39` (quyết định sẵn của project) |

### Luồng khách hàng

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-08** | **Xem menu trước, hỏi thông tin sau.** Không hỏi SĐT/địa chỉ trước khi khách xem được menu | Hỏi PII ở cửa → rời trang 50–70%. Vẫn thu đủ 100% thông tin ở bước checkout (G-3) |
| **M2.D-09** | **Không login, không OTP.** Token thiết bị (`customer_token`) random ≥32 byte hex sinh lần đầu vào web, lưu localStorage **vĩnh viễn**; dùng để autofill thông tin + xem lịch sử đơn của thiết bị | Ma sát thấp nhất |
| **M2.D-10** | **Chấp nhận mất lịch sử** nếu khách xoá localStorage / đổi máy. KHÔNG làm cơ chế tra lịch sử bằng SĐT | Chủ quán chốt. Tránh lỗ hổng "biết SĐT = xem được đơn người khác" |
| **M2.D-11** | Trang theo dõi đơn: `/o/<order_token>`, token riêng cho từng đơn, random ≥32 byte hex (KHÔNG dùng UUID tuần tự) | Không đoán được URL đơn người khác |
| **M2.D-12** | Hiển thị lại PII đã lưu ở dạng **che một phần**: `0912***678`, địa chỉ rút gọn | Điện thoại dễ bị người bên cạnh nhìn |
| **M2.D-13** | 2 phương thức nhận hàng: **PICKUP** (đến quán lấy) / **DELIVERY** (ship tận nơi) | Chủ quán yêu cầu |
| **M2.D-14** | PICKUP → cấp bàn `kind = 'takeaway'`. DELIVERY → cấp bàn `kind = 'delivery'` | Đơn pickup không ăn vào hạn mức bàn ship |
| **M2.D-15** | PICKUP **không hỏi địa chỉ**, mốc 100% là `READY` (*"Món đã xong, mời bạn đến lấy"*). DELIVERY mốc 100% là `SERVED` | Ngữ nghĩa khác nhau thật |
| **M2.D-16** | Menu online = **menu nội bộ**, không tách cờ `is_online` | Chủ quán chốt: giống nhau |

### Thanh tiến độ (G-1)

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-17** | % tính theo **trọng số trạng thái**, không phải `số món SERVED / tổng món` | Cách chia đơn thuần nhảy giật cục (0% suốt 10 phút rồi vọt 50%) — khách sốt ruột đúng lúc cần tránh |
| **M2.D-18** | Trọng số: `KITCHEN 0.15`, `COOKING 0.45`, `READY 0.80`, `SERVED 1.00`. `% = Σ trọng số / số món hợp lệ` | Thanh chạy mượt, luôn nhích lên |
| **M2.D-19** | **Đơn điệu** — cache `max_progress_shown` phía server, không bao giờ tụt (kể cả món bị trả về bếp) | Thấy % tụt = mất niềm tin ngay |
| **M2.D-20** | **Chặn 95%** — chưa xong hết thì tối đa 95%; đủ điều kiện hoàn tất mới nhảy 100% | Tránh "99% mãi không xong" |
| **M2.D-21** | Món huỷ / hết hàng: **trừ khỏi mẫu số** + hiện 1 dòng riêng *"1 món đã huỷ — quán sẽ liên hệ bạn"* | Đây là ngoại lệ bắt buộc của G-1: giấu việc huỷ món là lừa khách |
| **M2.D-22** | ETA hiện dạng **khoảng** (*"khoảng 20–30 phút"*), không phải số chính xác | Sai số 1 phút không thành lời hứa bị vỡ |
| **M2.D-23** | Trang tracking hiện **danh sách món + SL + giá + tổng tiền**, nhưng **KHÔNG hiện trạng thái từng món** | Thoả cả G-1 và nhu cầu "khách thấy được thay đổi khi quán sửa đơn" |
| **M2.D-24** | **Không hiện lộ trình / vị trí tài xế** | Chủ quán chốt: không cần |

### Công tắc ON/OFF (chủ quán yêu cầu bổ sung)

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-25** | Toggle ở Dashboard admin, 1 switch, mỗi lần đổi **ghi audit log** (dùng `audit.interceptor` có sẵn) | Truy được ai tắt, lúc nào |
| **M2.D-26** | **Khi OFF vẫn cho xem menu**, chỉ khoá nút đặt hàng + banner *"Quán tạm ngưng nhận đơn online — gọi {SĐT} để đặt trực tiếp"* | Chặn cả trang = mất khách vĩnh viễn; cho xem thì khách còn quay lại |
| **M2.D-27** | Chặn **2 lớp**: FE ẩn nút **VÀ** BE reject `409 ONLINE_ORDERING_DISABLED`. BE là nguồn sự thật | Chỉ ẩn FE thì F5 / gọi API tay vẫn submit được |
| **M2.D-28** | 2 kiểu OFF: **"đến hết hôm nay"** (tự ON lại 00:00 Asia/Ho_Chi_Minh) và **"cho tới khi tôi bật lại"** | Kiểu 1 chống việc quên bật lại |
| **M2.D-29** | Có ô **"Lý do tạm ngưng"** (tuỳ chọn), hiện cho khách | *"Hôm nay hết nguyên liệu"* thân thiện hơn thông báo khô |
| **M2.D-30** | **OFF tự động ngoài giờ mở cửa** (cấu hình theo thứ), manual override luôn thắng | 3h sáng không nhận đơn |
| **M2.D-31** | Đơn đang chạy **không bị ảnh hưởng** khi OFF | OFF chỉ chặn đơn mới |

### Thông báo (G-2)

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-32** | **L1 — In-app SSE + chuông + badge**, gửi tới **tất cả user role `admin` VÀ `order`** | Chủ quán chốt: cả admin và nhân viên order đều được biết |
| **M2.D-33** | **Chỉ role `admin` được xác nhận/từ chối đơn.** Role `order` chỉ xem | Chủ quán chốt |
| **M2.D-34** | **L2 — SMS** tới danh sách SĐT cấu hình được | Chủ quán chốt: cần thông báo về SĐT |
| **M2.D-35** | **L3 — Email** tới danh sách email cấu hình được | Chủ quán chốt: cần mail |
| **M2.D-36** | Leo thang: đơn còn `WAITING` sau **90s** → bắn SMS; sau **5 phút** → **tự động OFF nhận đơn online** + trang khách hiện *"Quán chưa phản hồi, vui lòng gọi {SĐT}"* | Giải đúng lo lắng gốc của chủ quán ("phòng trường hợp không có người làm"). Khách không chờ vô vọng rồi bực |
| **M2.D-37** | SMS/Email viết sau **interface `NotificationChannel`** (adapter) | Thêm Web Push / Telegram / Zalo sau chỉ là 1 file mới, không sửa logic |
| **M2.D-38** | Email **KHÔNG** dùng làm kênh chính cho đơn mới; thêm **email tổng hợp cuối ngày** (số đơn / doanh thu / tỉ lệ chuyển đổi) | Email đơn mới độ trễ 5–60s, thường không rung, dễ bỏ lọt |
| **M2.D-39** | Web Push (VAPID) và Telegram bot: **hoãn**, để ngỏ qua adapter M2.D-37 | Chủ quán chưa chọn. Cả 2 miễn phí + độ trễ 2–5s → nên bật sau nếu SMS tốn phí |

### Chống lạm dụng

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-40** | Rate limit: theo **IP** và theo **SĐT**. Tối đa **1 đơn đang mở / SĐT** | Chặn spam cơ bản |
| **M2.D-41** | **Blacklist SĐT** — TTL **24h**, tự xoá bằng cron (copy pattern [cron-jti-cleanup.ts](../apps/api/src/cli/cron-jti-cleanup.ts)); admin xoá tay được trước hạn | Chủ quán chốt 1 ngày |
| **M2.D-42** | **Chốt giá tại thời điểm submit** (snapshot vào request), giá menu đổi sau không ảnh hưởng đơn đã gửi | Tránh tranh chấp tiền |
| **M2.D-43** | Endpoint public **không trả** dữ liệu nội bộ (giá vốn, tồn, thông tin nhân viên) | Giảm bề mặt lộ dữ liệu |

### Sửa / huỷ đơn

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-44** | **Trước xác nhận**: khách tự sửa / huỷ thoải mái, không cần xin phép | Bếp chưa làm gì |
| **M2.D-45** | **Sau xác nhận**: khách bấm "Muốn sửa đơn" → hiện **SĐT quán + nút gọi 1 chạm** + *"Đơn đã vào bếp, vui lòng gọi quán để đổi"*. Không cho tự sửa | Bếp đang nấu |
| **M2.D-46** | Đổi **phương thức nhận hàng** (pickup ↔ ship) sau khi xác nhận: **phải gọi quán**, không tự đổi | Chủ quán chốt |
| **M2.D-47** | Admin sửa món ở bàn ship → trang tracking khách (poll 5–10s) hiện banner *"Quán vừa cập nhật đơn của bạn"* + danh sách món & tổng tiền mới | Chủ quán yêu cầu khách nhìn được thay đổi |
| **M2.D-48** | Admin **từ chối** đơn: bắt buộc nhập lý do; khách thấy lý do + SĐT quán | Không để khách treo không biết vì sao |

### Khoảng cách & phí ship

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-49** | Khách bấm **"Chia sẻ vị trí"** (Geolocation API) → lat/lng → tự sinh link Google Maps. Cũng cho phép **dán link Maps** hoặc chỉ gõ địa chỉ | Giá trị thật nằm ở toạ độ (tài xế bấm 1 nút ra đường đi), không phải cái link |
| **M2.D-50** | Khoảng cách = **Haversine × 1.3** (hệ số đường thực tế), miễn phí, không cần API trả tiền | Sai số 10–20%, đủ để phân vùng phí |
| **M2.D-51** | Có toạ độ → hiện *"Cách quán khoảng **5.2 km** — miễn phí ship"*. Không có toạ độ → hiện nguyên văn quy tắc *"trong {free_ship_km} km miễn phí, xa hơn có phụ phí"* | Không bịa số khi không đủ dữ liệu |
| **M2.D-52** | **KHÔNG auto-tính tiền ship.** Chỉ gợi ý, ghi rõ *"phí cuối do quán xác nhận khi gọi lại"* | Tránh tranh chấp; admin chốt |
| **M2.D-53** | Ngưỡng miễn phí là **setting** `free_ship_km` (mặc định **10**), không hardcode | Chủ quán đổi được không cần deploy |

### Analytics (G-4)

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-54** | **Self-host**, không dùng GA4 | GA4 bị adblock chặn ~20–30% → số liệu không khớp đơn thật |
| **M2.D-55** | Cookie first-party `session_id` + bảng event nhẹ; phễu 5 mốc: `view_menu → add_to_cart → begin_checkout → submit_order → confirmed` | Đo đúng chỗ rơi |
| **M2.D-56** | **Hash IP** (không lưu IP thô) | Giảm PII lưu trữ |
| **M2.D-57** | Metrics bắt buộc: khách/ngày, số đơn, **tỉ lệ chuyển đổi**, bước rơi nhiều nhất, thời gian ở trang, **món xem nhiều nhưng ít đặt**, **thời gian trung bình admin duyệt đơn** | 2 cái cuối là insight vận hành: ảnh/giá có vấn đề, và KPI phản hồi của quán |

---

## 3. Requirements mới (Milestone 2)

> Bổ sung vào `.vg/REQUIREMENTS.md` khi chạy `/gsd-new-milestone`. `REQ-A..H` là Milestone 1.

| REQ ID | Category | Requirement | Priority | Phase |
|---|---|---|---|---|
| **REQ-I** | Public Menu | Trang menu công khai không cần login, mobile-first, ảnh lớn, tab nhóm hàng dính, tìm kiếm, món hết hàng làm mờ (không ẩn), giỏ hàng nổi hiện tổng tiền | must-have | 07 |
| **REQ-J** | Checkout | Checkout 1 trang: họ tên, SĐT, chọn PICKUP/DELIVERY, địa chỉ + chia sẻ vị trí (chỉ khi DELIVERY), ghi chú; autofill từ `customer_token`; snapshot giá | must-have | 07 |
| **REQ-K** | Store Switch | Công tắc ON/OFF nhận đơn online + giờ mở cửa + lý do tạm ngưng; chặn 2 lớp FE/BE | must-have | 07 |
| **REQ-L** | Anti-abuse | Rate limit IP + SĐT, 1 đơn mở/SĐT, blacklist SĐT TTL 24h + cron dọn | must-have | 07 |
| **REQ-M** | Approval | Hàng chờ duyệt cho admin; xác nhận → tự cấp bàn (tự tạo bàn nếu hết) → items vào bếp; từ chối kèm lý do; chỉ role `admin` được duyệt | must-have | 08 |
| **REQ-N** | Notification | Thông báo 4 lớp (SSE cho admin+order / SMS / Email / leo thang + auto-OFF sau 5 phút) qua adapter `NotificationChannel` | must-have | 08 |
| **REQ-O** | Order Tracking | Trang `/o/<order_token>`: % trọng số đơn điệu, 5 mốc trạng thái, danh sách món không lộ trạng thái từng món, banner khi quán sửa đơn, nút gọi quán | must-have | 08 |
| **REQ-P** | Analytics | Phễu 5 bước + dashboard truy cập/chuyển đổi + email tổng hợp cuối ngày | should-have | 09 |

---

## 4. Thay đổi schema

> `synchronize: true` → thêm entity là tự áp dụng, **không viết migration**.

### 4.1 Bảng mới `store_settings`

```
store_settings
  key                  varchar(64)   PK
  value                text
  updated_at           datetime(6)
  updated_by_user_id   varchar(36)   NULL
  updated_by_full_name varchar(128)  NULL
```

Key khởi tạo (seed):

| Key | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `online_ordering_enabled` | bool | `true` | Công tắc chính |
| `online_ordering_off_mode` | enum | `MANUAL` | `MANUAL` \| `UNTIL_TOMORROW` |
| `online_ordering_off_reason` | text | `''` | Hiện cho khách |
| `online_ordering_off_until_ms` | bigint | `null` | Dùng khi `UNTIL_TOMORROW` |
| `open_hours` | json | `[]` | `[{dow:0..6, from:"09:00", to:"22:00"}]`, TZ Asia/Ho_Chi_Minh |
| `store_phone` | string | `''` | Hiện ở mọi chỗ khách cần gọi |
| `store_lat` / `store_lng` | decimal | `null` | Gốc tính Haversine |
| `free_ship_km` | int | `10` | M2.D-53 |
| `distance_factor` | decimal | `1.3` | M2.D-50 |
| `pickup_enabled` / `delivery_enabled` | bool | `true` | Tắt riêng từng phương thức |
| `escalate_sms_after_s` | int | `90` | M2.D-36 |
| `escalate_autooff_after_s` | int | `300` | M2.D-36 |
| `notify_sms_recipients` | json | `[]` | Danh sách SĐT |
| `notify_email_recipients` | json | `[]` | Danh sách email |
| `eta_pickup_min` / `eta_pickup_max` | int | `15` / `25` | Phút, cho M2.D-22 |
| `eta_delivery_min` / `eta_delivery_max` | int | `30` / `45` | Phút |

### 4.2 Bảng mới `online_order_requests`

```
online_order_requests
  id                    uuid          PK
  order_token           varchar(64)   UNIQUE   -- URL /o/<token>, random 32 byte hex
  customer_token        varchar(64)   INDEX    -- token thiết bị (localStorage)
  status                varchar(16)   INDEX    -- WAITING | CONFIRMED | REJECTED | CANCELLED_BY_CUSTOMER
  fulfillment_type      varchar(16)            -- PICKUP | DELIVERY
  customer_name         varchar(128)
  customer_phone        varchar(16)   INDEX
  customer_address      varchar(255)  NULL     -- NULL khi PICKUP
  customer_lat          decimal(10,7) NULL
  customer_lng          decimal(10,7) NULL
  customer_map_link     varchar(512)  NULL
  distance_km           decimal(6,2)  NULL     -- Haversine × factor
  customer_note         varchar(500)  NULL
  items_snapshot        json                   -- [{menu_item_id, code, name, unit_price, qty, note}]
  subtotal              int                    -- VND, chốt tại submit (M2.D-42)
  submitted_at          datetime(6)
  reviewed_at           datetime(6)   NULL
  reviewed_by_user_id   varchar(36)   NULL
  reviewed_by_full_name varchar(128)  NULL
  reject_reason         varchar(255)  NULL
  order_id              varchar(36)   NULL     -- FK → orders.id, set khi CONFIRMED
  max_progress_shown    int           DEFAULT 0 -- % đã hiện, đảm bảo đơn điệu (M2.D-19)
  ip_hash               varchar(64)            -- M2.D-56
  user_agent            varchar(255)
  created_at            datetime(6)

INDEX idx_oor_status_submitted (status, submitted_at)
```

### 4.3 Bảng mới `phone_blacklist`

```
phone_blacklist
  phone           varchar(16)   PK
  reason          varchar(255)
  created_at      datetime(6)
  expires_at      datetime(6)   INDEX   -- created_at + 24h (M2.D-41)
  created_by_user_id   varchar(36)  NULL
  created_by_full_name varchar(128) NULL
```

### 4.4 Bảng mới `site_events` (analytics)

```
site_events
  id            bigint        PK AUTO_INCREMENT
  session_id    varchar(64)   INDEX
  customer_token varchar(64)  NULL INDEX
  event         varchar(32)   INDEX   -- view_menu | view_item | add_to_cart | begin_checkout | submit_order | confirmed | rejected
  menu_item_id  varchar(36)   NULL    -- cho view_item / add_to_cart
  request_id    varchar(36)   NULL    -- cho submit_order trở đi
  ts_ms         bigint        INDEX
  ip_hash       varchar(64)
  user_agent    varchar(255)

INDEX idx_se_event_ts (event, ts_ms)
```

Retention: **180 ngày**, cron dọn (copy pattern `cron-audit-retention.ts`).

### 4.5 Cột thêm vào `orders` (bảng hiện có)

> Chỉ thêm cột, **không đổi cột nào đang dùng**. `customer_name / customer_address / customer_phone` **tái dùng nguyên trạng**.

```
source              varchar(16)   DEFAULT 'STAFF'   -- 'STAFF' | 'ONLINE'
fulfillment_type    varchar(16)   NULL              -- PICKUP | DELIVERY, chỉ khi source='ONLINE'
online_request_id   varchar(36)   NULL INDEX        -- ngược về online_order_requests.id
order_token         varchar(64)   NULL UNIQUE       -- copy từ request, để /o/<token> đọc được order
customer_lat        decimal(10,7) NULL
customer_lng        decimal(10,7) NULL
customer_map_link   varchar(512)  NULL
distance_km         decimal(6,2)  NULL
```

### 4.6 Bảng mới `notification_outbox`

```
notification_outbox
  id            uuid          PK
  request_id    varchar(36)   INDEX
  channel       varchar(16)            -- SSE | SMS | EMAIL
  recipient     varchar(255)
  level         varchar(4)             -- L1 | L2 | L3 | L4
  status        varchar(16)   INDEX    -- PENDING | SENT | FAILED
  attempts      int           DEFAULT 0
  last_error    varchar(500)  NULL
  scheduled_at  datetime(6)   INDEX    -- dùng cho leo thang (submit + 90s...)
  sent_at       datetime(6)   NULL
  created_at    datetime(6)
```

Lý do có outbox: SMS/email fail phải retry được và audit được; không bắn trực tiếp trong request handler.

---

## 5. API contracts

### 5.1 Public (không auth) — prefix `/api/public`

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/api/public/store` | `{ ordering_enabled, off_reason, store_phone, open_hours, is_open_now, pickup_enabled, delivery_enabled, free_ship_km, eta }` — FE gọi đầu tiên |
| `GET` | `/api/public/menu` | Cây nhóm hàng + món (chỉ field khách cần: `id, code, name, price, unit, images[], is_out_of_stock`) |
| `POST` | `/api/public/session` | Sinh/nhận `customer_token` + `session_id`; trả `{ customer_token, session_id }` |
| `POST` | `/api/public/events` | Batch ghi analytics event. Body `{ session_id, customer_token?, events:[{event, menu_item_id?, ts_ms}] }` |
| `POST` | `/api/public/orders` | Submit đơn. Body theo `OnlineOrderSubmit` (Zod ở `packages/schemas/src/public-orders.ts`). Trả `{ order_token }` |
| `GET` | `/api/public/orders/:order_token` | Trạng thái đơn — xem §6 response shape |
| `PATCH` | `/api/public/orders/:order_token` | Sửa đơn — **chỉ khi `status = WAITING`** (M2.D-44), ngoài ra `409 ORDER_ALREADY_CONFIRMED` |
| `DELETE` | `/api/public/orders/:order_token` | Khách tự huỷ — chỉ khi `WAITING` |
| `GET` | `/api/public/orders?customer_token=` | Lịch sử đơn của thiết bị (PII che theo M2.D-12) |

**Error codes mới** (thêm vào `packages/schemas/src/errors.ts`):
`ONLINE_ORDERING_DISABLED`, `STORE_CLOSED`, `PHONE_BLACKLISTED`, `TOO_MANY_REQUESTS`, `ORDER_ALREADY_OPEN_FOR_PHONE`, `ORDER_ALREADY_CONFIRMED`, `ORDER_TOKEN_NOT_FOUND`, `MENU_ITEM_UNAVAILABLE`, `NO_TABLE_AVAILABLE`.

### 5.2 Admin (auth) — prefix `/api/admin`

| Method | Path | Role | Mô tả |
|---|---|---|---|
| `GET` | `/api/admin/online-orders?status=WAITING` | `admin`, `order` | Hàng chờ duyệt |
| `POST` | `/api/admin/online-orders/:id/confirm` | **`admin` only** | Cấp bàn + sinh Order + items → `KITCHEN` (M2.D-02) |
| `POST` | `/api/admin/online-orders/:id/reject` | **`admin` only** | Body `{ reason }` bắt buộc |
| `GET` | `/api/admin/online-orders/stream` | `admin`, `order` | **SSE** — event `online_order.new`, `online_order.reviewed` |
| `GET`/`PUT` | `/api/admin/settings` | **`admin` only** | Đọc/ghi `store_settings`, ghi audit log |
| `GET`/`POST`/`DELETE` | `/api/admin/phone-blacklist` | **`admin` only** | Quản lý blacklist |
| `GET` | `/api/admin/analytics/funnel?from=&to=` | **`admin` only** | Phễu 5 bước + metrics §M2.D-57 |

Guard: dùng `admin.guard.ts` có sẵn cho các endpoint `admin only`; `RoleGate` FE dùng `allow={['admin','order']}` cho trang xem.

---

## 6. Thuật toán % tiến độ (tham chiếu triển khai)

```
WEIGHT = { KITCHEN: 0.15, COOKING: 0.45, READY: 0.80, SERVED: 1.00 }
// PENDING = 0. CANCELLED / OUT_OF_STOCK → loại khỏi mẫu số.

function computeProgress(order, fulfillment_type, max_shown):
    valid = items.filter(i => i.status not in [CANCELLED, OUT_OF_STOCK])
    cancelled_count = items.length - valid.length
    if valid.length == 0: return { percent: max_shown, cancelled_count }

    raw = sum(WEIGHT[i.status] ?? 0 for i in valid) / valid.length
    percent = round(raw * 100)

    // M2.D-15 — mốc hoàn tất khác nhau theo phương thức
    done_status = (fulfillment_type == 'PICKUP') ? [READY, SERVED] : [SERVED]
    all_done = valid.every(i => i.status in done_status)

    // M2.D-20 — chặn 95% khi chưa xong hết
    if not all_done: percent = min(percent, 95)
    else:            percent = 100

    // M2.D-19 — đơn điệu, không bao giờ tụt
    percent = max(percent, max_shown)
    persist max_progress_shown = percent

    return { percent, cancelled_count }
```

**Response `GET /api/public/orders/:order_token`:**

```json
{
  "order_token": "…",
  "status": "CONFIRMED",
  "stage": "COOKING",
  "stage_label": "Bếp đang làm món của bạn",
  "percent": 45,
  "fulfillment_type": "DELIVERY",
  "cancelled_count": 0,
  "cancelled_note": null,
  "eta_min": 30, "eta_max": 45,
  "items": [{ "name": "Bún bò", "qty": 2, "unit_price": 45000 }],
  "subtotal": 90000,
  "updated_at_ms": 1753000000000,
  "store_phone": "09xxxxxxxx",
  "reject_reason": null
}
```

> ⚠️ **Response TUYỆT ĐỐI không chứa `status` của từng item** (M2.D-23). Đây là điều kiện của G-1 — reviewer phải chặn PR nào leak field này.

**5 mốc `stage`:** `RECEIVED` (Đã nhận đơn) → `CONFIRMED` (Quán đã xác nhận) → `COOKING` (Bếp đang làm) → `DELIVERING` (Đang giao) / `READY_FOR_PICKUP` (Mời bạn đến lấy) → `COMPLETED` (Hoàn tất). `REJECTED` là nhánh riêng.

---

## 7. Luồng xác nhận đơn (chi tiết)

```
Khách submit
  └─ validate: ordering_enabled ✓ / is_open_now ✓ / phone not blacklisted ✓
     / rate limit ✓ / no open order for phone ✓ / món còn hàng ✓
  └─ INSERT online_order_requests (status=WAITING, items_snapshot, subtotal)
  └─ INSERT notification_outbox:
        L1 SSE   → scheduled_at = now          (admin + order)
        L3 EMAIL → scheduled_at = now          (recipients)
        L2 SMS   → scheduled_at = now + 90s    (chỉ gửi nếu vẫn WAITING)
        L4 AUTOOFF → scheduled_at = now + 300s (chỉ chạy nếu vẫn WAITING)
  └─ trả { order_token } → FE redirect /o/<order_token>

Admin bấm XÁC NHẬN  (chỉ role admin)
  └─ TRANSACTION:
       kind = (fulfillment_type == PICKUP) ? 'takeaway' : 'delivery'
       bàn = SELECT ... FROM restaurant_tables
               WHERE kind = :kind AND is_active AND NOT kiotviet_locked
                 AND id NOT IN (SELECT table_id FROM orders WHERE closed_at IS NULL)
               ORDER BY code ASC LIMIT 1 FOR UPDATE
       nếu không có bàn → TỰ TẠO bàn mới (M2.D-05) + audit log
       order = getOrCreateOpenOrder(bàn.id, creator = admin)        // code hiện có
       set order.source='ONLINE', fulfillment_type, order_token,
           customer_* (name/phone/address/lat/lng/map_link/distance_km),
           online_request_id
       add items từ items_snapshot (giá = unit_price đã chốt)
       transition tất cả items PENDING → KITCHEN                     // bếp thấy từ đây
       request.status = CONFIRMED, order_id, reviewed_by, reviewed_at
     COMMIT  (retry qua runWithRetry khi deadlock — M2.D-06)
  └─ SSE event online_order.reviewed → mọi client admin/order
  └─ huỷ các outbox L2/L4 còn PENDING của request này

Admin bấm TỪ CHỐI  (chỉ role admin, bắt buộc lý do)
  └─ request.status = REJECTED, reject_reason, reviewed_by
  └─ huỷ outbox L2/L4; trang khách hiện lý do + SĐT quán

Quá 90s vẫn WAITING   → gửi SMS tới notify_sms_recipients
Quá 300s vẫn WAITING  → set online_ordering_enabled = false
                        + off_reason = "Quán đang quá tải, vui lòng gọi {SĐT}"
                        + audit log actor = SYSTEM
                        + trang khách hiện "Quán chưa phản hồi, vui lòng gọi {SĐT}"
```

**Cron/worker cần thêm:** `cron-notification-outbox.ts` chạy mỗi **15s** (quét `scheduled_at <= now AND status = PENDING`), `cron-blacklist-cleanup.ts` mỗi giờ, `cron-site-events-retention.ts` mỗi ngày, `cron-daily-summary-email.ts` 23:30 Asia/Ho_Chi_Minh.

---

## 8. Màn hình mới

### Public (không auth) — route mới ngoài `ProtectedShell` ([App.tsx:29](../apps/web/src/App.tsx#L29))

| Route | Màn hình | Ghi chú |
|---|---|---|
| `/m` | **PublicMenuPage** | Ảnh lớn, tab nhóm hàng dính, tìm kiếm, "Bán chạy / Món mới", món hết hàng **làm mờ chứ không ẩn**, giỏ hàng nổi hiện tổng tiền (G-3) |
| `/m/checkout` | **CheckoutPage** | Họ tên, SĐT, chọn PICKUP/DELIVERY, địa chỉ + nút "Chia sẻ vị trí" + dán link Maps (chỉ DELIVERY), ghi chú, autofill từ `customer_token`, gợi ý "thêm nước không?" |
| `/o/:token` | **OrderTrackingPage** | % + 5 mốc + danh sách món (không lộ trạng thái từng món) + banner "Quán vừa cập nhật đơn" + nút gọi quán. Poll 5–10s |
| `/m/history` | **MyOrdersPage** | Lịch sử đơn theo `customer_token`, PII che một phần |

### Admin

| Route | Màn hình | Role |
|---|---|---|
| `/admin/online-orders` | **OnlineOrdersQueuePage** — hàng chờ duyệt, chuông + badge + đếm giây chờ, nút Xác nhận / Từ chối | xem: `admin`+`order`; hành động: `admin` |
| `/admin/settings` | **StoreSettingsPage** — công tắc ON/OFF, kiểu OFF, lý do, giờ mở cửa, toạ độ quán, `free_ship_km`, danh sách SMS/email | `admin` |
| `/admin/analytics` | **AnalyticsPage** — phễu 5 bước, khách/ngày, tỉ lệ chuyển đổi, món xem nhiều ít đặt, thời gian duyệt trung bình | `admin` |

Dashboard hiện có: thêm **badge đơn chờ duyệt** + widget công tắc ON/OFF (truy cập nhanh).

---

## 9. Phase breakdown

### Phase 07 — Public Menu, Checkout & Công tắc nhận đơn  (Size: L)

**Depends on:** 02 (menu), 03 (bàn), 04 (order lifecycle)
**REQ:** REQ-I, REQ-J, REQ-K, REQ-L

Success criteria:
- [ ] `/m` xem được menu **không cần login**; món hết hàng làm mờ, không ẩn
- [ ] Khách xem menu được **trước khi** bị hỏi bất kỳ thông tin cá nhân nào (M2.D-08)
- [ ] `customer_token` sinh lần đầu, lưu localStorage vĩnh viễn, autofill lần sau (M2.D-09)
- [ ] Checkout chọn được PICKUP / DELIVERY; PICKUP **không** hỏi địa chỉ (M2.D-15)
- [ ] Nút "Chia sẻ vị trí" trả lat/lng + sinh link Maps; tính được `distance_km` bằng Haversine × 1.3 (M2.D-50)
- [ ] Có toạ độ → hiện số km + kết luận phí; không có → hiện quy tắc text (M2.D-51). **Không auto-tính tiền** (M2.D-52)
- [ ] Submit tạo `online_order_requests` với `status=WAITING`, `items_snapshot` + `subtotal` **chốt giá** (M2.D-42)
- [ ] Công tắc OFF: FE khoá nút **và** BE trả `409 ONLINE_ORDERING_DISABLED` (M2.D-27) — test bằng cách gọi API tay
- [ ] OFF vẫn xem được menu + hiện banner kèm lý do và SĐT quán (M2.D-26, M2.D-29)
- [ ] "OFF đến hết hôm nay" tự ON lại 00:00 Asia/Ho_Chi_Minh (M2.D-28)
- [ ] Ngoài giờ mở cửa tự chặn đặt; manual override thắng (M2.D-30)
- [ ] Rate limit IP + SĐT hoạt động; 1 SĐT chỉ 1 đơn mở (M2.D-40)
- [ ] Blacklist SĐT chặn submit; cron xoá sau 24h (M2.D-41)
- [ ] Mọi thay đổi setting ghi audit log (M2.D-25)
- [ ] Endpoint public không leak field nội bộ (M2.D-43)

### Phase 08 — Duyệt đơn, Thông báo & Theo dõi đơn  (Size: L)

**Depends on:** 07
**REQ:** REQ-M, REQ-N, REQ-O

Success criteria:
- [ ] Hàng chờ duyệt hiện đơn `WAITING` kèm đồng hồ đếm thời gian chờ
- [ ] Role `order` **xem được nhưng không** xác nhận/từ chối được (M2.D-33) — test bằng gọi API trực tiếp
- [ ] Xác nhận → cấp bàn trống đầu tiên theo `code` ASC đúng `kind` (M2.D-04, M2.D-14)
- [ ] Hết bàn → **tự tạo bàn mới** + audit log; khách không bao giờ bị chặn (M2.D-05)
- [ ] 2 admin xác nhận đồng thời **không** cấp trùng bàn (M2.D-06) — test bằng 2 request song song
- [ ] Xác nhận → items chuyển `KITCHEN`, **bếp thấy ngay** trên KitchenPage
- [ ] Đơn `WAITING` **không** xuất hiện ở sơ đồ bàn / bếp / history / doanh thu (M2.D-01) — test đếm doanh thu trước/sau khi có 5 đơn WAITING
- [ ] Từ chối bắt buộc lý do; khách thấy lý do + SĐT quán (M2.D-48)
- [ ] SSE bắn tới **mọi** client role `admin` và `order`, độ trễ < 2s, có chuông + badge (M2.D-32)
- [ ] SMS gửi tới `notify_sms_recipients`; Email gửi tới `notify_email_recipients`
- [ ] Đơn WAITING > 90s → SMS bắn (M2.D-36); đã duyệt trước 90s thì **không** bắn
- [ ] Đơn WAITING > 300s → **tự động OFF** nhận đơn + audit log actor SYSTEM + khách thấy thông báo gọi quán (M2.D-36)
- [ ] SMS/Email đi qua `notification_outbox`, fail thì retry, có log lỗi (M2.D-37)
- [ ] `/o/<token>` hiện % **đúng công thức trọng số** §6; % **không bao giờ tụt** (M2.D-19); tối đa 95% khi chưa xong (M2.D-20)
- [ ] PICKUP đạt 100% khi tất cả món `READY`; DELIVERY khi tất cả `SERVED` (M2.D-15)
- [ ] Món huỷ trừ khỏi mẫu số + hiện dòng "1 món đã huỷ — quán sẽ liên hệ bạn" (M2.D-21)
- [ ] Response `/api/public/orders/:token` **không chứa** status từng item (M2.D-23) — assert trong test
- [ ] Khách sửa/huỷ được khi `WAITING`; sau `CONFIRMED` chỉ hiện SĐT + nút gọi (M2.D-44, M2.D-45)
- [ ] Admin sửa món ở bàn ship → trang khách hiện banner "Quán vừa cập nhật đơn của bạn" + món/tổng tiền mới trong ≤10s (M2.D-47)
- [ ] Không hiện lộ trình / vị trí tài xế (M2.D-24)

### Phase 09 — Analytics & Phễu chuyển đổi  (Size: S)

**Depends on:** 07, 08
**REQ:** REQ-P

Success criteria:
- [ ] `session_id` first-party cookie; 5 event ghi đúng mốc (M2.D-55)
- [ ] IP lưu dạng **hash**, không lưu thô (M2.D-56)
- [ ] Dashboard hiện: khách/ngày, số đơn, tỉ lệ chuyển đổi, bước rơi nhiều nhất, thời gian ở trang
- [ ] Hiện **món xem nhiều nhưng ít đặt** (dấu hiệu ảnh/giá có vấn đề)
- [ ] Hiện **thời gian trung bình admin duyệt đơn** (KPI G-2)
- [ ] Email tổng hợp cuối ngày 23:30 Asia/Ho_Chi_Minh (M2.D-38)
- [ ] Cron dọn `site_events` > 180 ngày

---

## 10. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Đơn chưa duyệt lọt vào doanh thu / bếp | **Cao** | M2.D-01 bảng riêng — rủi ro gần như bị loại về mặt cấu trúc. Vẫn phải có test §Phase 08 đếm doanh thu |
| Response tracking leak status từng món (vỡ G-1) | **Cao** | Assert trong test + reviewer chặn PR (M2.D-23) |
| Tự tạo bàn không kiểm soát → sơ đồ bàn rác | Trung bình | Audit log mỗi lần tạo; admin gộp/ẩn bàn thủ công được; cảnh báo khi > 10 bàn ship active |
| SMS tốn phí ngoài dự kiến | Trung bình | SMS chỉ ở L2 sau 90s; theo dõi số tin/ngày; bật Web Push (miễn phí) để giảm phụ thuộc SMS |
| Race cấp bàn khi 2 admin duyệt cùng lúc | Trung bình | Transaction + `FOR UPDATE` + `runWithRetry` (M2.D-06) + test song song |
| Auto-OFF làm mất đơn ngoài giờ cao điểm | Trung bình | Ngưỡng là setting; SMS đã bắn trước đó 3.5 phút; audit log rõ actor SYSTEM |
| iOS Safari xoá localStorage sau ~7 ngày | Thấp | Đã chấp nhận mất lịch sử (M2.D-10) |
| Khách gửi toạ độ sai / từ chối chia sẻ vị trí | Thấp | Fallback text quy tắc phí (M2.D-51); phí cuối do admin chốt (M2.D-52) |

---

## 11. Việc còn để ngỏ (không block phase 07)

1. **Web Push (VAPID)** và **Telegram bot** — cả hai **miễn phí**, độ trễ 2–5s, về được máy khi tắt web. Đã có adapter M2.D-37 nên thêm sau là 1 file. Nên bật khi thấy hoá đơn SMS đáng kể. Web Push trên iPhone cần khách/admin "Thêm vào màn hình chính" (PWA).
2. **Đo khoảng cách chính xác** — nếu Haversine × 1.3 sai quá nhiều trong thực tế, chuyển sang OSRM self-host (miễn phí) hoặc Google Distance Matrix (tốn phí, cần thẻ).
3. **Ngưỡng `free_ship_km`** — spec đặt mặc định **10 km**. Chủ quán nói "4–10 km miễn phí, xa hơn thu phí" → hiểu là **miễn phí đến 10 km**. Sửa được ở `/admin/settings` không cần deploy; xác nhận lại khi làm phase 07.
4. **Gọi tự động (voice call)** ở lớp L5 nếu SMS vẫn bị bỏ lọt — chưa cần.
5. **Gộp bàn ship tự tạo** — nếu sau vài tuần sơ đồ bàn phình to, cân nhắc cơ chế tự ẩn bàn ship rỗng.

---

## 12. Bước tiếp theo (chạy trên máy khác)

```bash
git pull

# 1. Mở milestone 2 — dùng file này làm input context
/gsd-new-milestone

# 2. Phase 07 nặng UI → dùng ui-phase thay vì spec-phase thường
/gsd-ui-phase 07

# 3. Sau khi spec phase 07 xong
/gsd-execute-phase 07
```

Khi chạy `/gsd-new-milestone`, chỉ nó đọc file này: mọi quyết định **M2.D-01..57** đã chốt, không cần hỏi lại. Chỉ 5 mục ở §11 là còn để ngỏ.
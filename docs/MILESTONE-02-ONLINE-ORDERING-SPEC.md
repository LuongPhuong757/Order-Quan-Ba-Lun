# Milestone 2 — Đặt Hàng Online (Khách Tự Order Từ Xa)

**Trạng thái:** SPEC ĐÃ CHỐT (vòng 5) — chờ `/gsd:new-milestone` để sinh phase artifacts trong `.planning/`
**Ngày chốt:** 2026-07-29 (vòng 1–3), bổ sung vòng 4 cùng ngày
**Nguồn:** Phiên thảo luận trực tiếp với chủ quán (4 vòng hỏi–đáp)
**Phạm vi:** 3 phase (07, 08, 09), tiếp nối Milestone 1 (POS nội bộ)
**Nhánh git:** `feat/online-ordering` — mọi thay đổi của tính năng này làm trên nhánh này, tính năng khác làm trên `main`

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

### Vòng 4 — thanh toán, phí ship, leo thang (chốt 2026-07-29)

> 6 lỗ hổng phát hiện khi soi lại spec đối chiếu code thật. **M2.D-59, M2.D-60 ghi đè quyết định cũ** → phải ghi vào `OVERRIDE-DEBT.md`.

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-58** | **Thanh toán COD, thu trực tiếp** giữa người ship (hoặc quán, với PICKUP) và khách. Xong thì nhân viên bấm **Thanh toán trên bàn `SHIP-NN` / `TAKE-NN` như bàn thường** (`closed_at` + `is_paid = true`, [orders.service.ts:77](../apps/api/src/modules/orders/orders.service.ts#L77)). **Không** QR/cổng thanh toán trong M2. Thêm cột `orders.payment_method` varchar(16) DEFAULT `'CASH'` để sau nâng cấp không phải đổi schema | Chủ quán chốt. Tái dùng 100% luồng thanh toán đã chạy production, không có luồng tiền thứ hai. Spec cũ **thiếu hoàn toàn** phần này → bàn ship sẽ treo mở vô thời hạn |
| **M2.D-59** | **Blacklist SĐT là thao tác tay.** Admin tự thêm khi thấy 1 SĐT bom đơn / spam nhiều lần. **Ghi đè M2.D-41**: bỏ TTL tự động 24h và bỏ `cron-blacklist-cleanup.ts`; bản ghi tồn tại **cho tới khi admin xoá tay** | Admin đã chủ động thêm thì tự xoá sau 24h là phản trực giác — SĐT bom đơn hôm nay mai lại bom được. Cột `expires_at` vẫn giữ (NULL = vĩnh viễn) để sau muốn chặn tạm thời thì có sẵn |
| **M2.D-60** | **Auto-OFF sau 30 phút** không phản hồi, không phải 5 phút. **Ghi đè M2.D-36**: `escalate_autooff_after_s` mặc định `1800`. Ghi audit log actor `SYSTEM` + hiện trong lịch sử để biết đã tắt lúc nào, vì đơn nào. **Không tự ON lại** — admin bật tay ở `/admin/settings` | 5 phút quá ngắn: giờ cao điểm admin bấm bill 5 phút là bình thường → tắt oan cả kênh online, mất hết khách sau đó. 30 phút thì gần như chắc chắn quán không có người trực. SMS ở 90s giữ nguyên nên vẫn không bỏ lọt đơn |
| **M2.D-61** | **Kiểm tra lại tồn kho tại bước duyệt.** Màn hàng chờ hiện cảnh báo *"2 món đã hết hàng"*; admin tick bỏ món; `confirm` re-validate trong cùng transaction. Món bị bỏ → tracking hiện dòng *"N món đã huỷ — quán sẽ liên hệ bạn"* (M2.D-21). Hết toàn bộ món → **buộc Từ chối**, không cho xác nhận đơn rỗng | Spec cũ chỉ validate tồn kho **lúc submit**. Khách gửi 19:00, admin duyệt 19:04 món đã hết → §7 add items thẳng vào bếp, bếp nhận món không có hàng |
| **M2.D-62** | **Phí ship tách riêng, KHÔNG tính vào doanh thu món.** Thêm cột `orders.ship_fee int DEFAULT 0`; admin nhập ở màn duyệt (ô "Phí ship" cạnh nút Xác nhận), sửa được tới trước khi thanh toán. Tổng bill = tiền món + `ship_fee`. Báo cáo ngày hiện **2 dòng: tiền món / tiền ship** | M2.D-52 nói "admin chốt phí khi gọi lại" nhưng spec cũ không có field nào để nhập. Gộp vào doanh thu chung thì doanh thu món bị phồng, không so được với đơn tại quán |
| **M2.D-63** | SMS dùng **brandname eSMS / Viettel** (chủ quán chốt). Viết sau `SmsChannel` (adapter M2.D-37) với **2 implementation**: `ConsoleSmsChannel` (ghi log + `notification_outbox`, dùng khi chưa có brandname) và `EsmsChannel` (prod), chọn bằng env `SMS_DRIVER`. Email tổng hợp cuối ngày dùng **Gmail SMTP app password** | Đăng ký brandname mất 1–2 tuần → **không được để việc đó block phase 09**. Có console driver thì test được toàn bộ luồng leo thang trước, cắm brandname sau là đổi 1 biến env |

### Vòng 5 — tách subdomain & giao diện trang khách (chốt 2026-07-29)

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-64** | **2 frontend, 1 backend.** Thêm app mới `apps/shop` (Vite + React) cho trang khách; `apps/web` giữ nguyên 100% cho POS/quản lý. Dùng **chung 1 API container, chung 1 DB, chung `packages/schemas`** | Bundle khách nhẹ (không kéo theo code POS), không lộ cấu trúc route admin trong JS công khai, và giao diện kiểu Lotteria không đụng vào design hệ thống của trang quản lý |
| **M2.D-65** | Tên miền: **`quanbalun.site` giữ nguyên cho quản lý** (kể cả `www.`), **`order.quanbalun.site` cho trang khách**. Cần thêm DNS A record cho `order.` trỏ về IP VPS; Caddy tự cấp cert | Nhân viên không phải đổi link đang dùng. Dùng subdomain thật (`order.`) chứ không phải `-order` vì `-order` sẽ là **một tên miền khác phải mua thêm** |
| **M2.D-66** | API chọn thư mục static **theo `Host` header**: host bắt đầu `order.` → serve `shop-dist`, còn lại → `web-dist` ([main.ts:41](../apps/api/src/main.ts#L41)). Caddy thêm site block thứ hai cho `order.{$DOMAIN}`, vẫn `reverse_proxy api:3001` | Các prefix API hiện tại là `/auth`, `/orders`, `/menu`… **không có prefix `/api` chung** → Caddy không phân biệt được static và API để tự serve file. Chọn theo Host trong API là đổi ít nhất, deploy vẫn 1 container |
| **M2.D-67** | `ALLOWED_ORIGIN` đổi thành **danh sách** (phân tách dấu phẩy), gồm cả origin admin và origin order ([csrf-origin.middleware.ts:26](../apps/api/src/common/middleware/csrf-origin.middleware.ts#L26)). Trang khách gọi API **cùng origin** (`order.quanbalun.site/api/public/...`) → **không cần CORS** | Middleware hiện chỉ so 1 string → submit đơn từ order subdomain sẽ bị chặn |
| **M2.D-68** | Cookie JWT **giữ nguyên host-only** (`cookieOptions` không set `domain`, `sameSite: 'strict'` — [jwt.service.ts:53](../apps/api/src/modules/auth/jwt.service.ts#L53)). Tuyệt đối **không** đổi sang `domain: '.quanbalun.site'` | Host-only nghĩa là token admin **không bao giờ** được gửi tới subdomain trang khách. Đây là lợi ích an toàn có sẵn — đổi sang domain-wide là tự mở lỗ hổng |
| **M2.D-69** | **Sửa `Permissions-Policy` trong [Caddyfile:24](../Caddyfile#L24)**: hiện là `geolocation=()` — **chặn hoàn toàn Geolocation API**. Site block của `order.` phải dùng `geolocation=(self)` | Nếu không sửa, nút "Chia sẻ vị trí" (M2.D-49) **im lặng không chạy** trên production dù code đúng. Site block admin giữ `geolocation=()` |

### Vòng 5 — giao diện trang khách (tham chiếu lotteria.vn)

| ID | Quyết định | Lý do |
|---|---|---|
| **M2.D-70** | Giao diện `apps/shop` lấy tham chiếu từ **https://www.lotteria.vn** (chủ quán chọn): kiểu chuỗi fast-food — banner lớn đầu trang, chip danh mục dính, lưới món ảnh to, giỏ hàng dính đáy. **Không** kế thừa design system của `apps/web` | Trang khách và trang POS có mục tiêu ngược nhau: POS tối ưu mật độ thông tin, trang khách tối ưu giữ khách và ham muốn gọi món (G-3) |
| **M2.D-71** | Design ref đã có **2 màn** (chủ quán gửi 2026-07-29): `lotteria.vn/category/set` (lưới món) và `lotteria.vn/cart` (giỏ hàng). Đặc tả rút ra ở **§8-bis**. **Còn thiếu:** trang chủ/banner, chi tiết món, bước 2 checkout, **và bản mobile** — chụp bổ sung trước khi làm phase 08, lưu vào `docs/design-refs/lotteria/` rồi chạy `/gsd:ui-phase` | Có ảnh thật mới bám được khoảng cách, cỡ chữ, độ đậm. Thiếu bản mobile là rủi ro lớn nhất vì khách gần như 100% vào bằng điện thoại |

> **Chưa chốt:** màu thương hiệu Quán Bà Lùn. Lotteria dùng đỏ coral `#E4453A`. Cần logo quán để lấy màu chính.

---

## 8-bis. Đặc tả giao diện trang khách (rút từ ảnh Lotteria)

> ⚙️ **Đã hiện thực hoá thành token thật (2026-07-29):**
> `apps/shop/src/styles/tokens.css` là **nguồn sự thật khi code**, kèm
> `apps/shop/DESIGN.md` (bản xuất song song để validator `design-antipatterns`
> đối chiếu). Bảng dưới đây là đặc tả gốc rút từ ảnh — **3 màu trong bảng đã
> được sửa vì không đạt WCAG AA**, xem cột "Ghi chú". Khi code thì bám
> `tokens.css`, không bám bảng này.

### Design tokens

| Token | Giá trị | Ghi chú |
|---|---|---|
| Màu chính | đỏ coral ~`#E4453A` | Nút, giá, tab active, badge. **Chờ logo quán để chốt lại**. ⚠️ Đã tách thành thang 3 bậc: `#E4453A` chỉ dùng cho **giá ≥24px đậm + viền** (tương phản 3.87:1 — chỉ đạt với chữ lớn); nút và chữ đỏ nhỏ dùng `#CC3529` (4.91:1 ✓AA, chữ trắng trên nó 5.11:1 ✓AA); hover dùng `#A82419` |
| Nền trang | trắng / hồng rất nhạt `#FFF9F8` | Giữ nguyên |
| Chữ chính / phụ | `#222` / `#888` | Tên món đen đậm, mô tả xám nhỏ. ⚠️ `#888` trên nền trang chỉ được **3.40:1**, cần 4.5:1 → **đã đổi thành `#726865`** (5.19:1). Chữ chính đổi `#1C1917` cho ấm hơn, khớp nền hồng |
| Bo góc | card món 12px, ảnh danh mục 16px, nút 8px | |
| Viền card | xám rất nhạt `#EEE`, không dùng đổ bóng nặng | |
| Nền ảnh danh mục | pastel **khác nhau từng nhóm** (tím/xanh/hồng/mint/vàng/cam/kem) | Lotteria làm vậy để dải danh mục sinh động |

### Trang menu (`order.quanbalun.site/`)

1. **Header dính**: logo trái; desktop có nav ngang chữ IN HOA, tab đang xem **gạch chân đỏ + chữ đỏ**; phải là icon tròn viền nhạt. **Bỏ icon tài khoản** của Lotteria (ta không có login — M2.D-09), thay bằng **"Đơn của tôi"** trỏ `/history`. Giữ icon giỏ hàng có badge số món.
2. **Dải danh mục cuộn ngang**: mỗi nhóm = ảnh vuông bo góc trên nền pastel + tên dưới; nhóm đang chọn **viền đỏ + chữ đỏ**. Nguồn = `menu_groups` hiện có. Nhóm chưa có ảnh → lấy ảnh món bán chạy nhất của nhóm làm đại diện.
3. **Banner thông báo** (nền hồng nhạt, icon trái, tiêu đề đậm + dòng phụ xám): tái dùng đúng chỗ này cho **banner tạm ngưng nhận đơn** (M2.D-26, M2.D-29) và banner ngoài giờ mở cửa.
4. **Lưới món**: desktop 4 cột, **mobile 2 cột**. Card = ảnh món lớn nền trắng → tên món đậm ~18px → 1–2 dòng mô tả xám → **giá đỏ đậm ~24px** → **nút vuông đỏ dấu `+`** góc phải dưới. Món hết hàng: ảnh làm mờ + nhãn "Hết hàng", **nút `+` disable** (M2.D-31 giữ nguyên: làm mờ chứ không ẩn).
5. **Không có** giá gạch ngang / combo / coupon / "Bestseller · Khuyến mãi" như Lotteria — quán chưa có khuyến mãi. Riêng **"Bán chạy"** thì tính được từ dữ liệu bán thật.

### Giỏ hàng + checkout (`/cart` → `/checkout`)

1. **Header thu gọn**: chỉ logo + **stepper 2 bước**, bước hiện tại tô đỏ. Lotteria đặt tên bước 2 là "Thanh toán" — **ta đổi thành "Thông tin nhận hàng"** vì không thu tiền online (M2.D-58).
2. **Cột trái**: tiêu đề "GIỎ HÀNG CỦA BẠN (N món)" + link đỏ "+ THÊM MÓN"; empty state có ảnh minh hoạ; box **"Ghi chú đơn hàng"** input gạch chân → map vào `customer_note`.
3. **Cột phải dính** (mobile: xếp xuống dưới, nút "TIẾP TỤC" **dính đáy màn hình**):
   - Card **"Nhận hàng"** — chọn PICKUP / DELIVERY; DELIVERY mới hiện địa chỉ + nút **"Chia sẻ vị trí"** (M2.D-49); có icon bút sửa như Lotteria.
   - Card **tổng tiền**: `Tạm tính` → `Phí giao hàng` → `Tổng cộng` đậm. **Phí giao hàng hiển thị theo M2.D-51/52**: có toạ độ và ≤ `free_ship_km` → *"Miễn phí"*; xa hơn hoặc không có toạ độ → *"Quán xác nhận khi gọi lại"*. **Tuyệt đối không tự điền số tiền ship.**
   - Nút đỏ full-width chữ IN HOA.
   - **Bỏ** card "Tùy chọn" (toggle lấy dụng cụ/tương cà/tương ớt) — quán không có; nếu muốn thì gộp vào ô ghi chú.
4. **Bỏ** checkbox "Đồng ý cho phép website thu thập thông tin cá nhân" của Lotteria: ta chỉ lưu thông tin khách tự nhập để giao hàng, không bán/chia sẻ. Thay bằng 1 dòng xám nhỏ dưới nút: *"Thông tin của bạn chỉ dùng để giao đơn này."*

---

## 3. Requirements mới (Milestone 2)

> ✅ **Đã bổ sung vào `.vg/REQUIREMENTS.md` (đã gỡ — xem git history)** (2026-07-29) kèm acceptance criteria AC-Q1..AC-P5 và traceability matrix. `REQ-A..H` là Milestone 1.

| REQ ID | Category | Requirement | Priority | Phase |
|---|---|---|---|---|
| **REQ-Q** | Shop Infra | Tách frontend trang khách thành app riêng `apps/shop` trên subdomain `order.<domain>`, dùng chung 1 API + 1 DB (M2.D-64..69) | must-have | 07 |
| **REQ-I** | Public Menu | Trang menu công khai không cần login, mobile-first, ảnh lớn, tab nhóm hàng dính, tìm kiếm, món hết hàng làm mờ (không ẩn), giỏ hàng nổi hiện tổng tiền | must-have | 08 |
| **REQ-J** | Checkout | Checkout 1 trang: họ tên, SĐT, chọn PICKUP/DELIVERY, địa chỉ + chia sẻ vị trí (chỉ khi DELIVERY), ghi chú; autofill từ `customer_token`; snapshot giá | must-have | 08 |
| **REQ-K** | Store Switch | Công tắc ON/OFF nhận đơn online + giờ mở cửa + lý do tạm ngưng; chặn 2 lớp FE/BE | must-have | 08 |
| **REQ-L** | Anti-abuse | Rate limit IP + SĐT, 1 đơn mở/SĐT, blacklist SĐT thêm/xoá tay (M2.D-59) | must-have | 08 |
| **REQ-M** | Approval | Hàng chờ duyệt cho admin; xác nhận → tự cấp bàn (tự tạo bàn nếu hết) → items vào bếp; từ chối kèm lý do; chỉ role `admin` được duyệt; re-check tồn kho + nhập phí ship | must-have | 09 |
| **REQ-N** | Notification | Thông báo 4 lớp (SSE cho admin+order / SMS / Email / leo thang + auto-OFF sau 30 phút) qua adapter `NotificationChannel` | must-have | 09 |
| **REQ-O** | Order Tracking | Trang `/o/<order_token>`: % trọng số đơn điệu, 5 mốc trạng thái, danh sách món không lộ trạng thái từng món, banner khi quán sửa đơn, nút gọi quán | must-have | 09 |
| **REQ-P** | Analytics | Phễu 5 bước + dashboard truy cập/chuyển đổi + email tổng hợp cuối ngày | should-have | 10 |

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
| `escalate_autooff_after_s` | int | `1800` | **M2.D-60** (30 phút, ghi đè 300s của M2.D-36) |
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
  expires_at      datetime(6)   NULL INDEX  -- M2.D-59: NULL = vĩnh viễn (blacklist thêm tay).
                                            -- Giữ cột để sau muốn chặn tạm thời thì có sẵn.
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
ship_fee            int           DEFAULT 0         -- M2.D-62, admin nhập; KHÔNG vào doanh thu món
payment_method      varchar(16)   DEFAULT 'CASH'    -- M2.D-58, chỗ ngỏ cho chuyển khoản sau này
```

> `ship_fee` mặc định 0 nên đơn tại quán không bị ảnh hưởng. Mọi query doanh thu hiện có (`PAID_SQL` ở [orders.service.ts:77](../apps/api/src/modules/orders/orders.service.ts#L77)) **giữ nguyên** = tiền món; báo cáo ngày cộng thêm 1 dòng `SUM(ship_fee)` riêng.

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

Quá 90s vẫn WAITING   → gửi SMS tới notify_sms_recipients (eSMS/Viettel — M2.D-63)
Quá 1800s vẫn WAITING → set online_ordering_enabled = false, off_mode = MANUAL  (M2.D-60)
                        + off_reason = "Quán đang quá tải, vui lòng gọi {SĐT}"
                        + audit log actor = SYSTEM, kèm request_id gây ra
                        + trang khách hiện "Quán chưa phản hồi, vui lòng gọi {SĐT}"
                        + KHÔNG tự ON lại — admin bật tay ở /admin/settings
```

**Bổ sung vào bước XÁC NHẬN (M2.D-61):** trước khi add items, re-query tồn kho từng `menu_item_id` trong `items_snapshot`; món đã hết → trả về FE danh sách để admin tick bỏ, hoặc bỏ theo lựa chọn admin rồi ghi `cancelled_count` cho tracking. Bỏ hết món → chặn, buộc dùng Từ chối.

**Bổ sung vào bước THANH TOÁN (M2.D-58, M2.D-62):** đơn online kết thúc bằng chính luồng thanh toán hiện có trên bàn `SHIP-NN` / `TAKE-NN`. Ô "Phí ship" (`ship_fee`) nhập ở màn duyệt, sửa được tới trước khi bấm Thanh toán. Tổng thu = tiền món + `ship_fee`.

**Cron/worker cần thêm:** `cron-notification-outbox.ts` chạy mỗi **15s** (quét `scheduled_at <= now AND status = PENDING`), `cron-site-events-retention.ts` mỗi ngày, `cron-daily-summary-email.ts` 23:30 Asia/Ho_Chi_Minh. **Bỏ** `cron-blacklist-cleanup.ts` (M2.D-59 — blacklist thêm tay, không tự hết hạn).

---

## 8. Màn hình mới

### Public (không auth) — app riêng `apps/shop` trên `order.quanbalun.site` (M2.D-64, M2.D-65)

> Vì là domain riêng nên **bỏ prefix `/m`** của bản spec cũ. Không dính gì tới `ProtectedShell` của `apps/web` ([App.tsx:29](../apps/web/src/App.tsx#L29)) — hai app hoàn toàn tách.

| Route | Màn hình | Ghi chú |
|---|---|---|
| `/` | **MenuPage** | Ảnh lớn, dải danh mục cuộn ngang dính, tìm kiếm, "Bán chạy", món hết hàng **làm mờ chứ không ẩn**, giỏ hàng nổi hiện tổng tiền (G-3). Chi tiết §8-bis |
| `/cart` | **CartPage** | Giỏ hàng + ghi chú đơn + stepper bước 1 |
| `/checkout` | **CheckoutPage** | Họ tên, SĐT, chọn PICKUP/DELIVERY, địa chỉ + nút "Chia sẻ vị trí" + dán link Maps (chỉ DELIVERY), autofill từ `customer_token`, gợi ý "thêm nước không?" |
| `/o/:token` | **OrderTrackingPage** | % + 5 mốc + danh sách món (không lộ trạng thái từng món) + banner "Quán vừa cập nhật đơn" + nút gọi quán. Poll 5–10s |
| `/history` | **MyOrdersPage** | Lịch sử đơn theo `customer_token`, PII che một phần |

### Admin

| Route | Màn hình | Role |
|---|---|---|
| `/admin/online-orders` | **OnlineOrdersQueuePage** — hàng chờ duyệt, chuông + badge + đếm giây chờ, nút Xác nhận / Từ chối | xem: `admin`+`order`; hành động: `admin` |
| `/admin/settings` | **StoreSettingsPage** — công tắc ON/OFF, kiểu OFF, lý do, giờ mở cửa, toạ độ quán, `free_ship_km`, danh sách SMS/email | `admin` |
| `/admin/analytics` | **AnalyticsPage** — phễu 5 bước, khách/ngày, tỉ lệ chuyển đổi, món xem nhiều ít đặt, thời gian duyệt trung bình | `admin` |

Dashboard hiện có: thêm **badge đơn chờ duyệt** + widget công tắc ON/OFF (truy cập nhanh).

---

## 9. Phase breakdown

> ⚠️ **Số phase đã đổi (chốt 2026-07-29).** Bản spec vòng 1–3 viết 3 phase 07/08/09. Sau vòng 5, phần hạ tầng subdomain được tách thành phase riêng nên thành **4 phase: 07 hạ tầng → 08 menu/checkout → 09 duyệt đơn → 10 analytics**. `.vg/ROADMAP.md` (đã gỡ — xem git history) và `.vg/REQUIREMENTS.md` (đã gỡ — xem git history) đã theo số mới.

### Phase 07 — Hạ tầng trang khách: `apps/shop` + subdomain  (Size: M) — **mới, vòng 5**

**Depends on:** None (độc lập, làm song song với việc trên `main` được)
**REQ:** REQ-Q

Success criteria: xem `.vg/ROADMAP.md` (đã gỡ — xem git history) § Phase 07. Gồm M2.D-64..69 — dựng `apps/shop`, serve static theo `Host`, DNS + cert subdomain, `ALLOWED_ORIGIN` dạng danh sách, và **sửa `Permissions-Policy` để geolocation chạy được**.

> Tách riêng để bắt sớm 3 bug hạ tầng đã phát hiện, trước khi đổ công vào UI.

### Phase 08 — Public Menu, Checkout & Công tắc nhận đơn  (Size: L) — *trước đây là 07*

**Depends on:** 02 (menu), 03 (bàn), **07 (hạ tầng)**
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
- [ ] Blacklist SĐT chặn submit; admin **thêm/xoá tay** được ở `/admin/settings`, bản ghi **không tự hết hạn** (M2.D-59)
- [ ] Mọi thay đổi setting ghi audit log (M2.D-25)
- [ ] Endpoint public không leak field nội bộ (M2.D-43)
- [ ] `order.quanbalun.site` trả **shop-dist**, `quanbalun.site` trả **web-dist** — cùng 1 container (M2.D-66)
- [ ] Bundle của `order.` **không chứa** route/code trang quản lý — kiểm bằng grep chuỗi `/dashboard`, `/kitchen` trong JS đã build (M2.D-64)
- [ ] Đăng nhập admin ở apex → cookie `ssp_token` **không** được gửi khi request tới `order.` (M2.D-68) — kiểm bằng DevTools Network
- [ ] Submit đơn từ `order.` **không** bị chặn CSRF; origin lạ vẫn bị chặn (M2.D-67)
- [ ] Nút "Chia sẻ vị trí" **xin quyền và lấy được toạ độ trên HTTPS production** (M2.D-69) — đây là bug sẽ xảy ra nếu quên sửa `Permissions-Policy`

### Phase 09 — Duyệt đơn, Thông báo & Theo dõi đơn  (Size: L) — *trước đây là 08*

**Depends on:** 04 (order lifecycle), 08
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
- [ ] Đơn WAITING > **1800s (30 phút)** → **tự động OFF** nhận đơn + audit log actor SYSTEM kèm request_id + khách thấy thông báo gọi quán; **không** tự ON lại (M2.D-60)
- [ ] SMS chạy được với `SMS_DRIVER=console` (chưa có brandname) và `SMS_DRIVER=esms` (prod) — đổi driver **không** sửa logic (M2.D-63)
- [ ] Duyệt đơn có món đã hết hàng → hiện cảnh báo, admin tick bỏ món, tracking hiện "N món đã huỷ"; bỏ hết món thì **chặn xác nhận** (M2.D-61)
- [ ] Admin nhập được **phí ship**; tổng thu = tiền món + `ship_fee`; báo cáo ngày tách 2 dòng, doanh thu món **không** gồm phí ship (M2.D-62)
- [ ] Đơn online thanh toán bằng **đúng luồng thanh toán bàn hiện có**; sau thanh toán bàn `SHIP-NN` đóng (`closed_at` + `is_paid`), không còn treo mở (M2.D-58)
- [ ] SMS/Email đi qua `notification_outbox`, fail thì retry, có log lỗi (M2.D-37)
- [ ] `/o/<token>` hiện % **đúng công thức trọng số** §6; % **không bao giờ tụt** (M2.D-19); tối đa 95% khi chưa xong (M2.D-20)
- [ ] PICKUP đạt 100% khi tất cả món `READY`; DELIVERY khi tất cả `SERVED` (M2.D-15)
- [ ] Món huỷ trừ khỏi mẫu số + hiện dòng "1 món đã huỷ — quán sẽ liên hệ bạn" (M2.D-21)
- [ ] Response `/api/public/orders/:token` **không chứa** status từng item (M2.D-23) — assert trong test
- [ ] Khách sửa/huỷ được khi `WAITING`; sau `CONFIRMED` chỉ hiện SĐT + nút gọi (M2.D-44, M2.D-45)
- [ ] Admin sửa món ở bàn ship → trang khách hiện banner "Quán vừa cập nhật đơn của bạn" + món/tổng tiền mới trong ≤10s (M2.D-47)
- [ ] Không hiện lộ trình / vị trí tài xế (M2.D-24)

### Phase 10 — Analytics & Phễu chuyển đổi  (Size: S) — *trước đây là 09*

**Depends on:** 08, 09
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
| Đơn chưa duyệt lọt vào doanh thu / bếp | **Cao** | M2.D-01 bảng riêng — rủi ro gần như bị loại về mặt cấu trúc. Vẫn phải có test §Phase 09 đếm doanh thu |
| Response tracking leak status từng món (vỡ G-1) | **Cao** | Assert trong test + reviewer chặn PR (M2.D-23) |
| Tự tạo bàn không kiểm soát → sơ đồ bàn rác | Trung bình | Audit log mỗi lần tạo; admin gộp/ẩn bàn thủ công được; cảnh báo khi > 10 bàn ship active |
| SMS tốn phí ngoài dự kiến | Trung bình | SMS chỉ ở L2 sau 90s; theo dõi số tin/ngày; bật Web Push (miễn phí) để giảm phụ thuộc SMS |
| Race cấp bàn khi 2 admin duyệt cùng lúc | Trung bình | Transaction + `FOR UPDATE` + `runWithRetry` (M2.D-06) + test song song |
| Auto-OFF làm mất đơn ngoài giờ cao điểm | Trung bình | Ngưỡng là setting; SMS đã bắn trước đó 3.5 phút; audit log rõ actor SYSTEM |
| iOS Safari xoá localStorage sau ~7 ngày | Thấp | Đã chấp nhận mất lịch sử (M2.D-10) |
| Khách gửi toạ độ sai / từ chối chia sẻ vị trí | Thấp | Fallback text quy tắc phí (M2.D-51); phí cuối do admin chốt (M2.D-52) |

---

## 11. Việc còn để ngỏ (không block phase 07/08)

1. **Web Push (VAPID)** và **Telegram bot** — cả hai **miễn phí**, độ trễ 2–5s, về được máy khi tắt web. Đã có adapter M2.D-37 nên thêm sau là 1 file. Nên bật khi thấy hoá đơn SMS đáng kể. Web Push trên iPhone cần khách/admin "Thêm vào màn hình chính" (PWA).
2. **Đo khoảng cách chính xác** — nếu Haversine × 1.3 sai quá nhiều trong thực tế, chuyển sang OSRM self-host (miễn phí) hoặc Google Distance Matrix (tốn phí, cần thẻ).
3. **Ngưỡng `free_ship_km`** — spec đặt mặc định **10 km**. Chủ quán nói "4–10 km miễn phí, xa hơn thu phí" → hiểu là **miễn phí đến 10 km**. Sửa được ở `/admin/settings` không cần deploy; xác nhận lại khi làm phase 08.
4. **Gọi tự động (voice call)** ở lớp L5 nếu SMS vẫn bị bỏ lọt — chưa cần.
5. **Gộp bàn ship tự tạo** — nếu sau vài tuần sơ đồ bàn phình to, cân nhắc cơ chế tự ẩn bàn ship rỗng.
6. **Màu thương hiệu Quán Bà Lùn** (vòng 5) — cần logo quán để chốt màu chính thay cho đỏ coral của Lotteria.
7. **Ảnh design ref bản mobile** (vòng 5) — thiếu 2 ảnh quan trọng nhất, xem `docs/design-refs/lotteria/` (chưa tạo).
8. **Thanh toán online** (vòng 4) — M2.D-58 chốt COD; cột `payment_method` đã để ngỏ cho VietQR/chuyển khoản sau này.

---

## 12. Bước tiếp theo

> ⚠️ **2026-07-29 — đã gỡ VGFlow, chuyển sang GSD.** Toàn bộ artifact `.vg/`
> (ROADMAP, REQUIREMENTS, phases 07/08 PLAN + PROGRESS) đã xoá khỏi cây làm
> việc; tra lại bằng `git show <commit>:.vg/ROADMAP.md`. Kế hoạch phase làm
> lại bằng GSD trong `.planning/`.

✅ **Đã xong (2026-07-29):** nhánh `feat/online-ordering`, phase 07 đã dựng `apps/shop` + `packages/utils` + 4 trang placeholder + `GET /api/public/health`.

```bash
git checkout feat/online-ordering     # mọi việc của tính năng này làm trên nhánh này

# Khởi tạo GSD cho milestone 2 (đọc file spec này làm input)
/gsd:new-milestone

# Mỗi phase: chốt scope → lập kế hoạch → chạy → nghiệm thu
/gsd:discuss-phase
/gsd:plan-phase
/gsd:execute-phase
/gsd:verify-work

# Phase UI cần design ref trước: bỏ ảnh chụp vào docs/design-refs/lotteria/
# (thiếu 2 ảnh bản mobile) rồi dùng /gsd:ui-phase để sinh UI-SPEC.md
```

Mọi quyết định **M2.D-01..71** đã chốt, không cần hỏi lại. Còn để ngỏ: 8 mục §11 (gồm màu thương hiệu + ảnh mobile).

**Nội dung phase 07 — checklist hạ tầng** (M2.D-64..69):
1. `apps/shop` — Vite + React mới, dùng chung `packages/schemas`
2. DNS A record `order.quanbalun.site` → IP VPS
3. Caddyfile: site block `order.{$DOMAIN}` với **`geolocation=(self)`** (M2.D-69) — site block admin giữ `geolocation=()`
4. `.env.production`: `ALLOWED_ORIGIN` thành danh sách 2 origin (M2.D-67)
5. `Dockerfile`: build thêm `apps/shop` → `shop-dist`
6. `main.ts`: chọn thư mục static theo `Host` header (M2.D-66)
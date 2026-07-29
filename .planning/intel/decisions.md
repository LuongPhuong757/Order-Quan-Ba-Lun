# Decisions (ADR-style, extracted from SPEC)

> Source doc: `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md` (type: SPEC, precedence 0, manifest override)
> All 71 decisions below are treated as **LOCKED** at synthesis level. Authority: spec §12 line 677 —
> "Mọi quyết định **M2.D-01..71** đã chốt, không cần hỏi lại"; header line 3 — "SPEC ĐÃ CHỐT (vòng 5)";
> §2 line 28 — "**Không đổi** mà không ghi vào `OVERRIDE-DEBT.md`".
> Vietnamese decision text is preserved **verbatim** — do not translate, do not paraphrase when planning.
>
> Override chain inside the doc (newer wins, see `.planning/INGEST-CONFLICTS.md` INFO bucket):
> - **M2.D-59 supersedes M2.D-41** (phone blacklist: manual only, no 24h TTL, no `cron-blacklist-cleanup.ts`)
> - **M2.D-60 supersedes M2.D-36** (auto-OFF threshold 1800s, not 300s)

---

## Scope: data-architecture

**M2.D-01** — status: LOCKED — source: `docs/MILESTONE-02-ONLINE-ORDERING-SPEC.md:34`
Quyết định: Đơn chờ duyệt lưu ở bảng **staging `online_order_requests`** riêng, KHÔNG nằm trong `orders`
Lý do: 48 điểm query `orders` (doanh thu / history / sơ đồ bàn / bếp) — nếu nhét đơn chưa duyệt vào đó, mỗi chỗ quên filter = đơn chưa duyệt lọt vào doanh thu. Cách ly rẻ hơn sửa bug.

**M2.D-02** — status: LOCKED — source: `...SPEC.md:35`
Quyết định: Admin xác nhận → sinh `Order` thật qua **`getOrCreateOpenOrder()` hiện có**, rồi add items qua path hiện có, rồi chuyển toàn bộ item `PENDING → KITCHEN`
Lý do: Tái dùng code đã chạy production, không viết state machine thứ hai

**M2.D-03** — status: LOCKED — source: `...SPEC.md:36`
Quyết định: Đơn chờ duyệt **KHÔNG chiếm bàn**. Bàn chỉ được cấp tại thời điểm xác nhận
Lý do: `getOrCreateOpenOrder` chỉ cho 1 order mở/bàn (orders.service.ts:206) → nếu gán bàn lúc submit, 3 đơn spam khoá hết bàn ship = DoS miễn phí

**M2.D-04** — status: LOCKED — source: `...SPEC.md:37`
Quyết định: Cấp bàn: quét bàn cùng `kind` theo **`code` tăng dần**, chọn bàn trống đầu tiên (`closed_at IS NULL` không tồn tại), bỏ qua bàn `kiotviet_locked = true` hoặc `is_active = false`
Lý do: Theo `code` ổn định, không đổi khi kéo bàn trên sơ đồ

**M2.D-05** — status: LOCKED — source: `...SPEC.md:38`
Quyết định: **Hết bàn trống → tự tạo bàn mới** `SHIP-NN` / `TAKE-NN` (NN = số kế tiếp), `is_active = true`, `x/y` xếp cuối sơ đồ. Ghi audit log.
Lý do: Chủ quán chọn: không được để khách bị chặn vì thiếu bàn

**M2.D-06** — status: LOCKED — source: `...SPEC.md:39`
Quyết định: Cấp bàn chạy trong **1 transaction + row lock**, retry theo `runWithRetry()` có sẵn
Lý do: 2 admin bấm xác nhận cùng lúc không được cấp trùng bàn

**M2.D-07** — status: LOCKED — source: `...SPEC.md:40`
Quyết định: `synchronize: true` — **không viết migration file**
Lý do: Theo `data-source.ts:39` (quyết định sẵn của project)

---

## Scope: customer-flow

**M2.D-08** — status: LOCKED — source: `...SPEC.md:46`
Quyết định: **Xem menu trước, hỏi thông tin sau.** Không hỏi SĐT/địa chỉ trước khi khách xem được menu
Lý do: Hỏi PII ở cửa → rời trang 50–70%. Vẫn thu đủ 100% thông tin ở bước checkout (G-3)

**M2.D-09** — status: LOCKED — source: `...SPEC.md:47`
Quyết định: **Không login, không OTP.** Token thiết bị (`customer_token`) random ≥32 byte hex sinh lần đầu vào web, lưu localStorage **vĩnh viễn**; dùng để autofill thông tin + xem lịch sử đơn của thiết bị
Lý do: Ma sát thấp nhất

**M2.D-10** — status: LOCKED — source: `...SPEC.md:48`
Quyết định: **Chấp nhận mất lịch sử** nếu khách xoá localStorage / đổi máy. KHÔNG làm cơ chế tra lịch sử bằng SĐT
Lý do: Chủ quán chốt. Tránh lỗ hổng "biết SĐT = xem được đơn người khác"

**M2.D-11** — status: LOCKED — source: `...SPEC.md:49`
Quyết định: Trang theo dõi đơn: `/o/<order_token>`, token riêng cho từng đơn, random ≥32 byte hex (KHÔNG dùng UUID tuần tự)
Lý do: Không đoán được URL đơn người khác

**M2.D-12** — status: LOCKED — source: `...SPEC.md:50`
Quyết định: Hiển thị lại PII đã lưu ở dạng **che một phần**: `0912***678`, địa chỉ rút gọn
Lý do: Điện thoại dễ bị người bên cạnh nhìn

**M2.D-13** — status: LOCKED — source: `...SPEC.md:51`
Quyết định: 2 phương thức nhận hàng: **PICKUP** (đến quán lấy) / **DELIVERY** (ship tận nơi)
Lý do: Chủ quán yêu cầu

**M2.D-14** — status: LOCKED — source: `...SPEC.md:52`
Quyết định: PICKUP → cấp bàn `kind = 'takeaway'`. DELIVERY → cấp bàn `kind = 'delivery'`
Lý do: Đơn pickup không ăn vào hạn mức bàn ship

**M2.D-15** — status: LOCKED — source: `...SPEC.md:53`
Quyết định: PICKUP **không hỏi địa chỉ**, mốc 100% là `READY` (*"Món đã xong, mời bạn đến lấy"*). DELIVERY mốc 100% là `SERVED`
Lý do: Ngữ nghĩa khác nhau thật

**M2.D-16** — status: LOCKED — source: `...SPEC.md:54`
Quyết định: Menu online = **menu nội bộ**, không tách cờ `is_online`
Lý do: Chủ quán chốt: giống nhau

---

## Scope: progress-bar (G-1)

**M2.D-17** — status: LOCKED — source: `...SPEC.md:60`
Quyết định: % tính theo **trọng số trạng thái**, không phải `số món SERVED / tổng món`
Lý do: Cách chia đơn thuần nhảy giật cục (0% suốt 10 phút rồi vọt 50%) — khách sốt ruột đúng lúc cần tránh

**M2.D-18** — status: LOCKED — source: `...SPEC.md:61`
Quyết định: Trọng số: `KITCHEN 0.15`, `COOKING 0.45`, `READY 0.80`, `SERVED 1.00`. `% = Σ trọng số / số món hợp lệ`
Lý do: Thanh chạy mượt, luôn nhích lên

**M2.D-19** — status: LOCKED — source: `...SPEC.md:62`
Quyết định: **Đơn điệu** — cache `max_progress_shown` phía server, không bao giờ tụt (kể cả món bị trả về bếp)
Lý do: Thấy % tụt = mất niềm tin ngay

**M2.D-20** — status: LOCKED — source: `...SPEC.md:63`
Quyết định: **Chặn 95%** — chưa xong hết thì tối đa 95%; đủ điều kiện hoàn tất mới nhảy 100%
Lý do: Tránh "99% mãi không xong"

**M2.D-21** — status: LOCKED — source: `...SPEC.md:64`
Quyết định: Món huỷ / hết hàng: **trừ khỏi mẫu số** + hiện 1 dòng riêng *"1 món đã huỷ — quán sẽ liên hệ bạn"*
Lý do: Đây là ngoại lệ bắt buộc của G-1: giấu việc huỷ món là lừa khách

**M2.D-22** — status: LOCKED — source: `...SPEC.md:65`
Quyết định: ETA hiện dạng **khoảng** (*"khoảng 20–30 phút"*), không phải số chính xác
Lý do: Sai số 1 phút không thành lời hứa bị vỡ

**M2.D-23** — status: LOCKED — source: `...SPEC.md:66`
Quyết định: Trang tracking hiện **danh sách món + SL + giá + tổng tiền**, nhưng **KHÔNG hiện trạng thái từng món**
Lý do: Thoả cả G-1 và nhu cầu "khách thấy được thay đổi khi quán sửa đơn"
Ràng buộc kèm theo (spec:452, :603, :629): response `/api/public/orders/:token` TUYỆT ĐỐI không chứa `status` từng item — **assert trong test**, reviewer chặn PR leak field này.

**M2.D-24** — status: LOCKED — source: `...SPEC.md:67`
Quyết định: **Không hiện lộ trình / vị trí tài xế**
Lý do: Chủ quán chốt: không cần

---

## Scope: store-switch (ON/OFF)

**M2.D-25** — status: LOCKED — source: `...SPEC.md:73`
Quyết định: Toggle ở Dashboard admin, 1 switch, mỗi lần đổi **ghi audit log** (dùng `audit.interceptor` có sẵn)
Lý do: Truy được ai tắt, lúc nào

**M2.D-26** — status: LOCKED — source: `...SPEC.md:74`
Quyết định: **Khi OFF vẫn cho xem menu**, chỉ khoá nút đặt hàng + banner *"Quán tạm ngưng nhận đơn online — gọi {SĐT} để đặt trực tiếp"*
Lý do: Chặn cả trang = mất khách vĩnh viễn; cho xem thì khách còn quay lại

**M2.D-27** — status: LOCKED — source: `...SPEC.md:75`
Quyết định: Chặn **2 lớp**: FE ẩn nút **VÀ** BE reject `409 ONLINE_ORDERING_DISABLED`. BE là nguồn sự thật
Lý do: Chỉ ẩn FE thì F5 / gọi API tay vẫn submit được

**M2.D-28** — status: LOCKED — source: `...SPEC.md:76`
Quyết định: 2 kiểu OFF: **"đến hết hôm nay"** (tự ON lại 00:00 Asia/Ho_Chi_Minh) và **"cho tới khi tôi bật lại"**
Lý do: Kiểu 1 chống việc quên bật lại

**M2.D-29** — status: LOCKED — source: `...SPEC.md:77`
Quyết định: Có ô **"Lý do tạm ngưng"** (tuỳ chọn), hiện cho khách
Lý do: *"Hôm nay hết nguyên liệu"* thân thiện hơn thông báo khô

**M2.D-30** — status: LOCKED — source: `...SPEC.md:78`
Quyết định: **OFF tự động ngoài giờ mở cửa** (cấu hình theo thứ), manual override luôn thắng
Lý do: 3h sáng không nhận đơn

**M2.D-31** — status: LOCKED — source: `...SPEC.md:79`
Quyết định: Đơn đang chạy **không bị ảnh hưởng** khi OFF
Lý do: OFF chỉ chặn đơn mới

---

## Scope: notification (G-2)

**M2.D-32** — status: LOCKED — source: `...SPEC.md:85`
Quyết định: **L1 — In-app SSE + chuông + badge**, gửi tới **tất cả user role `admin` VÀ `order`**
Lý do: Chủ quán chốt: cả admin và nhân viên order đều được biết

**M2.D-33** — status: LOCKED — source: `...SPEC.md:86`
Quyết định: **Chỉ role `admin` được xác nhận/từ chối đơn.** Role `order` chỉ xem
Lý do: Chủ quán chốt

**M2.D-34** — status: LOCKED — source: `...SPEC.md:87`
Quyết định: **L2 — SMS** tới danh sách SĐT cấu hình được
Lý do: Chủ quán chốt: cần thông báo về SĐT

**M2.D-35** — status: LOCKED — source: `...SPEC.md:88`
Quyết định: **L3 — Email** tới danh sách email cấu hình được
Lý do: Chủ quán chốt: cần mail

**M2.D-36** — status: LOCKED, **PARTIALLY SUPERSEDED BY M2.D-60** — source: `...SPEC.md:89`
Quyết định (verbatim, nguyên bản): Leo thang: đơn còn `WAITING` sau **90s** → bắn SMS; sau **5 phút** → **tự động OFF nhận đơn online** + trang khách hiện *"Quán chưa phản hồi, vui lòng gọi {SĐT}"*
Lý do: Giải đúng lo lắng gốc của chủ quán ("phòng trường hợp không có người làm"). Khách không chờ vô vọng rồi bực
⚠️ Hiệu lực: **90s → SMS giữ nguyên**. Ngưỡng auto-OFF **5 phút KHÔNG còn hiệu lực** — M2.D-60 đổi thành **1800s (30 phút)**.

**M2.D-37** — status: LOCKED — source: `...SPEC.md:90`
Quyết định: SMS/Email viết sau **interface `NotificationChannel`** (adapter)
Lý do: Thêm Web Push / Telegram / Zalo sau chỉ là 1 file mới, không sửa logic

**M2.D-38** — status: LOCKED — source: `...SPEC.md:91`
Quyết định: Email **KHÔNG** dùng làm kênh chính cho đơn mới; thêm **email tổng hợp cuối ngày** (số đơn / doanh thu / tỉ lệ chuyển đổi)
Lý do: Email đơn mới độ trễ 5–60s, thường không rung, dễ bỏ lọt

**M2.D-39** — status: LOCKED — source: `...SPEC.md:92`
Quyết định: Web Push (VAPID) và Telegram bot: **hoãn**, để ngỏ qua adapter M2.D-37
Lý do: Chủ quán chưa chọn. Cả 2 miễn phí + độ trễ 2–5s → nên bật sau nếu SMS tốn phí

---

## Scope: anti-abuse

**M2.D-40** — status: LOCKED — source: `...SPEC.md:98`
Quyết định: Rate limit: theo **IP** và theo **SĐT**. Tối đa **1 đơn đang mở / SĐT**
Lý do: Chặn spam cơ bản

**M2.D-41** — status: **SUPERSEDED BY M2.D-59** — source: `...SPEC.md:99`
Quyết định (verbatim, nguyên bản — KHÔNG còn hiệu lực): **Blacklist SĐT** — TTL **24h**, tự xoá bằng cron (copy pattern cron-jti-cleanup.ts); admin xoá tay được trước hạn
Lý do: Chủ quán chốt 1 ngày
⚠️ Không triển khai theo quyết định này. Nguồn sự thật: **M2.D-59** (thêm/xoá tay, không TTL, không cron).

**M2.D-42** — status: LOCKED — source: `...SPEC.md:100`
Quyết định: **Chốt giá tại thời điểm submit** (snapshot vào request), giá menu đổi sau không ảnh hưởng đơn đã gửi
Lý do: Tránh tranh chấp tiền

**M2.D-43** — status: LOCKED — source: `...SPEC.md:101`
Quyết định: Endpoint public **không trả** dữ liệu nội bộ (giá vốn, tồn, thông tin nhân viên)
Lý do: Giảm bề mặt lộ dữ liệu

---

## Scope: order-edit-cancel

**M2.D-44** — status: LOCKED — source: `...SPEC.md:107`
Quyết định: **Trước xác nhận**: khách tự sửa / huỷ thoải mái, không cần xin phép
Lý do: Bếp chưa làm gì

**M2.D-45** — status: LOCKED — source: `...SPEC.md:108`
Quyết định: **Sau xác nhận**: khách bấm "Muốn sửa đơn" → hiện **SĐT quán + nút gọi 1 chạm** + *"Đơn đã vào bếp, vui lòng gọi quán để đổi"*. Không cho tự sửa
Lý do: Bếp đang nấu

**M2.D-46** — status: LOCKED — source: `...SPEC.md:109`
Quyết định: Đổi **phương thức nhận hàng** (pickup ↔ ship) sau khi xác nhận: **phải gọi quán**, không tự đổi
Lý do: Chủ quán chốt

**M2.D-47** — status: LOCKED — source: `...SPEC.md:110`
Quyết định: Admin sửa món ở bàn ship → trang tracking khách (poll 5–10s) hiện banner *"Quán vừa cập nhật đơn của bạn"* + danh sách món & tổng tiền mới
Lý do: Chủ quán yêu cầu khách nhìn được thay đổi

**M2.D-48** — status: LOCKED — source: `...SPEC.md:111`
Quyết định: Admin **từ chối** đơn: bắt buộc nhập lý do; khách thấy lý do + SĐT quán
Lý do: Không để khách treo không biết vì sao

---

## Scope: distance-ship-fee

**M2.D-49** — status: LOCKED — source: `...SPEC.md:117`
Quyết định: Khách bấm **"Chia sẻ vị trí"** (Geolocation API) → lat/lng → tự sinh link Google Maps. Cũng cho phép **dán link Maps** hoặc chỉ gõ địa chỉ
Lý do: Giá trị thật nằm ở toạ độ (tài xế bấm 1 nút ra đường đi), không phải cái link

**M2.D-50** — status: LOCKED — source: `...SPEC.md:118`
Quyết định: Khoảng cách = **Haversine × 1.3** (hệ số đường thực tế), miễn phí, không cần API trả tiền
Lý do: Sai số 10–20%, đủ để phân vùng phí

**M2.D-51** — status: LOCKED — source: `...SPEC.md:119`
Quyết định: Có toạ độ → hiện *"Cách quán khoảng **5.2 km** — miễn phí ship"*. Không có toạ độ → hiện nguyên văn quy tắc *"trong {free_ship_km} km miễn phí, xa hơn có phụ phí"*
Lý do: Không bịa số khi không đủ dữ liệu

**M2.D-52** — status: LOCKED — source: `...SPEC.md:120`
Quyết định: **KHÔNG auto-tính tiền ship.** Chỉ gợi ý, ghi rõ *"phí cuối do quán xác nhận khi gọi lại"*
Lý do: Tránh tranh chấp; admin chốt

**M2.D-53** — status: LOCKED — source: `...SPEC.md:121`
Quyết định: Ngưỡng miễn phí là **setting** `free_ship_km` (mặc định **10**), không hardcode
Lý do: Chủ quán đổi được không cần deploy

---

## Scope: analytics (G-4)

**M2.D-54** — status: LOCKED — source: `...SPEC.md:127`
Quyết định: **Self-host**, không dùng GA4
Lý do: GA4 bị adblock chặn ~20–30% → số liệu không khớp đơn thật

**M2.D-55** — status: LOCKED — source: `...SPEC.md:128`
Quyết định: Cookie first-party `session_id` + bảng event nhẹ; phễu 5 mốc: `view_menu → add_to_cart → begin_checkout → submit_order → confirmed`
Lý do: Đo đúng chỗ rơi

**M2.D-56** — status: LOCKED — source: `...SPEC.md:129`
Quyết định: **Hash IP** (không lưu IP thô)
Lý do: Giảm PII lưu trữ

**M2.D-57** — status: LOCKED — source: `...SPEC.md:130`
Quyết định: Metrics bắt buộc: khách/ngày, số đơn, **tỉ lệ chuyển đổi**, bước rơi nhiều nhất, thời gian ở trang, **món xem nhiều nhưng ít đặt**, **thời gian trung bình admin duyệt đơn**
Lý do: 2 cái cuối là insight vận hành: ảnh/giá có vấn đề, và KPI phản hồi của quán

---

## Scope: vòng 4 — payment, ship fee, escalation (chốt 2026-07-29)

**M2.D-58** — status: LOCKED — source: `...SPEC.md:138`
Quyết định: **Thanh toán COD, thu trực tiếp** giữa người ship (hoặc quán, với PICKUP) và khách. Xong thì nhân viên bấm **Thanh toán trên bàn `SHIP-NN` / `TAKE-NN` như bàn thường** (`closed_at` + `is_paid = true`, orders.service.ts:77). **Không** QR/cổng thanh toán trong M2. Thêm cột `orders.payment_method` varchar(16) DEFAULT `'CASH'` để sau nâng cấp không phải đổi schema
Lý do: Chủ quán chốt. Tái dùng 100% luồng thanh toán đã chạy production, không có luồng tiền thứ hai. Spec cũ **thiếu hoàn toàn** phần này → bàn ship sẽ treo mở vô thời hạn

**M2.D-59** — status: LOCKED, **SUPERSEDES M2.D-41** — source: `...SPEC.md:139`
Quyết định: **Blacklist SĐT là thao tác tay.** Admin tự thêm khi thấy 1 SĐT bom đơn / spam nhiều lần. **Ghi đè M2.D-41**: bỏ TTL tự động 24h và bỏ `cron-blacklist-cleanup.ts`; bản ghi tồn tại **cho tới khi admin xoá tay**
Lý do: Admin đã chủ động thêm thì tự xoá sau 24h là phản trực giác — SĐT bom đơn hôm nay mai lại bom được. Cột `expires_at` vẫn giữ (NULL = vĩnh viễn) để sau muốn chặn tạm thời thì có sẵn

**M2.D-60** — status: LOCKED, **SUPERSEDES M2.D-36 (ngưỡng auto-OFF)** — source: `...SPEC.md:140`
Quyết định: **Auto-OFF sau 30 phút** không phản hồi, không phải 5 phút. **Ghi đè M2.D-36**: `escalate_autooff_after_s` mặc định `1800`. Ghi audit log actor `SYSTEM` + hiện trong lịch sử để biết đã tắt lúc nào, vì đơn nào. **Không tự ON lại** — admin bật tay ở `/admin/settings`
Lý do: 5 phút quá ngắn: giờ cao điểm admin bấm bill 5 phút là bình thường → tắt oan cả kênh online, mất hết khách sau đó. 30 phút thì gần như chắc chắn quán không có người trực. SMS ở 90s giữ nguyên nên vẫn không bỏ lọt đơn
⚠️ Pseudo-code §7 (spec:469) vẫn ghi `L4 AUTOOFF → scheduled_at = now + 300s` — **stale, không làm theo**. Dùng 1800s.

**M2.D-61** — status: LOCKED — source: `...SPEC.md:141`
Quyết định: **Kiểm tra lại tồn kho tại bước duyệt.** Màn hàng chờ hiện cảnh báo *"2 món đã hết hàng"*; admin tick bỏ món; `confirm` re-validate trong cùng transaction. Món bị bỏ → tracking hiện dòng *"N món đã huỷ — quán sẽ liên hệ bạn"* (M2.D-21). Hết toàn bộ món → **buộc Từ chối**, không cho xác nhận đơn rỗng
Lý do: Spec cũ chỉ validate tồn kho **lúc submit**. Khách gửi 19:00, admin duyệt 19:04 món đã hết → §7 add items thẳng vào bếp, bếp nhận món không có hàng

**M2.D-62** — status: LOCKED — source: `...SPEC.md:142`
Quyết định: **Phí ship tách riêng, KHÔNG tính vào doanh thu món.** Thêm cột `orders.ship_fee int DEFAULT 0`; admin nhập ở màn duyệt (ô "Phí ship" cạnh nút Xác nhận), sửa được tới trước khi thanh toán. Tổng bill = tiền món + `ship_fee`. Báo cáo ngày hiện **2 dòng: tiền món / tiền ship**
Lý do: M2.D-52 nói "admin chốt phí khi gọi lại" nhưng spec cũ không có field nào để nhập. Gộp vào doanh thu chung thì doanh thu món bị phồng, không so được với đơn tại quán

**M2.D-63** — status: LOCKED — source: `...SPEC.md:143`
Quyết định: SMS dùng **brandname eSMS / Viettel** (chủ quán chốt). Viết sau `SmsChannel` (adapter M2.D-37) với **2 implementation**: `ConsoleSmsChannel` (ghi log + `notification_outbox`, dùng khi chưa có brandname) và `EsmsChannel` (prod), chọn bằng env `SMS_DRIVER`. Email tổng hợp cuối ngày dùng **Gmail SMTP app password**
Lý do: Đăng ký brandname mất 1–2 tuần → **không được để việc đó block phase 09**. Có console driver thì test được toàn bộ luồng leo thang trước, cắm brandname sau là đổi 1 biến env

---

## Scope: vòng 5 — subdomain split & infra (chốt 2026-07-29)

**M2.D-64** — status: LOCKED — source: `...SPEC.md:149`
Quyết định: **2 frontend, 1 backend.** Thêm app mới `apps/shop` (Vite + React) cho trang khách; `apps/web` giữ nguyên 100% cho POS/quản lý. Dùng **chung 1 API container, chung 1 DB, chung `packages/schemas`**
Lý do: Bundle khách nhẹ (không kéo theo code POS), không lộ cấu trúc route admin trong JS công khai, và giao diện kiểu Lotteria không đụng vào design hệ thống của trang quản lý

**M2.D-65** — status: LOCKED — source: `...SPEC.md:150`
Quyết định: Tên miền: **`quanbalun.site` giữ nguyên cho quản lý** (kể cả `www.`), **`order.quanbalun.site` cho trang khách**. Cần thêm DNS A record cho `order.` trỏ về IP VPS; Caddy tự cấp cert
Lý do: Nhân viên không phải đổi link đang dùng. Dùng subdomain thật (`order.`) chứ không phải `-order` vì `-order` sẽ là **một tên miền khác phải mua thêm**
⚠️ DNS + cert = thao tác production → xem `constraints.md` C-LOCAL-01 (deferred UAT, không làm trong milestone này).

**M2.D-66** — status: LOCKED — source: `...SPEC.md:151`
Quyết định: API chọn thư mục static **theo `Host` header**: host bắt đầu `order.` → serve `shop-dist`, còn lại → `web-dist` (main.ts:41). Caddy thêm site block thứ hai cho `order.{$DOMAIN}`, vẫn `reverse_proxy api:3001`
Lý do: Các prefix API hiện tại là `/auth`, `/orders`, `/menu`… **không có prefix `/api` chung** → Caddy không phân biệt được static và API để tự serve file. Chọn theo Host trong API là đổi ít nhất, deploy vẫn 1 container

**M2.D-67** — status: LOCKED — source: `...SPEC.md:152`
Quyết định: `ALLOWED_ORIGIN` đổi thành **danh sách** (phân tách dấu phẩy), gồm cả origin admin và origin order (csrf-origin.middleware.ts:26). Trang khách gọi API **cùng origin** (`order.quanbalun.site/api/public/...`) → **không cần CORS**
Lý do: Middleware hiện chỉ so 1 string → submit đơn từ order subdomain sẽ bị chặn
⚠️ Bổ sung bắt buộc từ codebase map: chuyển sang list mà giữ `startsWith` vẫn để lại lỗ prefix-spoofing → xem `constraints.md` C-SEC-01.

**M2.D-68** — status: LOCKED — source: `...SPEC.md:153`
Quyết định: Cookie JWT **giữ nguyên host-only** (`cookieOptions` không set `domain`, `sameSite: 'strict'` — jwt.service.ts:53). Tuyệt đối **không** đổi sang `domain: '.quanbalun.site'`
Lý do: Host-only nghĩa là token admin **không bao giờ** được gửi tới subdomain trang khách. Đây là lợi ích an toàn có sẵn — đổi sang domain-wide là tự mở lỗ hổng

**M2.D-69** — status: LOCKED — source: `...SPEC.md:154`
Quyết định: **Sửa `Permissions-Policy` trong Caddyfile:24**: hiện là `geolocation=()` — **chặn hoàn toàn Geolocation API**. Site block của `order.` phải dùng `geolocation=(self)`
Lý do: Nếu không sửa, nút "Chia sẻ vị trí" (M2.D-49) **im lặng không chạy** trên production dù code đúng. Site block admin giữ `geolocation=()`
⚠️ Kiểm chứng qua Caddy = production-only → deferred UAT, xem `constraints.md` C-LOCAL-01.

---

## Scope: vòng 5 — customer UI (tham chiếu lotteria.vn)

**M2.D-70** — status: LOCKED — source: `...SPEC.md:160`
Quyết định: Giao diện `apps/shop` lấy tham chiếu từ **https://www.lotteria.vn** (chủ quán chọn): kiểu chuỗi fast-food — banner lớn đầu trang, chip danh mục dính, lưới món ảnh to, giỏ hàng dính đáy. **Không** kế thừa design system của `apps/web`
Lý do: Trang khách và trang POS có mục tiêu ngược nhau: POS tối ưu mật độ thông tin, trang khách tối ưu giữ khách và ham muốn gọi món (G-3)

**M2.D-71** — status: LOCKED — source: `...SPEC.md:161`
Quyết định: Design ref đã có **2 màn** (chủ quán gửi 2026-07-29): `lotteria.vn/category/set` (lưới món) và `lotteria.vn/cart` (giỏ hàng). Đặc tả rút ra ở **§8-bis**. **Còn thiếu:** trang chủ/banner, chi tiết món, bước 2 checkout, **và bản mobile** — chụp bổ sung trước khi làm phase 08, lưu vào `docs/design-refs/lotteria/` rồi chạy `/gsd:ui-phase`
Lý do: Có ảnh thật mới bám được khoảng cách, cỡ chữ, độ đậm. Thiếu bản mobile là rủi ro lớn nhất vì khách gần như 100% vào bằng điện thoại

> **Chưa chốt (spec:163):** màu thương hiệu Quán Bà Lùn. Lotteria dùng đỏ coral `#E4453A`. Cần logo quán để lấy màu chính. → xem WARNING trong `.planning/INGEST-CONFLICTS.md`.
